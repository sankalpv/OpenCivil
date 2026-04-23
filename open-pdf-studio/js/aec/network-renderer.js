// OpenCivil — Network Overlay Renderer
// Renders the confirmed pipe network on top of the PDF canvas.
// Separate from generic annotation rendering.
//
// - Confirmed structures: green circles with labels
// - Confirmed pipes: green solid lines with length labels
// - Unresolved pipes: orange dashed stubs with warning indicator
// - Selected pipe: red highlight
//
// Called from annotations/rendering.js after annotation drawing.

import {
  networkGraph, selectedPipeId, selectedUnresolvedPipeId,
  selectPipe, selectUnresolvedPipe, clearSelection,
} from '../solid/stores/aecNetworkStore.js';

// ============================================================
// Configuration
// ============================================================

const STRUCT_RADIUS = 8;       // px in app-space
const PIPE_LINE_WIDTH = 3;
const SELECTED_LINE_WIDTH = 5;
const LABEL_FONT = 'bold 10px sans-serif';
const PIPE_LABEL_FONT = '9px sans-serif';

const COLOR_CONFIRMED_STRUCT = '#22c55e';  // green-500
const COLOR_CONFIRMED_PIPE = '#16a34a';    // green-600
const COLOR_UNRESOLVED_PIPE = '#f59e0b';   // amber-500
const COLOR_SELECTED = '#ef4444';          // red-500
const COLOR_LABEL_BG = 'rgba(255,255,255,0.85)';

// ============================================================
// Main Render Function
// ============================================================

/**
 * Render the network overlay on the annotation canvas context.
 * Called after all annotations are drawn, before selection handles.
 *
 * @param {CanvasRenderingContext2D} ctx  Already transformed for zoom/pan
 */
