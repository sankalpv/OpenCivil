// OpenCivil — Network Overlay Renderer v2
// Renders the confirmed pipe network on top of the PDF canvas.
//
// Coordinate priority for structure display positions:
//   1. sourceX/sourceY  (original PDF page coords — best)
//   2. pdfX/pdfY or pageX/pageY (alternative names)
//   3. Fallback schematic layout (when all coords are unusable)
//
// Does NOT use easting/northing (those are export/local-grid coordinates).
//
// Rendering:
//   - Confirmed structures: green circles with labels
//   - Confirmed pipes: green solid lines with length labels
//   - Unresolved pipes: orange dashed STUBS (not full lines) with floating labels
//   - Selected pipe: red highlight

import {
  networkGraph, selectedPipeId, selectedUnresolvedPipeId,
  selectPipe, selectUnresolvedPipe, clearSelection,
} from '../solid/stores/aecNetworkStore.js';

// ============================================================
// Configuration
// ============================================================

const STRUCT_RADIUS = 8;
const PIPE_LINE_WIDTH = 3;
const SELECTED_LINE_WIDTH = 5;
const LABEL_FONT = 'bold 10px sans-serif';
const PIPE_LABEL_FONT = '9px sans-serif';
const STUB_LENGTH = 40; // px for unresolved pipe stubs

const COLOR_CONFIRMED_STRUCT = '#22c55e';
const COLOR_CONFIRMED_PIPE = '#16a34a';
const COLOR_UNRESOLVED_PIPE = '#f59e0b';
const COLOR_SELECTED = '#ef4444';
const COLOR_LABEL_BG = 'rgba(255,255,255,0.85)';

// ============================================================
// Main Render Function
// ============================================================

