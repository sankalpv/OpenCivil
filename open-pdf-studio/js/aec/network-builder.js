// OpenCivil — Storm Pipe Network Builder v3 (Trunk-First Solver)
//
// Architecture:
//   Stage 1: Solve primary trunk topology (SDMH node ordering)
//   Stage 2: Assign confident long pipe runs (mismatch ≤ 40ft)
//   Stage 3: Assign short pipe runs (< 20 LF)
//   Stage 4: Fallback for unresolved long pipes (scored candidates)
//
// Confidence tiers:
//   'confident'  — mismatch ≤ CONFIDENT_THRESHOLD (40 ft)
//   'heuristic'  — mismatch 40–100 ft
//   'unresolved' — mismatch > 100 ft (warning emitted)
//
// Key fix: the trunk topology is locked BEFORE pipe runs are assigned,
// preventing long pipes from bypassing intermediate primary manholes.
//
// Public API:
//   buildConfirmedNetwork(records) → { structures, allStructures, pipes, errors }

import { parseStationToFeet, parseScaleFactor } from './civil3d-export.js';

// ============================================================
// Configuration
// ============================================================

const CONFIDENT_THRESHOLD = 40;   // ft — confident assignment
const HEURISTIC_THRESHOLD = 100;  // ft — heuristic (above = unresolved)
const SHORT_PIPE_THRESHOLD = 20;  // LF — below this = short pipe
const BYPASS_PENALTY = 800;       // score penalty for skipping intermediate primary node

// ============================================================
// Helpers
// ============================================================

function _isPrimaryStormNode(struct) {
  return struct && /^SDMH/i.test(struct.id || '');
}

function _isCatchBasin(struct) {
  return struct && (struct.type === 'catchBasin' || /^(SD)?CB/i.test(struct.id || ''));
}

function structurePriority(struct) {
  if (!struct || !struct.id) return 100;
  const id = struct.id.toUpperCase();
  if (/^SDMH/.test(id)) return 0;
  if (/^STMH/.test(id)) return 1;
  if (/^SSMH/.test(id)) return 2;
  if (/^MH/.test(id)) return 3;
  if (/^CB/.test(id)) return 10;
  return 50;
}

function _parseSlopeToDecimal(slope) {
  if (!slope) return 0;
  const s = String(slope).replace('%', '');
  const val = parseFloat(s);
  if (isNaN(val)) return 0;
  return val > 1 ? val / 100 : val;
}

// ============================================================
// Step 1 — Extract Storm Structures
// ============================================================

