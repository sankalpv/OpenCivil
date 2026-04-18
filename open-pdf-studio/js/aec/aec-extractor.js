// OpenCivil — AEC Structured Data Extraction
// Parses extracted PDF text spans into structured AEC data using regex + position.
// Targets: pipe schedules, stationing, elevations, manhole data, slopes, notes.
//
// Designed to work with TextSpan[] from rust-text-extraction.js or PDF.js text content.

/**
 * @typedef {Object} AecRecord
 * @property {string} type      Record type (station, elevation, pipeSize, etc.)
 * @property {Object} fields    Extracted key/value pairs
 * @property {Object} source    Source text span (text, x, y, page)
 */

// ============================================================
// Regex Patterns for AEC Data
// ============================================================

const PATTERNS = {
  // Station: 0+00, 1+50.00, 10+25.33, STA 5+00, STA. 12+50
  station: /(?:STA\.?\s*)?(\d{1,3}\+\d{2}(?:\.\d{1,2})?)/gi,

  // Elevation: EL 100.50, ELEV. 99.25, INV 98.00, RIM 102.5
  elevation: /(?:EL(?:EV)?\.?\s*|INV\.?\s*|RIM\.?\s*)(\d{2,4}\.\d{1,3})/gi,

  // Pipe size: 8", 12", 15", 18", 24", 36" or 8-inch, 12 IN
  pipeSize: /(\d{1,2})[""\u201d](?:\s*(?:DIA|Ø))?|(\d{1,2})[\s-]*(?:IN(?:CH)?|in)/gi,

  // Pipe material: PVC, RCP, HDPE, CMP, DIP, VCP
  pipeMaterial: /\b(PVC|RCP|HDPE|CMP|DIP|VCP|SDR\s*\d+|CONC(?:RETE)?)\b/gi,

  // Slope: S=0.005, 0.50%, 1.0% slope, @ 0.52%
  slope: /(?:S\s*=\s*|@\s*)(\d+\.\d+%?)|(\d+\.\d+)\s*%/gi,

  // Pipe length: L=100', 150 LF, 200.5', LENGTH = 75
  pipeLength: /(?:L(?:ENGTH)?\s*=\s*)(\d+(?:\.\d+)?)\s*(?:'|LF|FT)?|(\d+(?:\.\d+)?)\s+LF/gi,

  // Manhole: MH-1, MH 2, MANHOLE #3, MH#4, STMH-1
  manhole: /(?:ST)?MH[\s#-]*(\d+[A-Z]?)/gi,

  // Invert: INV IN 98.50, INV OUT 97.25, IE IN=98.50
  invertIn: /INV(?:ERT)?\s*(?:IN|INLET)\s*[=:]?\s*(\d{2,4}\.\d{1,3})/gi,
  invertOut: /INV(?:ERT)?\s*(?:OUT|OUTLET)\s*[=:]?\s*(\d{2,4}\.\d{1,3})/gi,

  // Rim elevation: RIM 102.50, RIM EL. 103.25
  rimElev: /RIM\s*(?:EL(?:EV)?\.?)?\s*[=:]?\s*(\d{2,4}\.\d{1,3})/gi,

  // Catch basin: CB-1, CB #2
  catchBasin: /CB[\s#-]*(\d+[A-Z]?)/gi,

  // Scale: SCALE: 1"=20', H: 1"=40', V: 1"=4'
  scale: /SCALE\s*[:=]?\s*1[""\u201d]\s*=\s*(\d+)[''\u2019]/gi,

  // General dimension: 10'-6", 25.5'
  dimension: /(\d+)[''\u2019]-(\d+)[""\u201d]|(\d+(?:\.\d+)?)[''\u2019]/gi,
};

// ============================================================
// Extraction Functions
// ============================================================

/**
 * Extract all structured AEC data from an array of text spans.
 * Works with TextSpan objects from Rust extraction (x, y, text, font_size)
 * or any object with { text, x, y, page? }.
 *
 * @param {Array<{text: string, x: number, y: number, page?: number, font_size?: number}>} spans
 * @param {number} [defaultPage=1]  Page number if not present on spans
 * @returns {AecRecord[]}
 */
export function extractAecData(spans, defaultPage = 1) {
  const records = [];

  for (const span of spans) {
    const text = span.text;
    if (!text || text.trim().length < 2) continue;

    const page = span.page ?? defaultPage;
    const source = { text, x: span.x, y: span.y, page, fontSize: span.font_size };

    // Station
    let match;
    const stationRe = new RegExp(PATTERNS.station.source, PATTERNS.station.flags);
    while ((match = stationRe.exec(text)) !== null) {
      records.push({ type: 'station', fields: { station: match[1] || match[0] }, source });
    }

    // Elevation
    const elevRe = new RegExp(PATTERNS.elevation.source, PATTERNS.elevation.flags);
    while ((match = elevRe.exec(text)) !== null) {
      const prefix = text.substring(Math.max(0, match.index - 5), match.index).toUpperCase();
      let elevType = 'elevation';
      if (prefix.includes('INV')) elevType = 'invert';
      else if (prefix.includes('RIM')) elevType = 'rim';
      records.push({ type: elevType, fields: { value: match[1], raw: match[0] }, source });
    }

    // Pipe size
    const sizeRe = new RegExp(PATTERNS.pipeSize.source, PATTERNS.pipeSize.flags);
    while ((match = sizeRe.exec(text)) !== null) {
      records.push({ type: 'pipeSize', fields: { size: (match[1] || match[2]) + '"' }, source });
    }

    // Pipe material
    const matRe = new RegExp(PATTERNS.pipeMaterial.source, PATTERNS.pipeMaterial.flags);
    while ((match = matRe.exec(text)) !== null) {
      records.push({ type: 'pipeMaterial', fields: { material: match[1].toUpperCase() }, source });
    }

    // Slope
    const slopeRe = new RegExp(PATTERNS.slope.source, PATTERNS.slope.flags);
    while ((match = slopeRe.exec(text)) !== null) {
      records.push({ type: 'slope', fields: { slope: match[1] || match[2] }, source });
    }

    // Manhole
    const mhRe = new RegExp(PATTERNS.manhole.source, PATTERNS.manhole.flags);
    while ((match = mhRe.exec(text)) !== null) {
      records.push({ type: 'manhole', fields: { id: 'MH-' + match[1] }, source });
    }

    // Catch basin
    const cbRe = new RegExp(PATTERNS.catchBasin.source, PATTERNS.catchBasin.flags);
    while ((match = cbRe.exec(text)) !== null) {
      records.push({ type: 'catchBasin', fields: { id: 'CB-' + match[1] }, source });
    }

    // Pipe length
    const lenRe = new RegExp(PATTERNS.pipeLength.source, PATTERNS.pipeLength.flags);
    while ((match = lenRe.exec(text)) !== null) {
      const val = match[1] || match[2];
      if (val) records.push({ type: 'pipeLength', fields: { length: val + ' LF' }, source });
    }

    // Scale notation
    const scaleRe = new RegExp(PATTERNS.scale.source, PATTERNS.scale.flags);
    while ((match = scaleRe.exec(text)) !== null) {
      records.push({ type: 'scale', fields: { ratio: '1"=' + match[1] + "'" }, source });
    }
  }

  return records;
}

/**
 * Group nearby extracted records into pipe schedule rows.
 * Uses Y-position proximity to associate data on the same line.
 *
 * @param {AecRecord[]} records
 * @returns {Array<Object>}
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
        case 'invert':
          if (!pipe.invertIn) pipe.invertIn = record.fields.value;
          else pipe.invertOut = record.fields.value;
          break;
        case 'rim': pipe.rimElevation = record.fields.value; break;
      }
    }
    const filled = Object.values(pipe).filter(Boolean).length;
    if (filled >= 2) pipes.push(pipe);
  }
  return pipes;
}

/**
 * Convert AEC records to CSV format.
 * @param {AecRecord[]} records
 * @returns {string}
 */
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

/**
 * Search/filter text spans by query.
 * @param {Array<{text: string}>} spans
 * @param {string} query
 * @returns {Array}
 */
export function searchSpans(spans, query) {
  if (!query?.trim()) return [];
  const lower = query.toLowerCase();
  return spans.filter(s => s.text?.toLowerCase().includes(lower));
}

/**
 * Get a summary of extracted data by type.
 * @param {AecRecord[]} records
 * @returns {Object}
 */
export function summarizeRecords(records) {
  const summary = {};
  for (const r of records) {
    summary[r.type] = (summary[r.type] || 0) + 1;
  }
  return summary;
}