export function renderNetworkOverlay(ctx) {
  const graph = networkGraph();
  if (!graph) return;

  const structures = graph.structureList || [];
  const pipes = graph.pipes || [];
  const unresolvedPipes = graph.unresolvedPipes || [];

  if (structures.length === 0 && pipes.length === 0 && unresolvedPipes.length === 0) return;

  // Build structure position lookup (id → {x, y})
  // Uses PDF source coordinates when valid, falls back to computed layout
  // when positions are unusable (e.g. AI extraction where all x=0)
  const structPos = _buildStructurePositions(structures, graph.allStructureList || structures, ctx);

  const selPipeId = selectedPipeId();
  const selUnresolvedId = selectedUnresolvedPipeId();

  ctx.save();

  // ── Draw confirmed pipes ──
  for (const pipe of pipes) {
    const startPos = structPos.get(pipe.startRef);
    const endPos = structPos.get(pipe.endRef);
    if (!startPos || !endPos) continue;

    const isSelected = (pipe.name === selPipeId || pipe.id === selPipeId);
    const color = isSelected ? COLOR_SELECTED : COLOR_CONFIRMED_PIPE;
    const lw = isSelected ? SELECTED_LINE_WIDTH : PIPE_LINE_WIDTH;

    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(startPos.x, startPos.y);
    ctx.lineTo(endPos.x, endPos.y);
    ctx.stroke();

    // Pipe label at midpoint
    const mx = (startPos.x + endPos.x) / 2;
    const my = (startPos.y + endPos.y) / 2;
    _drawPipeLabel(ctx, mx, my, `${pipe.length} LF`, color);
  }

  // ── Draw unresolved pipes ──
  for (const pipe of unresolvedPipes) {
    const startPos = structPos.get(pipe.startRef);
    const endPos = structPos.get(pipe.endRef);

    const isSelected = (pipe.name === selUnresolvedId || pipe.id === selUnresolvedId);
    const color = isSelected ? COLOR_SELECTED : COLOR_UNRESOLVED_PIPE;
    const lw = isSelected ? SELECTED_LINE_WIDTH : PIPE_LINE_WIDTH;

    if (startPos && endPos) {
      // Draw dashed line between endpoints
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.moveTo(startPos.x, startPos.y);
      ctx.lineTo(endPos.x, endPos.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const mx = (startPos.x + endPos.x) / 2;
      const my = (startPos.y + endPos.y) / 2;
      _drawPipeLabel(ctx, mx, my, `⚠ ${pipe.length} LF (unresolved)`, color);
    } else {
      // No valid endpoints — draw a floating label near the first available structure
      const anyPos = startPos || endPos || (structures.length > 0 ? structPos.get(structures[0].id) : null);
      if (anyPos) {
        _drawPipeLabel(ctx, anyPos.x + 20, anyPos.y + 20, `⚠ ${pipe.length} LF (unresolved)`, color);
      }
    }
  }

  // ── Draw structures (on top of pipes) ──
  for (const s of structures) {
    const pos = structPos.get(s.id);
    if (!pos) continue;

    ctx.fillStyle = COLOR_CONFIRMED_STRUCT;
    ctx.strokeStyle = '#166534'; // green-800
    ctx.lineWidth = 2;
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, STRUCT_RADIUS, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();

    // Structure label
    ctx.font = LABEL_FONT;
    const labelW = ctx.measureText(s.id).width + 6;
    ctx.fillStyle = COLOR_LABEL_BG;
    ctx.fillRect(pos.x - labelW / 2, pos.y - STRUCT_RADIUS - 16, labelW, 14);
    ctx.fillStyle = '#166534';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.id, pos.x, pos.y - STRUCT_RADIUS - 9);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

// ============================================================
// Pipe Label Helper
// ============================================================

function _drawPipeLabel(ctx, x, y, text, color) {
  ctx.font = PIPE_LABEL_FONT;
  const w = ctx.measureText(text).width + 6;
  ctx.fillStyle = COLOR_LABEL_BG;
  ctx.fillRect(x - w / 2, y - 6, w, 12);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ============================================================
// Structure Position Builder (with fallback for bad coordinates)
// ============================================================

/**
 * Build display-only positions for structures.
 * Uses real PDF source coordinates when valid. Falls back to a computed
 * layout when positions are unusable (e.g. AI extraction where all x=0).
 *
 * @param {Array} structures      Export-relevant structures
 * @param {Array} allStructures   All extracted structures
 * @param {CanvasRenderingContext2D} [ctx]  For reading canvas dimensions
 * @returns {Map<string, {x: number, y: number}>}
 */
function _buildStructurePositions(structures, allStructures, ctx) {
  const structPos = new Map();

  // First, collect raw positions
  const rawPositions = [];
  for (const s of structures) {
    rawPositions.push({ id: s.id, x: s.easting || 0, y: s.northing || 0, struct: s });
  }
  for (const s of allStructures) {
    if (!structPos.has(s.id) && !rawPositions.find(p => p.id === s.id)) {
      rawPositions.push({ id: s.id, x: s.easting || 0, y: s.northing || 0, struct: s });
    }
  }

  // Check if positions are usable: spread must be > 50px in at least one axis
  const xs = rawPositions.map(p => p.x);
  const ys = rawPositions.map(p => p.y);
  const xSpread = Math.max(...xs) - Math.min(...xs);
  const ySpread = Math.max(...ys) - Math.min(...ys);
  const positionsValid = (xSpread > 50 || ySpread > 50) && Math.max(...xs) > 10;

  if (positionsValid) {
    // Use real coordinates
    for (const p of rawPositions) {
      structPos.set(p.id, { x: p.x, y: p.y });
    }
  } else {
    // ── Fallback: compute display layout across visible page area ──
    console.log('[network-renderer] Using fallback layout — source coordinates unusable');

    // Get canvas dimensions from the context (app-space)
    let pageW = 800, pageH = 600;
    if (ctx && ctx.canvas) {
      // The canvas is DPR-scaled; use CSS dimensions or a reasonable estimate
      const canvas = ctx.canvas;
      const dpr = window.devicePixelRatio || 1;
      pageW = canvas.width / dpr;
      pageH = canvas.height / dpr;
    }

    // Sort structures by station (if available) or by ID for stable ordering
    const sorted = [...rawPositions].sort((a, b) => {
      const staA = a.struct?.station || '';
      const staB = b.struct?.station || '';
      if (staA && staB) return staB.localeCompare(staA); // descending station = upstream first
      return a.id.localeCompare(b.id);
    });

    // Place structures along a diagonal from upper-right to lower-left
    // This mimics typical plan/profile layout (high station = top-right)
    const margin = 80;
    const usableW = pageW - margin * 2;
    const usableH = pageH * 0.4; // Use middle 40% of page height
    const startY = pageH * 0.3;  // Start at 30% from top

    for (let i = 0; i < sorted.length; i++) {
      const t = sorted.length > 1 ? i / (sorted.length - 1) : 0.5;
      const fx = margin + usableW * (1 - t); // Right to left (upstream → downstream)
      const fy = startY + usableH * t;        // Top to bottom
      structPos.set(sorted[i].id, { x: fx, y: fy });
    }
  }

  return structPos;
}

// ============================================================
// Click Hit-Test
// ============================================================

/**
 * Test if a click at (x, y) in app-space hits a network pipe.
 * Returns true if a pipe was selected, false otherwise.
 *
 * @param {number} x  App-space X
 * @param {number} y  App-space Y
 * @param {number} [threshold=12]  Hit distance in px
 * @returns {boolean}
 */
export function handleNetworkClick(x, y, threshold = 12) {
  const graph = networkGraph();
  if (!graph) return false;

  const structures = graph.structureList || [];
  const pipes = graph.pipes || [];
  const unresolvedPipes = graph.unresolvedPipes || [];

  // Build position map using same logic as renderer (including fallback)
  const structPos = _buildStructurePositions(structures, graph.allStructureList || structures, null);

  // Check confirmed pipes first
  for (const pipe of pipes) {
    const a = structPos.get(pipe.startRef);
    const b = structPos.get(pipe.endRef);
    if (!a || !b) continue;

    const dist = _pointToSegmentDist(x, y, a.x, a.y, b.x, b.y);
    if (dist < threshold) {
      selectPipe(pipe.name || pipe.id);
      return true;
    }
  }

  // Check unresolved pipes
  for (const pipe of unresolvedPipes) {
    const a = structPos.get(pipe.startRef);
    const b = structPos.get(pipe.endRef);
    if (!a || !b) continue;

    const dist = _pointToSegmentDist(x, y, a.x, a.y, b.x, b.y);
    if (dist < threshold) {
      selectUnresolvedPipe(pipe.name || pipe.id);
      return true;
    }
  }

  // No hit — clear selection
  clearSelection();
  return false;
}

/** Point-to-line-segment distance. */
function _pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);

  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}
