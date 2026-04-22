// OpenCivil — LandXML 1.2 Pipe Network Export for Autodesk Civil 3D
// Generates a valid LandXML 1.2 file containing a <PipeNetwork> with
// <Structs> and <Pipes> from extracted AEC data.
//
// Features:
// - Smart real-world coordinate calculation (station + offset + scale)
// - Auto-detects alignment direction from PDF coordinates
// - Falls back gracefully when data is incomplete
//
// Importable into:
// - Autodesk Civil 3D (Import LandXML → Pipe Networks)
// - Bentley OpenRoads / MicroStation (LandXML interchange)
// - Any software that reads LandXML 1.2 pipe networks
//
// Public API (unchanged — callers in AecTab.jsx and AecDataPanel.jsx
// continue to work without modification):
//   export function downloadCivil3d(records, options = {})

// ============================================================
// XML Helpers
// ============================================================

/** Escape XML special characters in attribute values and text. */
function escXml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Format a number to fixed decimal places, defaulting to 3. */
function fmt(val, decimals = 3) {
  const n = parseFloat(val);
  return isNaN(n) ? '0.000' : n.toFixed(decimals);
}

// ============================================================
// Coordinate Calculation — Modular Functions
// ============================================================

/**
 * Parse the drawing scale from scale records.
 * Looks for patterns like 1"=20', 1"=5'.
 * Returns scale factor in feet per inch.
 *
 * @param {Array} records  AEC records
 * @returns {number}  Scale factor (feet per drawing inch). Default 20.
 */
export function parseScaleFactor(records) {
  for (const r of records) {
    if (r.type === 'scale' && r.fields.ratio) {
      // Match patterns: 1"=20', 1"=5', ratio stored as '1"=20''
      const m = r.fields.ratio.match(/1[""]\s*=\s*(\d+(?:\.\d+)?)/);
      if (m) return parseFloat(m[1]);
    }
  }
  return 20; // Default: 1"=20' (common civil engineering scale)
}

/**
 * Convert a station string to numeric feet.
 * Handles formats: "06+68" → 668, "5+36.7" → 536.7, "3901+41.97" → 390141.97
 *
 * @param {string} stationStr  Station string (e.g. "06+68", "5+22.6")
 * @returns {number|null}  Station in feet, or null if unparseable
 */
export function parseStationToFeet(stationStr) {
  if (!stationStr) return null;
  const m = stationStr.match(/(\d+)\+(\d+\.?\d*)/);
  if (!m) return null;
  return parseFloat(m[1]) * 100 + parseFloat(m[2]);
}

/**
 * Parse an offset string into a signed numeric value in feet.
 * RT (right) = positive, LT (left) = negative.
 *
 * @param {string} offsetStr  Offset string (e.g. "40.83 RT", "27.05 LT", "0.00")
 * @returns {number}  Signed offset in feet
 */
