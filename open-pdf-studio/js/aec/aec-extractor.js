// OpenCivil — AEC Structured Data Extraction v2
// Parses extracted PDF text spans into structured AEC data using regex + position.
// Tested against: Meydenbauer 60% Storm Drain Plan & Profile (dense CAD drawing)
//
// Targets: SDMH, SSMH, MH, CB, RIM, IE, INV, pipe runs, slopes, stations,
//          water valves, bottom of structure, pipe sizes/materials.

/**
 * @typedef {Object} AecRecord
 * @property {string} type      Record type
 * @property {Object} fields    Extracted key/value pairs
 * @property {Object} source    Source text span (text, x, y, page)
 */

// ============================================================
// Regex Patterns — tuned for real CAD plan/profile sheets
// ============================================================

const PATTERNS = {
  // ── Stationing ──
  // STA 5+00, STA. 12+50.33, 10+25, standalone 4+00
  station: /(?:STA\.?\s*)?(\d{1,3}\+\d{2}(?:\.\d{1,2})?)/gi,

  // ── Structures ──
  // SDMH4, SDMH4A, SDMH-5, SSMH, STMH-1, MH-1, MH 2, MH#3
  manhole: /\b((?:SD|SS|ST|STSD)?MH)\s*[-#]?\s*(\d+[A-Z]?)\b/gi,

  // CB, CB-1, CB #2, or standalone CB followed by RIM/IE data
  catchBasin: /\bCB\s*[-#]?\s*(\d*[A-Z]?)\b/gi,

  // ── RIM Elevations ──
  // RIM=143.96, RIM-144.92, RIM =155.05, RIM: 142.50
  rim: /\bRIM\s*[=:\-]\s*(\d{2,4}\.\d{1,3})\b/gi,

  // ── IE (Invert Elevation) — the #1 missed pattern ──
  // IE 8" PVC (S)=142.99, IE 12" CONC (E)=140.62, IE=98.50, IE: 97.25
  // Captures: full match, pipe size (opt), pipe material (opt), direction (opt), elevation
  ie: /\bIE\s+(?:(\d{1,2})[""]\s*)?([\w]+)?\s*\(([NSEW]+)\)\s*[=:]\s*(\d{2,4}\.\d{1,3})/gi,

  // Simple IE without pipe info: IE=98.50, IE: 97.25, IE 95.80
  ieSimple: /\bIE\s*[=:]\s*(\d{2,4}\.\d{1,3})/gi,

  // ── INV (Invert) — traditional format ──
  // INV IN 98.50, INV OUT 97.25, INVERT IN=98.50
  invertIn: /\bINV(?:ERT)?\s*(?:IN|INLET)\s*[=:]?\s*(\d{2,4}\.\d{1,3})/gi,
  invertOut: /\bINV(?:ERT)?\s*(?:OUT|OUTLET)\s*[=:]?\s*(\d{2,4}\.\d{1,3})/gi,

  // ── BOTTOM OF STRUCTURE ──
  // BOTTOM OF STRUCTURE=141.29, BOTTOM OF STRUCTURE= 139.02
  bottomOfStructure: /\bBOTTOM\s+OF\s+STRUCTURE\s*[=:]\s*(\d{2,4}\.\d{1,3})/gi,

  // ── CENTER OF CHANNEL ──
  centerOfChannel: /\bCENTER\s+OF\s+CHANNEL\s*[=:]\s*(\d{2,4}\.\d{1,3})/gi,

  // ── Elevations (generic) ──
  // EL 100.50, ELEV. 99.25
  elevation: /\b(?:EL(?:EV)?\.?)\s*[=:]?\s*(\d{2,4}\.\d{1,3})/gi,

  // ── Pipe size ──
  // 8", 12", 30", 8-inch, 12 IN
  pipeSize: /\b(\d{1,2})["""\u201d](?:\s*(?:DIA|Ø|0))?\b|\b(\d{1,2})[\s-]*(?:INCH|IN)\b/gi,

  // ── Pipe material ──
  // PVC, RCP, HDPE, CMP, DIP, VCP, CONC, CONCRETE, STL (steel), SDR 35
  pipeMaterial: /\b(PVC|RCP|HDPE|CMP|DIP|VCP|STL|SDR\s*\d+|CONC(?:RETE)?)\b/gi,

  // ── Slope ──
  // S=0.005, S=0.5%, 0.50%, S= 9.2%, @ 0.52%
  slope: /\bS\s*=\s*(\d+\.?\d*%?)\b|(\d+\.\d+)\s*%/gi,

  // ── Pipe length / pipe runs ──
  // 249 LF, 14 LF, L=100', 200.5 LF, LENGTH = 75
  pipeLength: /\b(\d+(?:\.\d+)?)\s*LF\b|(?:L(?:ENGTH)?\s*=\s*)(\d+(?:\.\d+)?)/gi,

  // ── Compound pipe run (e.g., "249 LF 30" PVC, S=0.5%") ──
  // Captures: length, pipe size, material, slope
  pipeRun: /\b(\d+(?:\.\d+)?)\s*LF\s+(\d{1,2})[""]\s*[0Ø]?\s*(PVC|RCP|HDPE|STL|CONC)\s*,?\s*S\s*=\s*(\d+\.?\d*%?)/gi,

  // ── Water Valve ──
  // WATER VALVE RIM=156.74, WATER VALVE\nRIM=143.96
  waterValve: /\bWATER\s+VALVE?\b/gi,

  // TOP OF NUT= 154.64
  topOfNut: /\bTOP\s+(?:OF\s+)?NUT\s*[=:]\s*(\d{2,4}\.\d{1,3})/gi,

  // ── Scale ──
  // SCALE: 1"=20', 1"=5'
  scale: /\b(?:SCALE\s*[:=]?\s*)?1["""\u201d]\s*=\s*(\d+)[''\u2019]/gi,

  // ── Force Main ──
  forceMain: /\bFORCE\s+MAIN\b/gi,
};

// ============================================================
// Extraction Function
// ============================================================

/**
 * Extract all structured AEC data from an array of text spans.
 *
 * @param {Array<{text: string, x: number, y: number, page?: number, font_size?: number}>} spans
 * @param {number} [defaultPage=1]
 * @returns {AecRecord[]}
 */
export function extractAecData(spans, defaultPage = 1) {
  const records = [];

  for (const span of spans) {
    const text = span.text;
    if (!text || text.trim().length < 1) continue;

    const page = span.page ?? defaultPage;
    const source = { text, x: span.x, y: span.y, page, fontSize: span.font_size };

    let match;

    // ── Station ──
    const stationRe = new RegExp(PATTERNS.station.source, PATTERNS.station.flags);
    while ((match = stationRe.exec(text)) !== null) {
      records.push({ type: 'station', fields: { station: match[1] || match[0] }, source });
    }

    // ── Manhole (SDMH, SSMH, STMH, MH) ──
    const mhRe = new RegExp(PATTERNS.manhole.source, PATTERNS.manhole.flags);
    while ((match = mhRe.exec(text)) !== null) {
      const prefix = match[1].toUpperCase(); // SDMH, SSMH, STMH, MH
      const num = match[2];
      records.push({ type: 'manhole', fields: { id: prefix + num, prefix, number: num }, source });
    }

    // ── Catch Basin ──
    const cbRe = new RegExp(PATTERNS.catchBasin.source, PATTERNS.catchBasin.flags);
    while ((match = cbRe.exec(text)) !== null) {
      const num = match[1] || '';
      records.push({ type: 'catchBasin', fields: { id: 'CB' + (num ? '-' + num : ''), number: num }, source });
    }

    // ── RIM elevation (dedicated, high priority) ──
    const rimRe = new RegExp(PATTERNS.rim.source, PATTERNS.rim.flags);
    while ((match = rimRe.exec(text)) !== null) {
      records.push({ type: 'rim', fields: { value: match[1], raw: match[0] }, source });
    }

    // ── IE with pipe info: IE 8" PVC (S)=142.99 ──
    const ieRe = new RegExp(PATTERNS.ie.source, PATTERNS.ie.flags);
    while ((match = ieRe.exec(text)) !== null) {
      records.push({
        type: 'invertElevation',
        fields: {
          elevation: match[4],
          pipeSize: match[1] ? match[1] + '"' : '',
          material: match[2] || '',
          direction: match[3] || '',
          raw: match[0],
        },
        source,
      });
    }

    // ── IE simple: IE=98.50 ──
    const ieSimpleRe = new RegExp(PATTERNS.ieSimple.source, PATTERNS.ieSimple.flags);
    while ((match = ieSimpleRe.exec(text)) !== null) {
      // Avoid duplicate if already caught by the detailed IE regex
      const alreadyCaught = records.some(
        r => r.type === 'invertElevation' && r.source === source && r.fields.elevation === match[1]
      );
      if (!alreadyCaught) {
        records.push({ type: 'invertElevation', fields: { elevation: match[1], raw: match[0] }, source });
      }
    }

    // ── INV IN / INV OUT ──
    const invInRe = new RegExp(PATTERNS.invertIn.source, PATTERNS.invertIn.flags);
    while ((match = invInRe.exec(text)) !== null) {
      records.push({ type: 'invertIn', fields: { value: match[1], raw: match[0] }, source });
    }
    const invOutRe = new RegExp(PATTERNS.invertOut.source, PATTERNS.invertOut.flags);
    while ((match = invOutRe.exec(text)) !== null) {
      records.push({ type: 'invertOut', fields: { value: match[1], raw: match[0] }, source });
    }

    // ── Bottom of Structure ──
    const bosRe = new RegExp(PATTERNS.bottomOfStructure.source, PATTERNS.bottomOfStructure.flags);
    while ((match = bosRe.exec(text)) !== null) {
      records.push({ type: 'bottomOfStructure', fields: { value: match[1] }, source });
    }

    // ── Center of Channel ──
    const cocRe = new RegExp(PATTERNS.centerOfChannel.source, PATTERNS.centerOfChannel.flags);
    while ((match = cocRe.exec(text)) !== null) {
      records.push({ type: 'centerOfChannel', fields: { value: match[1] }, source });
    }

    // ── Generic Elevation (EL/ELEV) ──
    const elevRe = new RegExp(PATTERNS.elevation.source, PATTERNS.elevation.flags);
    while ((match = elevRe.exec(text)) !== null) {
      records.push({ type: 'elevation', fields: { value: match[1], raw: match[0] }, source });
    }

    // ── Compound pipe run: 249 LF 30" PVC, S=0.5% ──
    const pipeRunRe = new RegExp(PATTERNS.pipeRun.source, PATTERNS.pipeRun.flags);
    while ((match = pipeRunRe.exec(text)) !== null) {
      records.push({
        type: 'pipeRun',
        fields: {
          length: match[1] + ' LF',
          size: match[2] + '"',
          material: match[3],
          slope: match[4],
          raw: match[0],
        },
        source,
      });
    }

    // ── Pipe size (standalone) ──
    const sizeRe = new RegExp(PATTERNS.pipeSize.source, PATTERNS.pipeSize.flags);
    while ((match = sizeRe.exec(text)) !== null) {
      const size = match[1] || match[2];
      if (size) records.push({ type: 'pipeSize', fields: { size: size + '"' }, source });
    }

    // ── Pipe material (standalone) ──
    const matRe = new RegExp(PATTERNS.pipeMaterial.source, PATTERNS.pipeMaterial.flags);
    while ((match = matRe.exec(text)) !== null) {
      records.push({ type: 'pipeMaterial', fields: { material: match[1].toUpperCase() }, source });
    }

    // ── Slope (standalone) ──
    const slopeRe = new RegExp(PATTERNS.slope.source, PATTERNS.slope.flags);
    while ((match = slopeRe.exec(text)) !== null) {
      records.push({ type: 'slope', fields: { slope: match[1] || match[2] }, source });
    }

    // ── Pipe length (standalone) ──
    const lenRe = new RegExp(PATTERNS.pipeLength.source, PATTERNS.pipeLength.flags);
    while ((match = lenRe.exec(text)) !== null) {
      const val = match[1] || match[2];
      if (val) records.push({ type: 'pipeLength', fields: { length: val + ' LF' }, source });
    }

    // ── Water Valve ──
    const wvRe = new RegExp(PATTERNS.waterValve.source, PATTERNS.waterValve.flags);
    while ((match = wvRe.exec(text)) !== null) {
      records.push({ type: 'waterValve', fields: { raw: match[0] }, source });
    }

    // ── Top of Nut ──
    const tonRe = new RegExp(PATTERNS.topOfNut.source, PATTERNS.topOfNut.flags);
    while ((match = tonRe.exec(text)) !== null) {
      records.push({ type: 'topOfNut', fields: { value: match[1] }, source });
    }

    // ── Force Main ──
    const fmRe = new RegExp(PATTERNS.forceMain.source, PATTERNS.forceMain.flags);
    while ((match = fmRe.exec(text)) !== null) {
      records.push({ type: 'forceMain', fields: { raw: match[0] }, source });
    }

    // ── Scale notation ──
    const scaleRe = new RegExp(PATTERNS.scale.source, PATTERNS.scale.flags);
    while ((match = scaleRe.exec(text)) !== null) {
      records.push({ type: 'scale', fields: { ratio: '1"=' + match[1] + "'" }, source });
    }
  }

  return records;
}

// ============================================================
// Pipe Schedule Builder
// ============================================================

/**
 * Group nearby extracted records into pipe schedule rows.
 * Uses Y-position proximity to associate data on the same line.
 */
export function buildPipeSchedule(records) {
  const yGroups = new Map();
  const tolerance = 15;

  for (const record of records) {
    const y = Math.round(record.source.y / tolerance) * tolerance;
    if (!yGroups.has(y)) yGroups.set(y, []);
    yGroups.get(y).push(record);
  }

  const pipes = [];
  for (const [, group] of yGroups) {
    const pipe = {};
    for (const record of group) {
      switch (record.type) {
        case 'station': pipe.station = record.fields.station; break;
        case 'pipeSize': pipe.size = record.fields.size; break;
        case 'pipeMaterial': pipe.material = record.fields.material; break;
        case 'pipeLength': pipe.length = record.fields.length; break;
        case 'slope': pipe.slope = record.fields.slope; break;
        case 'pipeRun':
          pipe.size = record.fields.size;
          pipe.material = record.fields.material;
          pipe.length = record.fields.length;
          pipe.slope = record.fields.slope;
          break;
        case 'invertElevation':
          if (!pipe.invertIn) pipe.invertIn = record.fields.elevation;
          else pipe.invertOut = record.fields.elevation;
          break;
        case 'invertIn': pipe.invertIn = record.fields.value; break;
        case 'invertOut': pipe.invertOut = record.fields.value; break;
        case 'rim': pipe.rimElevation = record.fields.value; break;
        case 'bottomOfStructure': pipe.bottomOfStructure = record.fields.value; break;
      }
    }
    const filled = Object.values(pipe).filter(Boolean).length;
    if (filled >= 2) pipes.push(pipe);
  }
  return pipes;
}

// ============================================================
// CSV Export
// ============================================================

export function recordsToCsv(records) {
  if (records.length === 0) return '';

  const rows = records.map(r => ({
    type: r.type,
    page: r.source.page,
    x: Math.round(r.source.x),
    y: Math.round(r.source.y),
    text: r.source.text,
    ...r.fields,
  }));

  const allKeys = new Set();
  rows.forEach(row => Object.keys(row).forEach(k => allKeys.add(k)));
  const headers = Array.from(allKeys);

  const csvLines = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const val = row[h] ?? '';
        return typeof val === 'string' && (val.includes(',') || val.includes('"'))
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }).join(',')
    ),
  ];

  return csvLines.join('\n');
}

// ============================================================
// Search / Filter / Summary
// ============================================================

export function searchSpans(spans, query) {
  if (!query?.trim()) return [];
  const lower = query.toLowerCase();
  return spans.filter(s => s.text?.toLowerCase().includes(lower));
}

export function summarizeRecords(records) {
  const summary = {};
  for (const r of records) {
    summary[r.type] = (summary[r.type] || 0) + 1;
  }
  return summary;
}