export function extractStormStructures(records) {
  const structs = new Map();
  const assigned = new Set();

  for (const r of records) {
    if (r.type !== 'manhole' && r.type !== 'catchBasin') continue;
    const id = r.fields.id;
    if (!structs.has(id)) {
      structs.set(id, {
        id, type: r.type, desc: '', rim: null, inverts: [], bottom: null,
        station: null, diameter: null, manholeType: null,
        northing: r.source.y, easting: r.source.x, page: r.source.page,
        sourceX: r.source.x, sourceY: r.source.y, // Preserve original PDF page coords for rendering
      });
    }
    const s = structs.get(id);
    if (r.fields.diameter && !s.diameter) s.diameter = r.fields.diameter.replace('"', '');
    if (r.fields.manholeType && !s.manholeType) s.manholeType = r.fields.manholeType;
    if (r.fields.structType && !s.manholeType) s.manholeType = r.fields.structType;
  }

  // Pass 2–4: attach data records (source-text, station, proximity)
  const dataTypes = new Set([
    'rim', 'invertElevation', 'bottomOfStructure', 'station', 'stationOffset',
    'flowLine', 'invertIn', 'invertOut', 'centerOfChannel',
  ]);

  // Pass 2: source-text
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!dataTypes.has(r.type) || assigned.has(i)) continue;
    const srcText = (r.source.text || '').toUpperCase().replace(/[\s\-#]+/g, '');
    for (const [id, s] of structs) {
      if (srcText.includes(id.toUpperCase().replace(/[\s\-#]+/g, ''))) {
        _attachRecord(s, r); assigned.add(i); break;
      }
    }
  }

  // Pass 3: station-based
  const stationToStruct = new Map();
  for (const r of records) {
    if (r.type !== 'stationOffset' && r.type !== 'station') continue;
    const sta = r.fields.station; if (!sta) continue;
    let bestStruct = null, bestDist = 80;
    for (const [, s] of structs) {
      if (s.page !== r.source.page) continue;
      const d = Math.abs(s.northing - r.source.y);
      if (d < bestDist) { bestDist = d; bestStruct = s; }
    }
    if (bestStruct) {
      if (!bestStruct.station) bestStruct.station = sta;
      stationToStruct.set(sta, bestStruct.id);
    }
  }
  const stationRecords = records.filter(r => r.type === 'station' || r.type === 'stationOffset');
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!dataTypes.has(r.type) || assigned.has(i)) continue;
    let nearestSta = null, nearestDist = 120;
    for (const sr of stationRecords) {
      if (sr.source.page !== r.source.page) continue;
      const d = Math.abs(sr.source.y - r.source.y);
      if (d < nearestDist) { nearestDist = d; nearestSta = sr.fields.station; }
    }
    if (nearestSta && stationToStruct.has(nearestSta)) {
      const s = structs.get(stationToStruct.get(nearestSta));
      if (s) { _attachRecord(s, r); assigned.add(i); }
    }
  }

  // Pass 4: proximity
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!dataTypes.has(r.type) || assigned.has(i)) continue;
    let best = null, bestDist = 200;
    for (const [, s] of structs) {
      if (s.page !== r.source.page) continue;
      const d = Math.abs(s.northing - r.source.y);
      if (d < bestDist) { bestDist = d; best = s; }
    }
    if (best) { _attachRecord(best, r); assigned.add(i); }
  }

  // Descriptions
  for (const [, s] of structs) {
    const parts = [];
    if (s.diameter) parts.push(`${s.diameter}" Diameter`);
    if (s.manholeType) parts.push(s.manholeType);
    if (s.type === 'manhole') parts.push('Manhole');
    else if (s.type === 'catchBasin') parts.push('Catch Basin');
    s.desc = parts.join(' ') || s.type;
  }
  return structs;
}

function _attachRecord(s, r) {
  switch (r.type) {
    case 'rim': if (s.rim == null) s.rim = parseFloat(r.fields.value); break;
    case 'invertElevation':
      s.inverts.push({ elevation: parseFloat(r.fields.elevation), pipeSize: r.fields.pipeSize || '', material: r.fields.material || '', direction: r.fields.direction || '' });
      break;
    case 'bottomOfStructure': if (s.bottom == null) s.bottom = parseFloat(r.fields.value); break;
    case 'station': if (!s.station) s.station = r.fields.station; break;
    case 'stationOffset': if (!s.station) s.station = r.fields.station; break;
    case 'flowLine':
      s.inverts.push({ elevation: parseFloat(r.fields.elevation), pipeSize: '', material: '', direction: '' });
      break;
    case 'invertIn':
      s.inverts.push({ elevation: parseFloat(r.fields.value), pipeSize: '', material: '', direction: 'IN' });
      break;
    case 'invertOut':
      s.inverts.push({ elevation: parseFloat(r.fields.value), pipeSize: '', material: '', direction: 'OUT' });
      break;
  }
}

// ============================================================
// Step 2 — Extract Pipe Runs
// ============================================================

export function extractPipeRuns(records) {
  const runs = [];
  let idx = 0;
  for (const r of records) {
    if (r.type !== 'pipeRun') continue;
    idx++;
    const lengthStr = (r.fields.length || '').replace(/\s*LF\s*/i, '');
    const length = parseFloat(lengthStr) || 0;
    if (length <= 0) continue;
    runs.push({
      id: `PR-${idx}`, length,
      diameter: (r.fields.size || '30"').replace('"', ''),
      material: r.fields.material || 'PVC',
      slope: _parseSlopeToDecimal(r.fields.slope),
      y: r.source.y, x: r.source.x, page: r.source.page,
      sourceText: r.source.text || '',
    });
  }
  return runs;
}