export function renderNetworkOverlay(ctx) {
  const graph = networkGraph();
  if (!graph) return;

  const structures = graph.structureList || [];
  const pipes = graph.pipes || [];
  const unresolvedPipes = graph.unresolvedPipes || [];

  if (structures.length === 0 && pipes.length === 0 && unresolvedPipes.length === 0) return;

  const structPos = _buildStructurePositions(structures, graph.allStructureList || structures, ctx);

  const selPipeId = selectedPipeId();
  const selUnresolvedId = selectedUnresolvedPipeId();

  ctx.save();

  // ── Draw confirmed pipes (solid green lines) ──
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

    const mx = (startPos.x + endPos.x) / 2;
    const my = (startPos.y + endPos.y) / 2;
    _drawPipeLabel(ctx, mx, my, `${pipe.length} LF`, color);
  }

  // ── Draw unresolved pipes as STUBS (not full lines) ──
  for (const pipe of unresolvedPipes) {
    const isSelected = (pipe.name === selUnresolvedId || pipe.id === selUnresolvedId);
    const color = isSelected ? COLOR_SELECTED : COLOR_UNRESOLVED_PIPE;
    const lw = isSelected ? SELECTED_LINE_WIDTH : PIPE_LINE_WIDTH;

    // Find the nearest structure this pipe references
    const startPos = structPos.get(pipe.startRef);
    const endPos = structPos.get(pipe.endRef);
    const anchorPos = startPos || endPos;

    if (anchorPos) {
      // Draw a short dashed stub extending from the anchor structure
      const stubAngle = _getStubAngle(anchorPos, structPos, pipe);
      const stubEndX = anchorPos.x + Math.cos(stubAngle) * STUB_LENGTH;
      const stubEndY = anchorPos.y + Math.sin(stubAngle) * STUB_LENGTH;

      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(anchorPos.x, anchorPos.y);
      ctx.lineTo(stubEndX, stubEndY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw a small "?" circle at the stub end
      ctx.beginPath();
      ctx.arc(stubEndX, stubEndY, 5, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', stubEndX, stubEndY);

      // Label
      _drawPipeLabel(ctx, stubEndX + 15, stubEndY, `⚠ ${pipe.length} LF`, color);
    } else {
      // No anchor at all — draw floating label in visible area
      _drawPipeLabel(ctx, 100, 50, `⚠ ${pipe.length} LF (unresolved, no anchor)`, color);
    }
  }

  // ── Draw structures (on top of pipes) ──
  for (const s of structures) {
    const pos = structPos.get(s.id);
    if (!pos) continue;

    ctx.fillStyle = COLOR_CONFIRMED_STRUCT;
    ctx.strokeStyle = '#166534';
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
// Helpers
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

/** Compute angle for an unresolved pipe stub — point away from the center of all structures. */
function _getStubAngle(anchorPos, structPos, pipe) {
  // Default: point downward-right
  let cx = 0, cy = 0, count = 0;
  for (const [, pos] of structPos) {
    cx += pos.x; cy += pos.y; count++;
  }
  if (count > 1) {
    cx /= count; cy /= count;
    // Point away from center
    return Math.atan2(anchorPos.y - cy, anchorPos.x - cx);
  }
  return Math.PI / 4; // 45° default
}

// ============================================================
// Structure Position Builder
// ============================================================

/**
 * Build display positions for structures.
 * Priority: sourceX/sourceY > pdfX/pdfY > pageX/pageY > fallback layout
 * Does NOT use easting/northing (those are export coordinates).
 */
function _buildStructurePositions(structures, allStructures, ctx) {
  const structPos = new Map();

  // Collect all structures with their best available page coordinates
  const allItems = [...structures];
  for (const s of allStructures) {
    if (!allItems.find(a => a.id === s.id)) allItems.push(s);
  }

  const rawPositions = [];
  for (const s of allItems) {
    // Priority order for display coordinates
    const x = s.sourceX ?? s.pdfX ?? s.pageX ?? null;
    const y = s.sourceY ?? s.pdfY ?? s.pageY ?? null;
    rawPositions.push({ id: s.id, x: x ?? 0, y: y ?? 0, hasCoords: (x !== null && x > 10), struct: s });
  }

  // Check if we have usable coordinates
  const withCoords = rawPositions.filter(p => p.hasCoords);
  const xs = withCoords.map(p => p.x);
  const ys = withCoords.map(p => p.y);
  const xSpread = xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : 0;
  const ySpread = ys.length > 1 ? Math.max(...ys) - Math.min(...ys) : 0;
  const positionsValid = withCoords.length >= 2 && (xSpread > 50 || ySpread > 50);

  if (positionsValid) {
    for (const p of rawPositions) {
      if (p.hasCoords) {
        structPos.set(p.id, { x: p.x, y: p.y });
      } else {
        // Position this structure near the centroid of the ones that have coords
        const avgX = xs.reduce((a, b) => a + b, 0) / xs.length;
        const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
        structPos.set(p.id, { x: avgX + 30, y: avgY + 30 });
      }
    }
  } else {
    // ── Fallback schematic layout ──
    console.log('[network-renderer] Using fallback schematic layout — no usable page coordinates');

    let pageW = 800, pageH = 600;
    if (ctx && ctx.canvas) {
      const dpr = window.devicePixelRatio || 1;
      pageW = ctx.canvas.width / dpr;
      pageH = ctx.canvas.height / dpr;
    }

    const sorted = [...rawPositions].sort((a, b) => {
      const staA = a.struct?.station || '';
      const staB = b.struct?.station || '';
      if (staA && staB) return staB.localeCompare(staA);
      return a.id.localeCompare(b.id);
    });

    const margin = 80;
    const usableW = pageW - margin * 2;
    const usableH = pageH * 0.4;
    const startY = pageH * 0.3;

    for (let i = 0; i < sorted.length; i++) {
      const t = sorted.length > 1 ? i / (sorted.length - 1) : 0.5;
      structPos.set(sorted[i].id, {
        x: margin + usableW * (1 - t),
        y: startY + usableH * t,
      });
    }
  }

  return structPos;
}

// ============================================================
// Click Hit-Test
// ============================================================

export function handleNetworkClick(x, y, threshold = 12) {
  const graph = networkGraph();
  if (!graph) return false;

  const structures = graph.structureList || [];
  const pipes = graph.pipes || [];
  const unresolvedPipes = graph.unresolvedPipes || [];

  const structPos = _buildStructurePositions(structures, graph.allStructureList || structures, null);

  // Check confirmed pipes
  for (const pipe of pipes) {
    const a = structPos.get(pipe.startRef);
    const b = structPos.get(pipe.endRef);
    if (!a || !b) continue;
    if (_pointToSegmentDist(x, y, a.x, a.y, b.x, b.y) < threshold) {
      selectPipe(pipe.name || pipe.id);
      return true;
    }
  }

  // Check unresolved pipe stubs (approximate: check near anchor structure)
  for (const pipe of unresolvedPipes) {
    const anchor = structPos.get(pipe.startRef) || structPos.get(pipe.endRef);
    if (!anchor) continue;
    // Hit-test: within STUB_LENGTH + threshold of anchor
    const dist = Math.sqrt((x - anchor.x) ** 2 + (y - anchor.y) ** 2);
    if (dist < STUB_LENGTH + threshold) {
      selectUnresolvedPipe(pipe.name || pipe.id);
      return true;
    }
  }

  clearSelection();
  return false;
}

function _pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx, projY = y1 + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}
