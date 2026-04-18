// OpenCivil — Civil 3D ASCII Point File Export
// Generates Autodesk Civil 3D compatible point files from extracted AEC data.
//
// Civil 3D Point File Formats supported:
// 1. PNEZD (Point#,Northing,Easting,Elevation,Description) — most common
// 2. PENZD (Point#,Easting,Northing,Elevation,Description) — alternate
//
// These files can be directly imported into:
// - Autodesk Civil 3D (Import Points → PNEZD format)
// - Autodesk AutoCAD with Civil extensions
// - Bentley OpenRoads / MicroStation
// - Any surveying software that reads CSV point files

import { buildPipeSchedule } from './aec-extractor.js';

/**
 * Convert AEC records to Civil 3D PNEZD point file format.
 * Maps extracted structures (manholes, catch basins) to survey-style points.
 *
 * @param {Array} records  AEC records from extractAecData()
 * @param {Object} [options]
 * @param {string} [options.format='PNEZD']  Point format: 'PNEZD' or 'PENZD'
 * @param {string} [options.delimiter=',']    Field separator
 * @param {number} [options.startPoint=1]     Starting point number
 * @returns {string}  Civil 3D ASCII point file content
 */
export function recordsToCivil3d(records, options = {}) {
  const {
    format = 'PNEZD',
    delimiter = ',',
    startPoint = 1,
  } = options;

  const lines = [];
  let pointNum = startPoint;

  // Header comment (Civil 3D ignores lines starting with #)
  lines.push('# OpenCivil — Civil 3D Point Export');
  lines.push(`# Format: ${format} (Point#${delimiter}Northing${delimiter}Easting${delimiter}Elevation${delimiter}Description)`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('#');

  // ── Extract structure points (MH, CB) with elevations ──
  const structures = new Map(); // id → { rim, inverts[], station, x, y }

  for (const r of records) {
    if (r.type === 'manhole' || r.type === 'catchBasin') {
      const id = r.fields.id;
      if (!structures.has(id)) {
        structures.set(id, {
          id,
          type: r.type === 'manhole' ? 'MH' : 'CB',
          rim: null,
          inverts: [],
          station: null,
          // Use PDF coordinates as proxy for Northing/Easting
          // (user should replace with real survey coords)
          northing: r.source.y,
          easting: r.source.x,
        });
      }
    }
  }

  // Associate elevations with nearby structures (by Y proximity)
  for (const r of records) {
    if (r.type === 'rim') {
      // Find closest structure by Y position
      let closest = null;
      let minDist = 50; // tolerance in PDF units
      for (const [, s] of structures) {
        const dist = Math.abs(s.northing - r.source.y);
        if (dist < minDist) {
          minDist = dist;
          closest = s;
        }
      }
      if (closest) closest.rim = parseFloat(r.fields.value);
    }

    if (r.type === 'invert') {
      let closest = null;
      let minDist = 50;
      for (const [, s] of structures) {
        const dist = Math.abs(s.northing - r.source.y);
        if (dist < minDist) {
          minDist = dist;
          closest = s;
        }
      }
      if (closest) closest.inverts.push(parseFloat(r.fields.value));
    }

    if (r.type === 'station') {
      let closest = null;
      let minDist = 30;
      for (const [, s] of structures) {
        const dist = Math.abs(s.northing - r.source.y);
        if (dist < minDist) {
          minDist = dist;
          closest = s;
        }
      }
      if (closest && !closest.station) closest.station = r.fields.station;
    }
  }

  // ── Generate points for structures ──
  for (const [, s] of structures) {
    // Rim point
    if (s.rim != null) {
      const desc = `${s.id} RIM${s.station ? ' STA ' + s.station : ''}`;
      lines.push(formatPoint(pointNum++, s.northing, s.easting, s.rim, desc, format, delimiter));
    }

    // Invert points
    for (let i = 0; i < s.inverts.length; i++) {
      const invLabel = s.inverts.length === 1 ? 'INV' : (i === 0 ? 'INV-IN' : 'INV-OUT');
      const desc = `${s.id} ${invLabel}${s.station ? ' STA ' + s.station : ''}`;
      lines.push(formatPoint(pointNum++, s.northing, s.easting, s.inverts[i], desc, format, delimiter));
    }

    // If no elevations, still output the structure location
    if (s.rim == null && s.inverts.length === 0) {
      const desc = `${s.id}${s.station ? ' STA ' + s.station : ''}`;
      lines.push(formatPoint(pointNum++, s.northing, s.easting, 0, desc, format, delimiter));
    }
  }

  // ── Generate points for standalone stations with elevations ──
  const stationElevations = [];
  for (const r of records) {
    if (r.type === 'elevation' && r.fields.value) {
      // Check if a station is nearby
      const nearStation = records.find(
        s => s.type === 'station' && Math.abs(s.source.y - r.source.y) < 20
      );
      if (nearStation) {
        stationElevations.push({
          station: nearStation.fields.station,
          elevation: parseFloat(r.fields.value),
          x: r.source.x,
          y: r.source.y,
        });
      }
    }
  }

  for (const se of stationElevations) {
    const desc = `EL STA ${se.station}`;
    lines.push(formatPoint(pointNum++, se.y, se.x, se.elevation, desc, format, delimiter));
  }

  // ── Footer ──
  lines.push('#');
  lines.push(`# Total points: ${pointNum - startPoint}`);

  return lines.join('\n');
}

/**
 * Format a single point line in PNEZD or PENZD format.
 */
function formatPoint(num, northing, easting, elevation, description, format, delimiter) {
  const n = northing.toFixed(3);
  const e = easting.toFixed(3);
  const z = elevation.toFixed(3);
  const d = description.replace(/,/g, ';'); // Clean commas from description

  if (format === 'PENZD') {
    return [num, e, n, z, d].join(delimiter);
  }
  // Default: PNEZD
  return [num, n, e, z, d].join(delimiter);
}

/**
 * Download Civil 3D ASCII point file.
 *
 * @param {Array} records  AEC records from extractAecData()
 * @param {Object} [options]
 */
export function downloadCivil3d(records, options = {}) {
  const content = recordsToCivil3d(records, options);
  if (!content || content.split('\n').length <= 5) {
    alert('No structures or elevations found to export. Extract AEC data first.');
    return;
  }
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = options.filename || 'opencivil-points.csv';
  a.click();
  URL.revokeObjectURL(url);
}