export function parseOffset(offsetStr) {
  if (!offsetStr) return 0;
  const s = String(offsetStr).trim();

  // Try "40.83 RT" or "27.05 LT" format
  const m = s.match(/([\d.]+)\s*(RT|LT|R|L)/i);
  if (m) {
    const val = parseFloat(m[1]);
    const side = m[2].toUpperCase();
    return (side === 'LT' || side === 'L') ? -val : val;
  }

  // Just a number (assume RT)
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/**
 * Try to parse explicit N/E coordinates from record source text.
 * Looks for patterns like: "N 551319.36, E 1635183.17"
 *                           "Northing: 551319.36 Easting: 1635183.17"
 *
 * @param {Array} records  AEC records
 * @param {number} y       Y position to search near
 * @param {number} page    Page number
 * @param {number} tol     Y proximity tolerance
 * @returns {{northing: number, easting: number}|null}
 */
function findExplicitCoords(records, y, page, tol = 80) {
  for (const r of records) {
    if (r.source.page !== page) continue;
    if (Math.abs(r.source.y - y) > tol) continue;
    const txt = r.source.text || '';

    // Pattern: N 551319.36, E 1635183.17
    const m1 = txt.match(/N\s+([\d.]+)\s*,?\s*E\s+([\d.]+)/i);
    if (m1) return { northing: parseFloat(m1[1]), easting: parseFloat(m1[2]) };

    // Pattern: Northing: 551319.36 Easting: 1635183.17
    const m2 = txt.match(/Northing\s*[:=]\s*([\d.]+)/i);
    const m3 = txt.match(/Easting\s*[:=]\s*([\d.]+)/i);
    if (m2 && m3) return { northing: parseFloat(m2[1]), easting: parseFloat(m3[1]) };
  }
  return null;
}

/**
 * Auto-detect alignment direction from PDF coordinates of structures.
 * Computes the primary bearing of the alignment by looking at how
 * station values map to x/y changes on the page.
 *
 * Returns a unit direction vector { dx, dy } pointing in the direction
 * of increasing station, and a perpendicular vector { px, py } for offsets
 * (RT = positive perpendicular, LT = negative).
 *
 * @param {Array<{station: number, x: number, y: number}>} points
 *   Sorted by station ascending. x/y are PDF coordinates.
 * @returns {{ dx: number, dy: number, px: number, py: number }}
 */
function detectAlignmentDirection(points) {
  if (points.length < 2) {
    // Default: station runs horizontally (increasing x = increasing station)
    // Northing along station axis, Easting perpendicular
    return { dx: 1, dy: 0, px: 0, py: 1 };
  }

  // Compute weighted average direction vector from consecutive pairs
  let sumDx = 0, sumDy = 0;
  for (let i = 1; i < points.length; i++) {
    const dSta = points[i].station - points[i - 1].station;
    if (dSta <= 0) continue;
    sumDx += (points[i].x - points[i - 1].x);
    sumDy += (points[i].y - points[i - 1].y);
  }

  const mag = Math.sqrt(sumDx * sumDx + sumDy * sumDy);
  if (mag < 1) {
    // Structures are at same position — use default
    return { dx: 1, dy: 0, px: 0, py: 1 };
  }

  // Normalize to unit vector
  const dx = sumDx / mag;
  const dy = sumDy / mag;

  // Perpendicular (rotated 90° clockwise for RT = right side)
  const px = -dy;
  const py = dx;

  return { dx, dy, px, py };
}

/**
 * Calculate real-world survey coordinates for all structures.
 *
 * Priority 1: Explicit N/E coordinates found in record text
 * Priority 2: Station + Offset + Scale (most common)
 * Priority 3: Fallback to scaled PDF coordinates
 *
 * @param {Array} records     AEC records
 * @param {Map} structs       Structure map from buildStructures()
 * @returns {Map<string, {northing: number, easting: number}>}
 */
export function calculateRealWorldCoordinates(records, structs) {
  const coords = new Map();
  const scaleFactor = parseScaleFactor(records);

  // ── Collect structures with stations and PDF positions ──
  const stationedStructs = [];
  for (const [id, s] of structs) {
    const staFeet = parseStationToFeet(s.station);

    // Find offset from stationOffset records near this structure
    let offset = 0;
    for (const r of records) {
      if (r.type === 'stationOffset' && r.source.page === s.page) {
        if (Math.abs(r.source.y - s.northing) < 60) {
          offset = parseOffset(r.fields.offset + ' ' + r.fields.side);
          break;
        }
      }
    }

    stationedStructs.push({
      id,
      station: staFeet,
      offset,
      x: s.easting,   // PDF x
      y: s.northing,   // PDF y
      page: s.page,
    });
  }

  // ── Priority 1: Check for explicit coordinates ──
  let hasExplicit = false;
  for (const ss of stationedStructs) {
    const explicit = findExplicitCoords(records, ss.y, ss.page);
    if (explicit) {
      coords.set(ss.id, explicit);
      hasExplicit = true;
    }
  }
  if (hasExplicit) {
    // Fill in any structures without explicit coords using station deltas
    const withCoords = stationedStructs.filter(ss => coords.has(ss.id) && ss.station !== null);
    if (withCoords.length > 0) {
      const ref = withCoords[0];
      const refCoord = coords.get(ref.id);
      for (const ss of stationedStructs) {
        if (coords.has(ss.id)) continue;
        if (ss.station !== null && ref.station !== null) {
          const delta = ss.station - ref.station;
          coords.set(ss.id, {
            northing: refCoord.northing + delta,
            easting: refCoord.easting + ss.offset,
          });
        } else {
          // Fallback for this struct
          coords.set(ss.id, { northing: ss.y * 10, easting: ss.x * 10 });
        }
      }
    }
    return coords;
  }

  // ── Priority 2: Station + Offset + Scale ──
  const withStations = stationedStructs.filter(ss => ss.station !== null);

  if (withStations.length > 0) {
    // Sort by station ascending
    withStations.sort((a, b) => a.station - b.station);

    // Detect alignment direction from PDF coordinates
    const alignDir = detectAlignmentDirection(withStations);

    // Origin: first structure at 5000, 5000
    const originStation = withStations[0].station;
    const originNorthing = 5000.0;
    const originEasting = 5000.0;

    // Determine which real-world axis corresponds to station
    // If alignment runs mostly horizontal on page (|dx| > |dy|):
    //   station → Easting, offset → Northing
    // If mostly vertical:
    //   station → Northing, offset → Easting
    const horizontal = Math.abs(alignDir.dx) > Math.abs(alignDir.dy);

    for (const ss of stationedStructs) {
      if (ss.station !== null) {
        const deltaFeet = ss.station - originStation;
        const offsetFeet = ss.offset;

        let northing, easting;
        if (horizontal) {
          // Station runs horizontally → maps to Easting
          easting = originEasting + deltaFeet;
          northing = originNorthing + offsetFeet;
        } else {
          // Station runs vertically → maps to Northing
          northing = originNorthing + deltaFeet;
          easting = originEasting + offsetFeet;
        }

        coords.set(ss.id, { northing, easting });
      }
    }

    // Fill in structures without stations using PDF position relative
    // to the nearest stationed structure
    for (const ss of stationedStructs) {
      if (coords.has(ss.id)) continue;

      // Find nearest stationed structure by PDF position
      let nearest = null;
      let nearestDist = Infinity;
      for (const ws of withStations) {
        const d = Math.sqrt((ss.x - ws.x) ** 2 + (ss.y - ws.y) ** 2);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = ws;
        }
      }

      if (nearest && coords.has(nearest.id)) {
        const ref = coords.get(nearest.id);
        // Use PDF delta scaled to real world
        const pdfDx = (ss.x - nearest.x) / 72 * scaleFactor; // 72 pts/inch
        const pdfDy = (ss.y - nearest.y) / 72 * scaleFactor;

        if (horizontal) {
          coords.set(ss.id, {
            northing: ref.northing + pdfDy,
            easting: ref.easting + pdfDx,
          });
        } else {
          coords.set(ss.id, {
            northing: ref.northing + pdfDy,
            easting: ref.easting + pdfDx,
          });
        }
      } else {
        // Pure fallback
        coords.set(ss.id, {
          northing: ss.y / 72 * scaleFactor,
          easting: ss.x / 72 * scaleFactor,
        });
      }
    }

    return coords;
  }

  // ── Priority 3: Fallback — scaled PDF coordinates ──
  for (const ss of stationedStructs) {
    coords.set(ss.id, {
      northing: ss.y / 72 * scaleFactor, // Convert PDF points → inches → feet
      easting: ss.x / 72 * scaleFactor,
    });
  }

  return coords;
}