// ============================================================
// Stage 1 — Solve Primary Trunk Topology
// ============================================================

/**
 * Get primary SDMH nodes ordered by station (descending = upstream first).
 * Returns array of { id, stationFeet } sorted high→low.
 */
function getOrderedPrimaryNodes(structures) {
  const nodes = [];
  for (const [id, s] of structures) {
    if (!_isPrimaryStormNode(s)) continue;
    const sta = parseStationToFeet(s.station);
    if (sta !== null) {
      nodes.push({ id, stationFeet: sta, struct: s });
    }
  }
  // Sort descending by station (upstream → downstream)
  nodes.sort((a, b) => b.stationFeet - a.stationFeet);
  return nodes;
}

/**
 * Create trunk edges between consecutive primary nodes.
 * Each edge: { startRef, endRef, stationDelta }
 */
function solvePrimaryTrunk(structures) {
  const ordered = getOrderedPrimaryNodes(structures);
  const edges = [];

  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i];     // upstream
    const b = ordered[i + 1]; // downstream
    edges.push({
      startRef: a.id,
      endRef: b.id,
      stationDelta: Math.abs(a.stationFeet - b.stationFeet),
    });
  }

  console.log(`[network-builder] Trunk topology: ${ordered.map(n => n.id).join(' → ')}`);
  for (const e of edges) {
    console.log(`  trunk edge: ${e.startRef} → ${e.endRef} (Δ${e.stationDelta.toFixed(1)} ft)`);
  }

  return { orderedNodes: ordered, edges };
}

// ============================================================
// Stage 2 — Assign Confident Long Pipe Runs to Trunk Edges
// ============================================================

/**
 * Match long pipe runs (≥20 LF) to trunk edges by best fit.
 * Only assigns if mismatch ≤ CONFIDENT_THRESHOLD.
 *
 * Returns { assigned: [...], unassigned: [...] }
 */
function assignLongPipeRunsToTrunkEdges(pipeRuns, trunkEdges) {
  const longPipes = pipeRuns.filter(p => p.length >= SHORT_PIPE_THRESHOLD);
  const assigned = [];
  const usedEdges = new Set();    // edge index
  const usedPipes = new Set();    // pipe id

  // Build match matrix: for each pipe×edge, compute mismatch
  const matches = [];
  for (const pipe of longPipes) {
    for (let ei = 0; ei < trunkEdges.length; ei++) {
      const edge = trunkEdges[ei];
      const mismatch = Math.abs(pipe.length - edge.stationDelta);
      matches.push({ pipe, edgeIdx: ei, edge, mismatch });
    }
  }

  // Sort by mismatch ascending — best fits first
  matches.sort((a, b) => a.mismatch - b.mismatch);

  // Greedy: assign best fits, one pipe per edge, one edge per pipe
  for (const m of matches) {
    if (usedPipes.has(m.pipe.id) || usedEdges.has(m.edgeIdx)) continue;
    if (m.mismatch > CONFIDENT_THRESHOLD) continue; // not confident

    assigned.push({
      pipe: m.pipe,
      edge: m.edge,
      mismatch: m.mismatch,
      confidence: 'confident',
    });
    usedPipes.add(m.pipe.id);
    usedEdges.add(m.edgeIdx);
  }

  const unassigned = longPipes.filter(p => !usedPipes.has(p.id));
  return { assigned, unassigned };
}

// ============================================================
// Stage 3 — Assign Short Pipe Runs
// ============================================================

/**
 * Assign short pipes (<20 LF) to the best local trunk edge.
 * Short pipes do not have a mismatch threshold — they attach locally.
 */
