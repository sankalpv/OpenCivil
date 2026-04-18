// OpenCivil — Spatial Bounding Box Grouper
// Groups AEC records by proximity to create structure-level summaries.
// Clusters text spans that are spatially close on the PDF page into
// "callout blocks", then attaches all data within each block to the
// nearest structure anchor (SDMH, CB, SSMH, etc.).

/**
 * @typedef {Object} StructureBlock
 * @property {string} id          Structure ID (e.g., "SDMH4", "CB", "SSMH")
 * @property {string} type        Structure type (manhole, catchBasin, waterValve)
 * @property {number} page        Page number
 * @property {number} cx          Centroid X of the cluster
 * @property {number} cy          Centroid Y of the cluster
 * @property {string|null} rim    RIM elevation
 * @property {Array} inverts      Array of {elevation, pipeSize, material, direction}
 * @property {string|null} bottom BOTTOM OF STRUCTURE elevation
 * @property {string|null} channel CENTER OF CHANNEL elevation
 * @property {Array} pipes        Pipe info found in this block
 * @property {Array} stations     Stations found near this structure
 * @property {Array} records      All raw AecRecords in this cluster
 */

/**
 * Group AEC records into structure blocks using spatial proximity.
 *
 * Algorithm:
 * 1. Find all "anchor" records (manholes, catch basins, water valves)
 * 2. For each non-anchor record, assign it to the closest anchor within threshold
 * 3. Build a StructureBlock for each anchor with all associated data
 * 4. Remaining unassigned records go into an "ungrouped" list
 *
 * @param {Array} records  AEC records from extractAecData()
 * @param {Object} [options]
 * @param {number} [options.threshold=80]  Max distance (PDF units) to associate a record with an anchor
 * @returns {{ structures: StructureBlock[], ungrouped: Array }}
 */
export function groupByBoundingBox(records, options = {}) {
  const { threshold = 80 } = options;

  // Step 1: Identify anchor records (structures)
  const anchorTypes = new Set(['manhole', 'catchBasin', 'waterValve']);
  const anchors = [];
  const nonAnchors = [];

  for (const r of records) {
    if (anchorTypes.has(r.type)) {
      anchors.push(r);
    } else {
      nonAnchors.push(r);
    }
  }

  // Step 2: Build initial structure blocks from anchors
  // Merge duplicate anchors (same ID on same page)
  const structureMap = new Map(); // key: "id:page" → StructureBlock

  for (const anchor of anchors) {
    const id = anchor.fields.id || anchor.type;
    const page = anchor.source.page;
    const key = `${id}:${page}`;

    if (!structureMap.has(key)) {
      structureMap.set(key, {
        id,
        type: anchor.type,
        page,
        cx: anchor.source.x,
        cy: anchor.source.y,
        rim: null,
        inverts: [],
        bottom: null,
        channel: null,
        pipes: [],
        stations: [],
        topOfNut: null,
        records: [anchor],
      });
    } else {
      structureMap.get(key).records.push(anchor);
    }
  }

  const structures = Array.from(structureMap.values());

  // Step 3: Assign non-anchor records to the nearest structure on the same page
  const ungrouped = [];

  for (const r of nonAnchors) {
    const page = r.source.page;
    const rx = r.source.x;
    const ry = r.source.y;

    // Find closest structure on the same page
    let best = null;
    let bestDist = threshold;

    for (const s of structures) {
      if (s.page !== page) continue;
      const dist = Math.sqrt((rx - s.cx) ** 2 + (ry - s.cy) ** 2);
      if (dist < bestDist) {
        bestDist = dist;
        best = s;
      }
    }

    if (best) {
      best.records.push(r);
      // Attach data to the structure
      switch (r.type) {
        case 'rim':
          best.rim = r.fields.value;
          break;
        case 'invertElevation':
          best.inverts.push({
            elevation: r.fields.elevation,
            pipeSize: r.fields.pipeSize || '',
            material: r.fields.material || '',
            direction: r.fields.direction || '',
            raw: r.fields.raw || '',
          });
          break;
        case 'invertIn':
          best.inverts.push({ elevation: r.fields.value, direction: 'IN', pipeSize: '', material: '' });
          break;
        case 'invertOut':
          best.inverts.push({ elevation: r.fields.value, direction: 'OUT', pipeSize: '', material: '' });
          break;
        case 'bottomOfStructure':
          best.bottom = r.fields.value;
          break;
        case 'centerOfChannel':
          best.channel = r.fields.value;
          break;
        case 'topOfNut':
          best.topOfNut = r.fields.value;
          break;
        case 'station':
          best.stations.push(r.fields.station);
          break;
        case 'pipeSize':
        case 'pipeMaterial':
        case 'pipeRun':
        case 'pipeLength':
        case 'slope':
          best.pipes.push(r);
          break;
      }
    } else {
      ungrouped.push(r);
    }
  }

  return { structures, ungrouped };
}

/**
 * Convert structure blocks to a flat table for display/export.
 * Each invert gets its own row, associated with the parent structure.
 *
 * @param {StructureBlock[]} structures
 * @returns {Array<Object>}
 */
export function structuresToTable(structures) {
  const rows = [];

  for (const s of structures) {
    if (s.inverts.length === 0) {
      // Structure with only RIM/bottom
      rows.push({
        'Structure': s.id,
        'Type': s.type,
        'Page': s.page,
        'RIM': s.rim || '',
        'IE Elev': '',
        'IE Pipe': '',
        'IE Material': '',
        'IE Direction': '',
        'Bottom': s.bottom || '',
        'Channel': s.channel || '',
        'Station': s.stations.join(', ') || '',
      });
    } else {
      // One row per invert
      for (let i = 0; i < s.inverts.length; i++) {
        const inv = s.inverts[i];
        rows.push({
          'Structure': i === 0 ? s.id : '', // Only show structure ID on first row
          'Type': i === 0 ? s.type : '',
          'Page': i === 0 ? s.page : '',
          'RIM': i === 0 ? (s.rim || '') : '',
          'IE Elev': inv.elevation || '',
          'IE Pipe': inv.pipeSize || '',
          'IE Material': inv.material || '',
          'IE Direction': inv.direction || '',
          'Bottom': i === 0 ? (s.bottom || '') : '',
          'Channel': i === 0 ? (s.channel || '') : '',
          'Station': i === 0 ? (s.stations.join(', ') || '') : '',
        });
      }
    }
  }

  return rows;
}

/**
 * Convert structures to CSV.
 */
export function structuresToCsv(structures) {
  const rows = structuresToTable(structures);
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const v = String(row[h] ?? '');
        return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(',')
    ),
  ];
  return lines.join('\n');
}