// ============================================================
// Record Aggregation — Build Structures from Flat Records
// 5-Pass Architecture:
//   Pass 1: Create structure shells from manhole/catchBasin records
//   Pass 1b: Create water valve structures (deduped)
//   Pass 2: Source-text association (same text block = same structure)
//   Pass 3: Station-based matching (bridges plan ↔ profile sections)
//   Pass 4: Expanded proximity with storm-structure priority
//   Pass 5: Calculate real-world coordinates
// ============================================================

/** Check if a structure ID is a "storm structure" (not a water valve). */
function isStormStructure(type) {
  return type === 'manhole' || type === 'catchBasin';
}

/** Normalize a structure ID for fuzzy matching: "SDMH-5" → "SDMH5", "SDMH 5" → "SDMH5" */
function normalizeStructId(id) {
  return (id || '').toUpperCase().replace(/[\s\-#]+/g, '');
}

/** Check if source text contains a reference to a specific structure ID (case-insensitive, tolerant). */
function sourceTextContainsStruct(sourceText, structId) {
  if (!sourceText || !structId) return false;
  const normText = normalizeStructId(sourceText);
  const normId = normalizeStructId(structId);
  return normText.includes(normId);
}

/** Attach a data record to a structure. */
function attachRecordToStruct(s, r) {
  switch (r.type) {
    case 'rim':
      if (s.rim == null) s.rim = parseFloat(r.fields.value);
      break;
    case 'invertElevation':
      s.inverts.push({
        elevation: parseFloat(r.fields.elevation),
        pipeSize: r.fields.pipeSize || '',
        material: r.fields.material || '',
        direction: r.fields.direction || '',
      });
      break;
    case 'bottomOfStructure':
      if (s.bottom == null) s.bottom = parseFloat(r.fields.value);
      break;
    case 'centerOfChannel':
      break; // store if needed
    case 'station':
      if (!s.station) s.station = r.fields.station;
      break;
    case 'stationOffset':
      if (!s.station) s.station = r.fields.station;
      break;
    case 'topOfNut':
      if (s.type === 'waterValve') {
        s.inverts.push({ elevation: parseFloat(r.fields.value), pipeSize: '', material: '', direction: '' });
      }
      break;
    case 'flowLine':
      s.inverts.push({ elevation: parseFloat(r.fields.elevation), pipeSize: '', material: '', direction: '' });
      break;
  }
}

/**
 * Aggregate flat AEC records into rich structure objects.
 * Uses a robust 5-pass architecture that handles plan+profile layouts,
 * WSDOT full-name structures, and mixed AutoCAD drawings.
 *
 * @param {Array} records  AEC records from extractAecData()
 * @returns {Map<string, Object>}  Map of structureId → structure object
 */
function buildStructures(records) {
  const structs = new Map();
  const assigned = new Set(); // Track which record indices have been assigned

  // Helper to create a blank structure
  function makeStruct(id, type, r) {
    return {
      id, type, desc: '',
      rim: null, inverts: [], bottom: null,
      station: null, diameter: null, manholeType: null,
      northing: r.source.y, easting: r.source.x, page: r.source.page,
    };
  }

  // ── Pass 1: Create storm structure shells ──
  for (const r of records) {
    if (r.type === 'manhole' || r.type === 'catchBasin') {
      const id = r.fields.id;
      if (!structs.has(id)) {
        structs.set(id, makeStruct(id, r.type, r));
      }
      const s = structs.get(id);
      if (r.fields.diameter && !s.diameter) s.diameter = r.fields.diameter.replace('"', '');
      if (r.fields.manholeType && !s.manholeType) s.manholeType = r.fields.manholeType;
      if (r.fields.structType && !s.manholeType) s.manholeType = r.fields.structType;
    }
  }

  // ── Pass 1b: Create water valve structures (deduplicated by 40px proximity) ──
  const wvPositions = []; // {y, page, id}
  let wvIdx = 1;
  for (const r of records) {
    if (r.type === 'waterValve') {
      // Check if there's already a WV within 40px on the same page
      const dup = wvPositions.find(p => p.page === r.source.page && Math.abs(p.y - r.source.y) < 40);
      if (!dup) {
        const id = `WV-${wvIdx++}`;
        structs.set(id, makeStruct(id, 'waterValve', r));
        structs.get(id).desc = 'Water Valve';
        wvPositions.push({ y: r.source.y, page: r.source.page, id });
      }
    }
  }

  // ── Pass 2: Source-text association ──
  // If a RIM/IE/bottom record's source text contains a structure name, assign it directly.
  // This handles AI extraction where one text span = "SDMH5 RIM=156.74 IE 8" PVC (N)=142.50..."
  const dataTypes = new Set(['rim', 'invertElevation', 'bottomOfStructure', 'station', 'stationOffset',
    'topOfNut', 'flowLine', 'invertIn', 'invertOut', 'centerOfChannel']);

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!dataTypes.has(r.type)) continue;
    if (assigned.has(i)) continue;

    const srcText = r.source.text || '';

    // Check each storm structure ID in the source text
    for (const [id, s] of structs) {
      if (!isStormStructure(s.type)) continue;
      if (sourceTextContainsStruct(srcText, id)) {
        attachRecordToStruct(s, r);
        assigned.add(i);
        break;
      }
    }
  }

  // ── Pass 3: Station-based matching ──
  // Build station → structureId map from records already assigned or from stationOffset near structures
  const stationToStruct = new Map(); // "6+68" → structId

  // First: assign stations to structures from stationOffset records near them (Y-proximity 80px)
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.type !== 'stationOffset' && r.type !== 'station') continue;
    const sta = r.fields.station;
    if (!sta) continue;

    // Find closest storm structure on same page within 80px
    let bestStruct = null, bestDist = 80;
    for (const [, s] of structs) {
      if (s.page !== r.source.page) continue;
      if (!isStormStructure(s.type)) continue;
      const d = Math.abs(s.northing - r.source.y);
      if (d < bestDist) { bestDist = d; bestStruct = s; }
    }
    if (bestStruct) {
      if (!bestStruct.station) bestStruct.station = sta;
      stationToStruct.set(sta, bestStruct.id);
    }
  }

  // Now: for each unassigned RIM/IE record, find the nearest station record on same page
  // and use that station to look up the structure
  const stationRecords = records.filter(r => r.type === 'station' || r.type === 'stationOffset');

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!dataTypes.has(r.type)) continue;
    if (assigned.has(i)) continue;

    // Find nearest station record on the same page (any Y distance — this bridges plan ↔ profile)
    let nearestSta = null, nearestDist = 120; // 120px tolerance for station matching
    for (const sr of stationRecords) {
      if (sr.source.page !== r.source.page) continue;
      const d = Math.abs(sr.source.y - r.source.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearestSta = sr.fields.station;
      }
    }

    if (nearestSta && stationToStruct.has(nearestSta)) {
      const structId = stationToStruct.get(nearestSta);
      const s = structs.get(structId);
      if (s) {
        attachRecordToStruct(s, r);
        assigned.add(i);
      }
    }
  }

  // ── Pass 4: Expanded proximity with storm-structure priority ──
  // For remaining unassigned records, use expanded 200px tolerance
  // Prefer storm structures over water valves
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!dataTypes.has(r.type)) continue;
    if (assigned.has(i)) continue;

    const page = r.source.page;
    const ry = r.source.y;

    // Find closest storm structure first (200px)
    let best = null, bestDist = 200;
    for (const [, s] of structs) {
      if (s.page !== page) continue;
      const d = Math.abs(s.northing - ry);
      if (d < bestDist) {
        // Prefer storm structures: give them a 50px bonus
        const effectiveDist = isStormStructure(s.type) ? d : d + 50;
        if (effectiveDist < bestDist) {
          bestDist = effectiveDist;
          best = s;
        }
      }
    }

    if (best) {
      attachRecordToStruct(best, r);
      assigned.add(i);
    }
  }

  // ── Pass 5: Calculate real-world coordinates ──
  const coords = calculateRealWorldCoordinates(records, structs);
  for (const [id, coord] of coords) {
    const s = structs.get(id);
    if (s) { s.northing = coord.northing; s.easting = coord.easting; }
  }

  // ── Build description strings ──
  for (const [, s] of structs) {
    const parts = [];
    if (s.diameter) parts.push(`${s.diameter}" Diameter`);
    if (s.manholeType) parts.push(s.manholeType);
    if (s.type === 'manhole') parts.push('Manhole');
    else if (s.type === 'catchBasin') parts.push('Catch Basin');
    else if (s.type === 'waterValve') parts.push('Water Valve');
    s.desc = parts.join(' ') || s.type;
  }

  return structs;
}