function assignShortPipeRuns(pipeRuns, trunkEdges, structures) {
  const shortPipes = pipeRuns.filter(p => p.length < SHORT_PIPE_THRESHOLD);
  const assigned = [];

  for (const pipe of shortPipes) {
    let bestEdge = null, bestMismatch = Infinity;

    for (const edge of trunkEdges) {
      const mismatch = Math.abs(pipe.length - edge.stationDelta);
      if (mismatch < bestMismatch) {
        bestMismatch = mismatch;
        bestEdge = edge;
      }
    }

    if (bestEdge) {
      assigned.push({
        pipe,
        edge: bestEdge,
        mismatch: bestMismatch,
        confidence: bestMismatch <= CONFIDENT_THRESHOLD ? 'confident' : 'heuristic',
      });
    }
  }

  return assigned;
}

// ============================================================
// Stage 4 — Fallback for Unresolved Long Pipes
// ============================================================

/**
 * For long pipes that couldn't be confidently assigned to a trunk edge,
 * use scored candidate system with bypass penalty as fallback.
 *
 * Assigns confidence based on mismatch:
 *   40–100 ft → 'heuristic'
 *   >100 ft   → 'unresolved'
 */
function assignUnresolvedLongPipes(unassignedPipes, trunkEdges, structures) {
  const assigned = [];

  // Pre-compute structure list for candidate scoring
  const structList = [];
  for (const [id, s] of structures) {
    structList.push({
      id,
      stationFeet: parseStationToFeet(s.station),
      y: s.northing, x: s.easting, page: s.page,
      priority: structurePriority(s),
      isCB: _isCatchBasin(s),
    });
  }

  // Primary nodes for bypass detection
  const primaryNodes = structList
    .filter(s => s.stationFeet !== null && /^SDMH/i.test(s.id))
    .sort((a, b) => b.stationFeet - a.stationFeet);

  for (const pipe of unassignedPipes) {
    const candidates = [];

    for (let i = 0; i < structList.length; i++) {
      for (let j = 0; j < structList.length; j++) {
        if (i === j) continue;
        const a = structList[i], b = structList[j];
        let score = 0;

        // Factor 1: Length vs station delta
        if (a.stationFeet !== null && b.stationFeet !== null) {
          score += Math.abs(pipe.length - Math.abs(b.stationFeet - a.stationFeet));
        } else {
          const pdfDist = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) * 0.28;
          score += Math.abs(pipe.length - pdfDist) * 1.5;
        }

        // Factor 2: Structure priority
        score += a.priority * 25 + b.priority * 25;

        // Factor 3: Long pipe + CB penalty
        if (pipe.length > 50) {
          if (a.isCB) score += 1000;
          if (b.isCB) score += 1000;
        }

        // Factor 4: Bypass intermediate primary node penalty
        if (pipe.length >= SHORT_PIPE_THRESHOLD &&
            a.stationFeet !== null && b.stationFeet !== null) {
          const staMin = Math.min(a.stationFeet, b.stationFeet);
          const staMax = Math.max(a.stationFeet, b.stationFeet);
          for (const pn of primaryNodes) {
            if (pn.id === a.id || pn.id === b.id) continue;
            if (pn.stationFeet > staMin && pn.stationFeet < staMax) {
              score += BYPASS_PENALTY;
              break;
            }
          }
        }

        // Factor 5: Page proximity
        if (a.page !== pipe.page) score += 100;
        if (b.page !== pipe.page) score += 100;

        candidates.push({ startRef: a.id, endRef: b.id, score });
      }
    }

    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0];

    if (best) {
      // Compute actual mismatch for confidence classification
      const aStation = structList.find(s => s.id === best.startRef)?.stationFeet;
      const bStation = structList.find(s => s.id === best.endRef)?.stationFeet;
      const mismatch = (aStation !== null && bStation !== null)
        ? Math.abs(pipe.length - Math.abs(bStation - aStation))
        : 999;

      let confidence;
      if (mismatch <= CONFIDENT_THRESHOLD) confidence = 'confident';
      else if (mismatch <= HEURISTIC_THRESHOLD) confidence = 'heuristic';
      else confidence = 'unresolved';

      assigned.push({
        pipe,
        edge: { startRef: best.startRef, endRef: best.endRef, stationDelta: null },
        mismatch,
        confidence,
      });
    }
  }

  return assigned;
}

