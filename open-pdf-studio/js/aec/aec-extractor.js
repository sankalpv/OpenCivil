// OpenCivil — AEC Structured Data Extraction v2
// Parses extracted PDF text spans into structured AEC data using regex + position.
// Tested against: Meydenbauer 60% Storm Drain Plan & Profile (dense CAD drawing)
//
// Targets: SDMH, SSMH, MH, CB, RIM, IE, INV, pipe runs, slopes, stations,
//          water valves, bottom of structure, pipe sizes/materials.
//
// Northing and Easting columns added via enrichRecordsWithCoordinates()
// Real-world survey coordinates calculated from station, offset, and scale

import { enrichRecordsWithCoordinates } from './civil3d-export.js';

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
  // Profile: SDMH5 60" TYPE 1, SDMH4A 48" TYPE 1
  manhole: /((?:SD|SS|ST|STSD)?MH)\s*[-#]?\s*(\d+[A-Z]?)(?:\s+(\d{1,2})[""]\s*(?:TYPE\s*(\d+))?)?/gi,

  // CB, CB-1, CB #2, SDCB, SDCB-1, SSCB, standalone CB
  // Word boundary after CB prevents capturing "R" from "CB RIM=..."
  catchBasin: /((?:SD|SS)?CB)\s*[-#]?\s*(\d+[A-Z]?)\b|(?:^|\s)((?:SD|SS)?CB)(?=\s+RIM|\s*$|\s+[^-#\dA-Z])/gim,

  // ── RIM Elevations ──
  // Plan: RIM=143.96, RIM-144.92, RIM =155.05, RIM: 142.50
  // Profile: RIM 156.70±-MATCH EX (space separator, ± approximate, MATCH EX qualifier)
  rim: /RIM\s*[=:\-\s]\s*(\d{2,4}\.\d{1,3})(±)?(?:\s*[-–]?\s*(MATCH\s+EX))?/gi,

  // ── IE (Invert Elevation) ──
  // IE 8" PVC (S)=142.99, IE 12" CONC (E)=140.62
  ie: /IE\s+(?:(\d{1,2})[""]\s*)?([\w]+)?\s*\(([NSEW]+)\)\s*[=:]\s*(\d{2,4}\.\d{1,3})/gi,

  // Profile IE: IE 148.00 30" N, IE 137.80 30" SE (elevation first, no = sign)
  ieProfile: /IE\s+(\d{2,4}\.\d{1,3})\s+(\d{1,2})[""]\s*([NSEW]{1,2})/gi,

  // Simple IE without pipe info: IE=98.50, IE: 97.25
  ieSimple: /IE\s*[=:]\s*(\d{2,4}\.\d{1,3})/gi,

  // ── INV (Invert) — traditional format ──
  invertIn: /INV(?:ERT)?\s*(?:IN|INLET)\s*[=:]?\s*(\d{2,4}\.\d{1,3})/gi,
  invertOut: /INV(?:ERT)?\s*(?:OUT|OUTLET)\s*[=:]?\s*(\d{2,4}\.\d{1,3})/gi,

  // ── BOTTOM OF STRUCTURE ──
  bottomOfStructure: /BOTTOM\s+OF\s+STRUCTURE\s*[=:]\s*(\d{2,4}\.\d{1,3})/gi,

  // ── CENTER OF CHANNEL ──
  centerOfChannel: /CENTER?\s+OF\s+CHANNEL\s*[=:]\s*(\d{2,4}\.\d{1,3})/gi,

  // ── Elevations (generic) ──
  // EL 100.50, ELEV. 99.25, INV 98.00, RIM 102.5
  elevation: /(?:EL(?:EV)?\.?\s*|INV\.?\s*|RIM\.?\s*)(\d{2,4}\.\d{1,3})/gi,

  // ── Pipe size ──
  // 8", 12", 30", 8-inch, 12 IN, 30"∅
  pipeSize: /(\d{1,2})["""\u201d](?:\s*(?:DIA|Ø|∅|0))?|(\d{1,2})[\s-]*(?:IN(?:CH)?|in)/gi,

  // ── Pipe material ──
  pipeMaterial: /(PVC|RCP|HDPE|CMP|DIP|VCP|STL|SDR\s*\d+|CONC(?:RETE)?)/gi,

  // ── Slope ──
  slope: /(?:S\s*=\s*|@\s*)(\d+\.?\d*%?)|(\d+\.\d+)\s*%/gi,

  // ── Pipe length ──
  pipeLength: /(?:L(?:ENGTH)?\s*=\s*)?(\d+(?:\.\d+)?)\s*(?:LF)/gi,

  // ── Compound pipe run ──
  // 249 LF 30"∅ PVC, S=0.5%  (∅ U+2205 and Ø U+00D8)
  pipeRun: /(\d+(?:\.\d+)?)\s*LF\s+(\d{1,2})[""]\s*[0Ø∅]?\s*(PVC|RCP|HDPE|STL|CONC)\s*,?\s*S\s*=\s*(\d+\.?\d*%?)/gi,

  // ── Water Valve ──
  waterValve: /WATER\s+VALVE?/gi,

  // TOP OF NUT= 154.64
  topOfNut: /TOP\s+(?:OF\s+)?NUT\s*[=:]\s*(\d{2,4}\.\d{1,3})/gi,

  // ── Scale ──
  scale: /(?:SCALE\s*[:=]?\s*)?1["""\u201d]\s*=\s*(\d+)[''\u2019]/gi,

  // ── Force Main ──
  forceMain: /FORCE\s+MAIN/gi,

  // ── Profile: Station with offset ──
  // STA 5+36.7  0.00  RT, STA 6+67.9  0.00  RT
  stationOffset: /STA\.?\s*(\d{1,3}\+\d{2}(?:\.\d{1,2})?)\s+(\d+\.\d+)\s*(RT|LT|[RL])/gi,

  // ── Existing Utility labels (profile) ──
  // EX. WATER, EX. 8" DI WATER, EX. 18" SS FM, EX. WATER SERVICE
  // Stops at boundary words: IE, RIM, TOP, BOTTOM, SIZE to avoid over-capture
  existingUtility: /EX\.?\s+((?:\d{1,2}[""]\s*)?(?:DI\s+)?(?:WATER(?:\s+SERVICE)?|POWER|GAS|SEWER|SIDE\s+SEWER|SS(?:\s+FM)?|SD|FM|FORCE\s+MAIN))/gi,

  // ── Full-name structures (WSDOT / state DOT drawings) ──
  // CATCH BASIN TYPE 2 54" DIAM, CATCH BASIN TYPE 2 48" DIAM
  catchBasinFull: /CATCH\s+BASIN\s+TYPE\s+(\d+)\s+(\d{1,3})[""]\s*DIAM/gi,

  // MANHOLE TYPE 3 48" DIAM, MANHOLE TYPE 2 54" DIAM
  manholeFull: /MANHOLE\s+TYPE\s+(\d+)\s+(\d{1,3})[""]\s*DIAM/gi,

  // RIM EL. 110.63, RIM EL. 87.00 (WSDOT format — "EL." not "=")
  rimElevation: /RIM\s+EL\.?\s*(\d{2,4}\.\d{1,3})/gi,

  // Station with offset in JR/MR format: JR 60+87.09 (17.87' RT)
  // Also handles MR 4415+37.49 (117.79' RT)
  stationJR: /(?:JR|MR|LR)\s+(\d{1,5}\+\d{2}(?:\.\d{1,2})?)\s*\((\d+\.?\d*)['']\s*(RT|LT)\)/gi,

  // FL (flow line) elevation: FL 110.48 FT
  flowLine: /FL\s+(\d{2,4}\.\d{1,3})\s*FT/gi,
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
  let cbFullCounter = 0;  // Running counter for full-name catch basins (WSDOT)
  let mhFullCounter = 0;  // Running counter for full-name manholes (WSDOT)

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
    // Profile includes diameter + type: SDMH5 60" TYPE 1
    const mhRe = new RegExp(PATTERNS.manhole.source, PATTERNS.manhole.flags);
    while ((match = mhRe.exec(text)) !== null) {
      const prefix = match[1].toUpperCase(); // SDMH, SSMH, STMH, MH
      const num = match[2];
      const fields = { id: prefix + num, prefix, number: num };
      if (match[3]) fields.diameter = match[3] + '"';
      if (match[4]) fields.manholeType = 'TYPE ' + match[4];
      records.push({ type: 'manhole', fields, source });
    }

    // ── Catch Basin (CB, SDCB, SSCB) ──
    // Alternation: group 1+2 = numbered CB (CB-1), group 3 = standalone CB (before RIM or end)
    const cbRe = new RegExp(PATTERNS.catchBasin.source, PATTERNS.catchBasin.flags);
    while ((match = cbRe.exec(text)) !== null) {
      const prefix = (match[1] || match[3] || '').toUpperCase();
      const num = match[2] || '';
      if (prefix) {
        records.push({ type: 'catchBasin', fields: { id: prefix + num, prefix, number: num }, source });
      }
    }

    // ── RIM elevation (dedicated, high priority) ──
    // Now handles: RIM=143.96, RIM 156.70±-MATCH EX
    const rimRe = new RegExp(PATTERNS.rim.source, PATTERNS.rim.flags);
    while ((match = rimRe.exec(text)) !== null) {
      const fields = { value: match[1], raw: match[0] };
      if (match[2]) fields.approximate = true;
      if (match[3]) fields.matchExisting = true;
      records.push({ type: 'rim', fields, source });
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

    // ── Profile IE: IE 148.00 30" N (elevation first, no = sign) ──
    const ieProfileRe = new RegExp(PATTERNS.ieProfile.source, PATTERNS.ieProfile.flags);
    while ((match = ieProfileRe.exec(text)) !== null) {
      // Avoid duplicate if already caught by detailed IE regex
      const alreadyCaught = records.some(
        r => r.type === 'invertElevation' && r.source === source && r.fields.elevation === match[1]
      );
      if (!alreadyCaught) {
        records.push({
          type: 'invertElevation',
          fields: {
            elevation: match[1],
            pipeSize: match[2] + '"',
            direction: match[3],
            raw: match[0],
            format: 'profile',
          },
          source,
        });
      }
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

    // ── Station with offset (profile): STA 5+36.7  0.00  RT ──
    const staOffRe = new RegExp(PATTERNS.stationOffset.source, PATTERNS.stationOffset.flags);
    while ((match = staOffRe.exec(text)) !== null) {
      records.push({
        type: 'stationOffset',
        fields: { station: match[1], offset: match[2], side: match[3], raw: match[0] },
        source,
      });
    }

    // ── Existing Utility labels (profile) ──
    const exUtilRe = new RegExp(PATTERNS.existingUtility.source, PATTERNS.existingUtility.flags);
    while ((match = exUtilRe.exec(text)) !== null) {
      records.push({
        type: 'existingUtility',
        fields: { description: match[1].trim(), raw: match[0] },
        source,
      });
    }

    // ── Full-name Catch Basin (WSDOT): CATCH BASIN TYPE 2 54" DIAM ──
    const cbFullRe = new RegExp(PATTERNS.catchBasinFull.source, PATTERNS.catchBasinFull.flags);
    while ((match = cbFullRe.exec(text)) !== null) {
      cbFullCounter++;
      records.push({
        type: 'catchBasin',
        fields: {
          id: 'CB-T' + match[1] + '-' + cbFullCounter,  // e.g. CB-T2-1, CB-T2-2 (unique per occurrence)
          prefix: 'CB',
          number: '',
          diameter: match[2] + '"',
          structType: 'TYPE ' + match[1],
          raw: match[0],
        },
        source,
      });
    }

    // ── Full-name Manhole (WSDOT): MANHOLE TYPE 3 48" DIAM ──
    const mhFullRe = new RegExp(PATTERNS.manholeFull.source, PATTERNS.manholeFull.flags);
    while ((match = mhFullRe.exec(text)) !== null) {
      mhFullCounter++;
      records.push({
        type: 'manhole',
        fields: {
          id: 'MH-T' + match[1] + '-' + mhFullCounter,  // e.g. MH-T3-1, MH-T3-2 (unique per occurrence)
          prefix: 'MH',
          number: '',
          diameter: match[2] + '"',
          manholeType: 'TYPE ' + match[1],
          raw: match[0],
        },
        source,
      });
    }

    // ── RIM EL. (WSDOT format): RIM EL. 110.63 ──
    const rimElRe = new RegExp(PATTERNS.rimElevation.source, PATTERNS.rimElevation.flags);
    while ((match = rimElRe.exec(text)) !== null) {
      // Avoid duplicate if already caught by main rim regex
      const alreadyCaught = records.some(
        r => r.type === 'rim' && r.source === source && r.fields.value === match[1]
      );
      if (!alreadyCaught) {
        records.push({ type: 'rim', fields: { value: match[1], raw: match[0] }, source });
      }
    }

    // ── Station with JR/MR offset: JR 60+87.09 (17.87' RT) ──
    const staJrRe = new RegExp(PATTERNS.stationJR.source, PATTERNS.stationJR.flags);
    while ((match = staJrRe.exec(text)) !== null) {
      records.push({
        type: 'stationOffset',
        fields: {
          station: match[1],
          offset: match[2],
          side: match[3],
          raw: match[0],
        },
        source,
      });
    }

    // ── Flow Line elevation: FL 110.48 FT ──
    const flRe = new RegExp(PATTERNS.flowLine.source, PATTERNS.flowLine.flags);
    while ((match = flRe.exec(text)) !== null) {
      records.push({
        type: 'flowLine',
        fields: { elevation: match[1], raw: match[0] },
        source,
      });
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

  // Enrich records with real-world Northing/Easting coordinates
  const enriched = enrichRecordsWithCoordinates(records);

  const rows = enriched.map(r => ({
    type: r.type,
    page: r.source.page,
    x: Math.round(r.source.x),
    y: Math.round(r.source.y),
    Northing: r.northing != null ? r.northing.toFixed(3) : '',
    Easting: r.easting != null ? r.easting.toFixed(3) : '',
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