// ============================================================
// Record Aggregation — Build Pipes from Flat Records
// ============================================================

/**
 * Simple and reliable buildPipes – Y-position sorting of pipeRun records
 * This matches the natural top-to-bottom order in the profile view.
 */
function buildPipes(records, structs) {
  const pipes = [];

  // Get all pipeRun records
  const pipeRuns = records.filter(r => 
    r.type === 'pipeRun' || 
    (r.sourceText || '').includes('LF') && (r.sourceText || '').includes('PVC')
  );

  if (pipeRuns.length === 0) return pipes;

  // Sort pipeRuns by Y position (profile view: smaller Y = upstream)
  const sortedPipeRuns = [...pipeRuns].sort((a, b) => a.source.y - b.source.y);

  // Get storm structures sorted by station (ascending)
  const stormStructs = [...structs.values()]
    .filter(s => isStormStructure(s.type))
    .map(s => ({
      ...s,
      stationFeet: parseStationToFeet(s.station)
    }))
    .filter(s => s.stationFeet !== null)
    .sort((a, b) => a.stationFeet - b.stationFeet);

  if (stormStructs.length < 2) {
    // Fallback if no stations
    const fallback = [...structs.values()].filter(s => isStormStructure(s.type));
    for (let i = 0; i < sortedPipeRuns.length && i < fallback.length - 1; i++) {
      const pr = sortedPipeRuns[i];
      pipes.push({
        name: `Pipe-${i + 1}`,
        startRef: fallback[i]?.id || '',
        endRef: fallback[i + 1]?.id || '',
        diameter: pr.fields?.size ? pr.fields.size.replace('"', '') : '30',
        material: pr.fields?.material || 'PVC',
        length: pr.fields?.length ? parseFloat(pr.fields.length) : 0,
        slope: parseSlopeToDecimal(pr.fields?.slope),
      });
    }
    return pipes;
  }

  // Assign each pipe to consecutive structure pairs
  for (let i = 0; i < sortedPipeRuns.length && i < stormStructs.length - 1; i++) {
    const pr = sortedPipeRuns[i];
    pipes.push({
      name: `Pipe-${i + 1}`,
      startRef: stormStructs[i].id || stormStructs[i].name,
      endRef: stormStructs[i + 1].id || stormStructs[i + 1].name,
      diameter: pr.fields?.size ? pr.fields.size.replace('"', '') : '30',
      material: pr.fields?.material || 'PVC',
      length: pr.fields?.length ? parseFloat(pr.fields.length) : 0,
      slope: parseSlopeToDecimal(pr.fields?.slope),
    });
  }

  return pipes;
}

