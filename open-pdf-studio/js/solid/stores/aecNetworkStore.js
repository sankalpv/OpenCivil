// OpenCivil — AEC Network Review Store
// SolidJS reactive store for the confirmed pipe network graph.
// Supports pipe selection, endpoint editing, and unresolved pipe promotion.

import { createSignal } from 'solid-js';

// ── Network graph state ──
const [networkGraph, setNetworkGraphInternal] = createSignal(null);
// graph shape: { structures: Map, allStructures: Map, pipes: [], unresolvedPipes: [], errors: [] }

// ── Selection state ──
const [selectedPipeId, setSelectedPipeId] = createSignal(null);
const [selectedUnresolvedPipeId, setSelectedUnresolvedPipeId] = createSignal(null);

// ── Public API ──

/** Set the full network graph (from buildConfirmedNetwork output). */
function setNetworkGraph(graph) {
  // Convert Maps to arrays for reactive access if needed
  if (graph && graph.structures instanceof Map) {
    graph = {
      ...graph,
      structureList: [...graph.structures.values()],
      allStructureList: graph.allStructures ? [...graph.allStructures.values()] : [...graph.structures.values()],
    };
  }
  setNetworkGraphInternal(graph);
  clearSelection();
}

/** Get the current network graph. */
function getNetworkGraph() {
  return networkGraph();
}

/** Check if a reviewed network graph is available. */
function networkGraphAvailable() {
  const g = networkGraph();
  return g && (g.pipes?.length > 0 || g.unresolvedPipes?.length > 0);
}

/** Select a confirmed pipe by ID. Clears unresolved selection. */
function selectPipe(pipeId) {
  setSelectedPipeId(pipeId);
  setSelectedUnresolvedPipeId(null);
}

/** Select an unresolved pipe by ID. Clears confirmed selection. */
function selectUnresolvedPipe(pipeId) {
  setSelectedUnresolvedPipeId(pipeId);
  setSelectedPipeId(null);
}

/** Clear all network selection. */
function clearSelection() {
  setSelectedPipeId(null);
  setSelectedUnresolvedPipeId(null);
}

/** Update a confirmed pipe's start/end connection. */
function updatePipeConnection(pipeId, startRef, endRef) {
  const g = networkGraph();
  if (!g || !g.pipes) return;

  const pipe = g.pipes.find(p => p.name === pipeId || p.id === pipeId);
  if (!pipe) return;

  pipe.startRef = startRef;
  pipe.endRef = endRef;
  pipe.confidence = 'manual'; // Mark as manually edited

  // Trigger reactivity
  setNetworkGraphInternal({ ...g });
  console.log(`[aecNetworkStore] Updated ${pipeId}: ${startRef} → ${endRef}`);
}

/**
 * Promote an unresolved pipe to a confirmed pipe with assigned endpoints.
 * Moves it from unresolvedPipes[] to pipes[].
 */
function promoteUnresolvedPipe(pipeId, startRef, endRef) {
  const g = networkGraph();
  if (!g) return;

  const idx = (g.unresolvedPipes || []).findIndex(p => p.name === pipeId || p.id === pipeId);
  if (idx === -1) return;

  const pipe = g.unresolvedPipes.splice(idx, 1)[0];
  pipe.startRef = startRef;
  pipe.endRef = endRef;
  pipe.confidence = 'manual';
  pipe.name = `Pipe-${g.pipes.length + 1}`;
  delete pipe.warning;

  g.pipes.push(pipe);

  // Trigger reactivity
  setNetworkGraphInternal({ ...g });
  setSelectedUnresolvedPipeId(null);
  setSelectedPipeId(pipe.name);
  console.log(`[aecNetworkStore] Promoted ${pipeId} → ${pipe.name}: ${startRef} → ${endRef}`);
}

/** Get the currently selected pipe object (confirmed or unresolved). */
function getSelectedPipe() {
  const g = networkGraph();
  if (!g) return null;

  const confId = selectedPipeId();
  if (confId) {
    return g.pipes?.find(p => p.name === confId || p.id === confId) || null;
  }

  const unrId = selectedUnresolvedPipeId();
  if (unrId) {
    return g.unresolvedPipes?.find(p => p.name === unrId || p.id === unrId) || null;
  }

  return null;
}

/** Get all structure IDs (for dropdown population). */
function getAllStructureIds() {
  const g = networkGraph();
  if (!g) return [];
  return (g.allStructureList || g.structureList || []).map(s => s.id);
}

export {
  networkGraph,
  setNetworkGraph,
  getNetworkGraph,
  networkGraphAvailable,
  selectedPipeId,
  selectedUnresolvedPipeId,
  selectPipe,
  selectUnresolvedPipe,
  clearSelection,
  updatePipeConnection,
  promoteUnresolvedPipe,
  getSelectedPipe,
  getAllStructureIds,
};