// ============================================================
// Build Confirmed Pipes from Assignments
// ============================================================

function buildConfirmedPipes(allAssignments) {
  const pipes = [];           // confident + heuristic — safe to export
  const unresolvedPipes = []; // unresolved — NOT safe to export as normal edges

  // Sort: confident first, then by length descending
  const sorted = [...allAssignments].sort((a, b) => {
    const confOrder = { confident: 0, heuristic: 1, unresolved: 2 };
    const ca = confOrder[a.confidence] ?? 2;
    const cb = confOrder[b.confidence] ?? 2;
    if (ca !== cb) return ca - cb;
    return b.pipe.length - a.pipe.length;
  });

  let pipeIdx = 0;
  let unresolvedIdx = 0;

  for (const a of sorted) {
    const entry = {
      id: a.pipe.id,
      startRef: a.edge.startRef,
      endRef: a.edge.endRef,
      length: a.pipe.length,
      diameter: a.pipe.diameter,
      material: a.pipe.material,
      slope: a.pipe.slope,
      confidence: a.confidence,
      mismatch: a.mismatch,
    };

    if (a.confidence === 'unresolved') {
      unresolvedIdx++;
      entry.name = `Unresolved-${unresolvedIdx}`;
      entry.warning = `Extreme mismatch (${a.mismatch.toFixed(1)} ft) — likely extends off-sheet or requires multi-sheet context`;
      unresolvedPipes.push(entry);
    } else {
      pipeIdx++;
      entry.name = `Pipe-${pipeIdx}`;
      pipes.push(entry);
    }
  }

  return { pipes, unresolvedPipes };
}

// ============================================================
// Validate
// ============================================================

function validateNetwork(structures, pipes) {
  const errors = [];

  for (const [id, s] of structures) {
    if (s.type === 'waterValve') errors.push(`Water valve "${id}" in network`);
  }
  for (const p of pipes) {
    if (!p.startRef) errors.push(`Pipe "${p.name}" missing startRef`);
    if (!p.endRef) errors.push(`Pipe "${p.name}" missing endRef`);
    if (p.startRef && !structures.has(p.startRef))
      errors.push(`Pipe "${p.name}" startRef "${p.startRef}" not in structures`);
    if (p.endRef && !structures.has(p.endRef))
      errors.push(`Pipe "${p.name}" endRef "${p.endRef}" not in structures`);

    // Confidence warnings
    if (p.confidence === 'heuristic') {
      errors.push(`Pipe "${p.name}" (${p.length} LF) assignment is heuristic — mismatch ${p.mismatch.toFixed(1)} ft`);
    }
    if (p.confidence === 'unresolved') {
      errors.push(`Pipe "${p.name}" (${p.length} LF) assignment is unresolved — mismatch ${p.mismatch.toFixed(1)} ft (may extend off-sheet)`);
    }
  }
  if (pipes.length === 0) errors.push('No pipes found in network');
  if (structures.size < 2) errors.push(`Only ${structures.size} structure(s) — need ≥2`);

  return errors;
}

// ============================================================
// Trim to Export Structures
// ============================================================

function trimToExportStructures(allStructures, pipes) {
  const usedIds = new Set();
  for (const p of pipes) {
    if (p.startRef) usedIds.add(p.startRef);
    if (p.endRef) usedIds.add(p.endRef);
  }
  const trimmed = new Map();
  for (const [id, s] of allStructures) {
    if (usedIds.has(id)) trimmed.set(id, s);
  }
  return trimmed;
}

// ============================================================
// Main Entry Point
// ============================================================

/**
 * Build a confirmed storm pipe network from flat AEC records.
 *
 * Uses a trunk-first solver:
 *   1. Solve primary trunk topology (SDMH node ordering)
 *   2. Assign confident long pipe runs (mismatch ≤ 40ft)
 *   3. Assign short pipe runs
 *   4. Fallback for unresolved long pipes
 *
 * @param {Array} records
 * @returns {{ structures, allStructures, pipes, errors }}
 */