/** Parse slope string "6.0%" or "0.5%" → decimal (0.06, 0.005). */
function parseSlopeToDecimal(slope) {
  if (!slope) return 0;
  const s = String(slope).replace('%', '');
  const val = parseFloat(s);
  if (isNaN(val)) return 0;
  return val > 1 ? val / 100 : val;
}

// ============================================================
// LandXML 1.2 Generator
// ============================================================

export function recordsToLandXML(records, options = {}) {
  const {
    projectName = 'Open Civil Studio Export',
    networkName = 'Storm Drain Network',
  } = options;

  const structs = buildStructures(records);
  const pipes = buildPipes(records, structs);

  if (structs.size === 0 && pipes.length === 0) return null;

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 19);

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<!-- Generated by Open Civil Studio / OpenCivil - LandXML Pipe Network Export -->');
  lines.push(`<!-- Date: ${dateStr} ${timeStr} -->`);
  lines.push(`<!-- Structures: ${structs.size}, Pipes: ${pipes.length} -->`);
  lines.push(`<!-- Coordinate method: station+offset+scale (scale=${parseScaleFactor(records)} ft/in) -->`);
  lines.push('<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2"');
  lines.push('         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
  lines.push('         xsi:schemaLocation="http://www.landxml.org/schema/LandXML-1.2 http://www.landxml.org/schema/LandXML-1.2/LandXML-1.2.xsd"');
  lines.push(`         version="1.2" date="${dateStr}" time="${timeStr}">`);

  // ── Units (Imperial) ──
  lines.push('  <Units>');
  lines.push('    <Imperial linearUnit="foot" areaUnit="squareFoot" volumeUnit="cubicFoot"');
  lines.push('             temperatureUnit="fahrenheit" pressureUnit="inchHG"');
  lines.push('             diameterUnit="inch" flowUnit="cubicFeetSecond" />');
  lines.push('  </Units>');

  // ── Project ──
  lines.push(`  <Project name="${escXml(projectName)}" />`);

  // ── Application ──
  lines.push('  <Application name="Open Civil Studio" manufacturer="OpenCivil LLC"');
  lines.push('               version="0.1.0" manufacturerURL="https://oldo.ai" />');

  // ── Pipe Networks ──
  lines.push('  <PipeNetworks>');
  lines.push(`    <PipeNetwork name="${escXml(networkName)}" pipeNetType="Storm">`);

  // ── Structs ──
  lines.push('      <Structs>');
  for (const [, s] of structs) {
    lines.push(`        <Struct name="${escXml(s.id)}" desc="${escXml(s.desc)}">`);

    // CircStruct (diameter if available)
    if (s.diameter) {
      lines.push(`          <CircStruct diameter="${escXml(s.diameter)}" unit="inch" />`);
    }

    // Center (Northing Easting, space-separated) — real-world coordinates
    lines.push(`          <Center>${fmt(s.northing)} ${fmt(s.easting)}</Center>`);

    // RIM as an invert with pipeRef="Rim"
    if (s.rim != null) {
      lines.push(`          <Invert pipeRef="Rim" elev="${fmt(s.rim)}" />`);
    }

    // Inverts from IE records — link to pipes where possible
    for (let i = 0; i < s.inverts.length; i++) {
      const inv = s.inverts[i];
      const pipeRef = findPipeRefForInvert(pipes, s.id, inv) || `Inv-${i + 1}`;
      lines.push(`          <Invert pipeRef="${escXml(pipeRef)}" elev="${fmt(inv.elevation)}" />`);
    }

    // Bottom of structure (sump)
    if (s.bottom != null) {
      lines.push(`          <Invert pipeRef="Sump" elev="${fmt(s.bottom)}" />`);
    }

    lines.push('        </Struct>');
  }
  lines.push('      </Structs>');

  // ── Pipes ──
  lines.push('      <Pipes>');
  for (const p of pipes) {
    const attrs = [`name="${escXml(p.name)}"`];
    if (p.startRef) attrs.push(`startRef="${escXml(p.startRef)}"`);
    if (p.endRef) attrs.push(`endRef="${escXml(p.endRef)}"`);
    if (p.length > 0) attrs.push(`length="${fmt(p.length, 2)}"`);
    if (p.slope > 0) attrs.push(`slope="${fmt(p.slope, 6)}"`);

    lines.push(`        <Pipe ${attrs.join(' ')}>`);
    lines.push(`          <CircPipe diameter="${escXml(p.diameter)}" material="${escXml(p.material)}" unit="inch" />`);
    lines.push('        </Pipe>');
  }
  lines.push('      </Pipes>');

  // ── Close elements ──
  lines.push('    </PipeNetwork>');
  lines.push('  </PipeNetworks>');
  lines.push('</LandXML>');

  return lines.join('\n');
}

/**
 * Find a pipe that connects to a given structure and matches
 * the invert's pipe size. Returns the pipe name or null.
 */
function findPipeRefForInvert(pipes, structId, invert) {
  if (!invert.pipeSize) return null;
  const invSize = invert.pipeSize.replace('"', '');
  for (const p of pipes) {
    if ((p.startRef === structId || p.endRef === structId) && p.diameter === invSize) {
      return p.name;
    }
  }
  return null;
}

// ============================================================
// Download — Public API (unchanged signature)
// ============================================================

/**
 * Download a LandXML 1.2 pipe network file.
 * This is the main export function called by AecTab.jsx and AecDataPanel.jsx.
 *
 * @param {Array} records  AEC records from extractAecData()
 * @param {Object} [options]
 * @param {string} [options.filename]      Output filename
 * @param {string} [options.projectName]   Project name in <Project>
 * @param {string} [options.networkName]   Pipe network name
 */
export function downloadCivil3d(records, options = {}) {
  const xml = recordsToLandXML(records, options);

  if (!xml) {
    alert('No pipe network data found. Extract AEC data first.');
    return;
  }

  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = options.filename || 'PipeNetwork_Extracted.xml';
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// Record Enrichment — Add Coordinates to Flat Records
// ============================================================

/**
 * Enrich every AEC record with real-world Northing/Easting coordinates.
 * Builds structures internally, calculates coordinates using the smart
 * station+offset+scale logic, then attaches coordinates to each record
 * by matching on structure ID.
 *
 * Returns a NEW array (non-mutating) where each record has:
 *   enriched.northing = number | null
 *   enriched.easting  = number | null
 *
 * @param {Array} records  AEC records from extractAecData()
 * @returns {Array}  Enriched records with .northing and .easting
 */
export function enrichRecordsWithCoordinates(records) {
  // Build structures to get the coordinate map
  const structs = buildStructures(records);
  const coordsMap = calculateRealWorldCoordinates(records, structs);

  // Enrich every record (non-mutating)
  return records.map(record => {
    const enriched = { ...record };

    // Try to find coordinate by structure ID
    const id = record.fields?.id || null;
    if (id && coordsMap.has(id)) {
      const coord = coordsMap.get(id);
      enriched.northing = coord.northing;
      enriched.easting = coord.easting;
    } else {
      enriched.northing = null;
      enriched.easting = null;
    }

    return enriched;
  });
}

// ============================================================
// Legacy PNEZD Export (commented out — preserved for reference)
// ============================================================

/*
// Old Civil 3D ASCII point file export.
// Replaced by LandXML pipe network export above.

export function recordsToCivil3d(records, options = {}) {
  const { format = 'PNEZD', delimiter = ',', startPoint = 1 } = options;
  // ... (see git history for full implementation)
}
*/