export function buildConfirmedNetwork(records) {
  // Extract structures and pipe runs
  const allStructures = extractStormStructures(records);
  const pipeRuns = extractPipeRuns(records);

  // Stage 1: Solve primary trunk topology
  const trunk = solvePrimaryTrunk(allStructures);

  let allAssignments;

  if (trunk.edges.length > 0) {
    // ── Normal path: trunk edges available (station data present) ──

    // Stage 2: Assign confident long pipe runs to trunk edges
    const longResult = assignLongPipeRunsToTrunkEdges(pipeRuns, trunk.edges);

    console.log(`[network-builder] Stage 2: ${longResult.assigned.length} confident, ${longResult.unassigned.length} unassigned long pipes`);
    for (const a of longResult.assigned) {
      console.log(`  ✓ ${a.pipe.length} LF → ${a.edge.startRef}→${a.edge.endRef} (mismatch ${a.mismatch.toFixed(1)}, ${a.confidence})`);
    }

    // Stage 3: Assign short pipe runs
    const shortResult = assignShortPipeRuns(pipeRuns, trunk.edges, allStructures);

    console.log(`[network-builder] Stage 3: ${shortResult.length} short pipes assigned`);
    for (const a of shortResult) {
      console.log(`  ✓ ${a.pipe.length} LF → ${a.edge.startRef}→${a.edge.endRef} (mismatch ${a.mismatch.toFixed(1)}, ${a.confidence})`);
    }

    // Stage 4: Fallback for unresolved long pipes
    const fallbackResult = assignUnresolvedLongPipes(longResult.unassigned, trunk.edges, allStructures);

    console.log(`[network-builder] Stage 4: ${fallbackResult.length} fallback assignments`);
    for (const a of fallbackResult) {
      console.log(`  ⚠ ${a.pipe.length} LF → ${a.edge.startRef}→${a.edge.endRef} (mismatch ${a.mismatch.toFixed(1)}, ${a.confidence})`);
    }

    allAssignments = [...longResult.assigned, ...shortResult, ...fallbackResult];
  } else {
    // ── Fallback path: no trunk edges (no station data — e.g. AI extraction) ──
    // Use scored-candidate approach for ALL pipe runs directly
    console.warn('[network-builder] No trunk edges (missing station data) — using fallback scored-candidate assignment');

    const fallbackAll = assignUnresolvedLongPipes(pipeRuns, [], allStructures);

    console.log(`[network-builder] Fallback: ${fallbackAll.length} assignments via scored candidates`);
    for (const a of fallbackAll) {
      console.log(`  ~ ${a.pipe.length} LF → ${a.edge.startRef}→${a.edge.endRef} (mismatch ${a.mismatch.toFixed(1)}, ${a.confidence})`);
    }

    allAssignments = fallbackAll;
  }

  // Combine all assignments and split into exportable vs unresolved
  const { pipes, unresolvedPipes } = buildConfirmedPipes(allAssignments);

  // Trim structures to only those used by exportable pipes
  const structures = trimToExportStructures(allStructures, pipes);

  // Validate exportable pipes only
  const errors = validateNetwork(structures, pipes);

  // Add warnings for unresolved pipes
  for (const u of unresolvedPipes) {
    errors.push(`${u.name} (${u.length} LF): ${u.warning}`);
  }

  if (errors.length > 0) {
    console.warn('[network-builder] Validation warnings:', errors);
  }

  // Summary
  console.log(`[network-builder] Final: ${structures.size} structures, ${pipes.length} exportable pipes, ${unresolvedPipes.length} unresolved`);
  for (const p of pipes) {
    console.log(`  ${p.name}: ${p.startRef} → ${p.endRef} (${p.length} LF, ${p.confidence})`);
  }
  for (const u of unresolvedPipes) {
    console.log(`  ⚠ ${u.name}: ${u.length} LF — ${u.warning}`);
  }
  for (const [id] of allStructures) {
    if (!structures.has(id)) console.log(`  [excluded] ${id}`);
  }

  return { structures, allStructures, pipes, unresolvedPipes, errors };
}
