// OpenCivil — AEC Data Store
// SolidJS reactive store for AEC extracted data, search, and panel visibility.

import { createSignal } from 'solid-js';
import { extractAecData, recordsToCsv, searchSpans, summarizeRecords } from '../../aec/aec-extractor.js';
import { buildConfirmedNetwork } from '../../aec/network-builder.js';
import { setNetworkGraph } from './aecNetworkStore.js';
import { redrawAnnotations } from '../../annotations/rendering.js';
import { groupByBoundingBox, structuresToCsv } from '../../aec/spatial-grouper.js';
import { ocrAllPages } from '../../aec/ocr-extraction.js';
import { aiExtractAllPages } from '../../aec/bedrock-ocr.js';
import { extractTextSpans } from '../../text/rust-text-extraction.js';
import { state, getActiveDocument } from '../../core/state.js';
import { isTauri } from '../../core/platform.js';

// Panel visibility
const [aecPanelVisible, setAecPanelVisible] = createSignal(false);

// Extraction state
const [aecRecords, setAecRecords] = createSignal([]);
const [aecTextSpans, setAecTextSpans] = createSignal([]);
const [aecSummary, setAecSummary] = createSignal({});
const [aecSearchQuery, setAecSearchQuery] = createSignal('');
const [aecSearchResults, setAecSearchResults] = createSignal([]);
const [aecFilterType, setAecFilterType] = createSignal('all');
const [aecStructures, setAecStructures] = createSignal([]);
const [aecUngrouped, setAecUngrouped] = createSignal([]);
const [aecViewMode, setAecViewMode] = createSignal('structures'); // 'structures' | 'records'
const [aecIsExtracting, setAecIsExtracting] = createSignal(false);
const [aecStatusMessage, setAecStatusMessage] = createSignal('No data extracted yet');

// ── Coordinate cache from "Extract Data" for hybrid merge with "AI Extract" ──
// Maps structure ID → {x, y} from PDF.js/Rust extraction (real page coordinates)
let _pdfCoordCache = new Map();

/**
 * Extract text from a single page using PDF.js getTextContent().
 * Fallback for browser mode where Rust backend is not available.
 */
async function extractTextViaPdfJs(pdfDoc, pageNum) {
  const page = await pdfDoc.getPage(pageNum);
  const textContent = await page.getTextContent();
  const spans = [];
  for (const item of textContent.items) {
    if (!item.str || !item.str.trim()) continue;
    spans.push({
      text: item.str,
      x: item.transform ? item.transform[4] : 0,
      y: item.transform ? item.transform[5] : 0,
      width: item.width || 0,
      height: item.height || 0,
      font_size: item.transform ? Math.abs(item.transform[3]) : 12,
      page: pageNum,
    });
  }
  return spans;
}

/**
 * Run AEC data extraction on all pages of the current document.
 * Uses Rust text extraction when available (Tauri), falls back to PDF.js.
 */
async function runExtraction() {
  const doc = getActiveDocument();
  if (!doc) {
    setAecStatusMessage('No document open');
    return;
  }

  // Need either filePath (Tauri) or pdfDoc (PDF.js) to extract
  if (!doc.filePath && !doc.pdfDoc) {
    setAecStatusMessage('No document loaded');
    return;
  }

  setAecIsExtracting(true);
  setAecStatusMessage('Extracting text from all pages...');
  setAecPanelVisible(true); // Auto-show the panel

  try {
    const totalPages = doc.pdfDoc ? doc.pdfDoc.numPages : (doc.pageCount || 1);
    const allSpans = [];
    const useRust = isTauri() && doc.filePath;

    for (let page = 1; page <= totalPages; page++) {
      setAecStatusMessage(`Extracting page ${page} of ${totalPages}...`);

      let spans;
      if (useRust) {
        // Rust backend (fast, Tauri-only)
        spans = await extractTextSpans(doc.filePath, page);
        spans = spans.map(s => ({ ...s, page }));
      } else if (doc.pdfDoc) {
        // PDF.js fallback (works in browser)
        spans = await extractTextViaPdfJs(doc.pdfDoc, page);
      } else {
        spans = [];
      }

      allSpans.push(...spans);
    }

    setAecTextSpans(allSpans);
    console.log('[AEC DEBUG] Total text spans extracted:', allSpans.length);
    console.log('[AEC DEBUG] First 10 spans:', allSpans.slice(0, 10).map(s => s.text));
    console.log('[AEC DEBUG] Sample span:', allSpans[0]);
    setAecStatusMessage(`Parsing ${allSpans.length} text spans for AEC data...`);

    // Run AEC regex extraction
    const records = extractAecData(allSpans);
    console.log('[AEC DEBUG] Records found:', records.length);
    console.log('[AEC DEBUG] Record types:', records.map(r => r.type));
    setAecRecords(records);

    // Build summary
    const summary = summarizeRecords(records);
    setAecSummary(summary);

    // Run spatial grouping
    const { structures, ungrouped } = groupByBoundingBox(records);
    setAecStructures(structures);
    setAecUngrouped(ungrouped);

    const method = useRust ? 'Rust' : 'PDF.js';
    setAecStatusMessage(
      `${records.length} records → ${structures.length} structures, ${ungrouped.length} ungrouped (${totalPages} pg, ${method})`
    );

    // Cache structure PDF coordinates for hybrid merge with AI Extract
    _pdfCoordCache = new Map();
    for (const r of records) {
      if ((r.type === 'manhole' || r.type === 'catchBasin') && r.fields?.id) {
        if (!_pdfCoordCache.has(r.fields.id) && r.source.x > 10) {
          _pdfCoordCache.set(r.fields.id, { x: r.source.x, y: r.source.y, page: r.source.page });
        }
      }
    }
    console.log(`[AEC] Cached ${_pdfCoordCache.size} structure coordinates for hybrid merge`);

    // Auto-populate the network graph for overlay + review UI
    try {
      const graph = buildConfirmedNetwork(records);
      setNetworkGraph(graph);
      redrawAnnotations(); // Trigger canvas repaint to show network overlay
    } catch (graphErr) {
      console.warn('[AEC] Network graph build failed (non-fatal):', graphErr);
    }
  } catch (err) {
    console.error('AEC extraction error:', err);
    setAecStatusMessage(`Extraction error: ${err.message || err}`);
  } finally {
    setAecIsExtracting(false);
  }
}

/**
 * Filter records by search query.
 */
function updateSearch(query) {
  setAecSearchQuery(query);
  if (!query?.trim()) {
    setAecSearchResults([]);
    return;
  }
  const results = searchSpans(aecTextSpans(), query);
  setAecSearchResults(results);
}

/**
 * Get filtered records by type.
 */
function getFilteredRecords() {
  const filter = aecFilterType();
  const records = aecRecords();
  if (filter === 'all') return records;
  return records.filter(r => r.type === filter);
}

/**
 * Export extracted data as CSV string.
 */
function getExportCsv() {
  return recordsToCsv(getFilteredRecords());
}

/**
 * Download CSV to disk via a Blob URL.
 */
function downloadCsv() {
  const csv = getExportCsv();
  if (!csv) return;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'opencivil-aec-data.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Run OCR-based extraction (for PDFs with text drawn as vector paths).
 */
async function runOcrExtraction() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) {
    setAecStatusMessage('No document loaded');
    return;
  }

  setAecIsExtracting(true);
  setAecStatusMessage('OCR: Initializing Tesseract...');
  setAecPanelVisible(true);

  try {
    const allSpans = await ocrAllPages((page, total, msg) => {
      setAecStatusMessage(msg);
    });

    setAecTextSpans(allSpans);
    console.log('[OCR] Total words extracted:', allSpans.length);
    setAecStatusMessage(`OCR: Parsing ${allSpans.length} words for AEC data...`);

    const records = extractAecData(allSpans);
    console.log('[OCR] Records found:', records.length);
    setAecRecords(records);

    const summary = summarizeRecords(records);
    setAecSummary(summary);

    const { structures, ungrouped } = groupByBoundingBox(records);
    setAecStructures(structures);
    setAecUngrouped(ungrouped);

    setAecStatusMessage(
      `OCR: ${records.length} records → ${structures.length} structures (${allSpans.length} words)`
    );
  } catch (err) {
    console.error('OCR extraction error:', err);
    setAecStatusMessage(`OCR error: ${err.message || err}`);
  } finally {
    setAecIsExtracting(false);
  }
}

/**
 * Download structures as CSV.
 */
function downloadStructuresCsv() {
  const csv = structuresToCsv(aecStructures());
  if (!csv) return;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'opencivil-structures.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Run AI-powered extraction via Claude Opus 4.7 on Bedrock.
 */
async function runAiExtraction() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) {
    setAecStatusMessage('No document loaded');
    return;
  }

  setAecIsExtracting(true);
  setAecStatusMessage('AI: Rendering page for Claude Opus 4.7...');
  setAecPanelVisible(true);

  try {
    const allSpans = await aiExtractAllPages((page, total, msg) => {
      setAecStatusMessage(msg);
    });

    setAecTextSpans(allSpans);
    console.log('[AI] Total spans:', allSpans.length);
    setAecStatusMessage(`AI: Parsing ${allSpans.length} spans for AEC data...`);

    const records = extractAecData(allSpans);
    console.log('[AI] Records found:', records.length);
    setAecRecords(records);

    const summary = summarizeRecords(records);
    setAecSummary(summary);

    const { structures, ungrouped } = groupByBoundingBox(records);
    setAecStructures(structures);
    setAecUngrouped(ungrouped);

    setAecStatusMessage(
      `AI: ${records.length} records → ${structures.length} structures (Claude Opus 4.7)`
    );

    // ── Hybrid merge: inject PDF coordinates from prior "Extract Data" run ──
    if (_pdfCoordCache.size > 0) {
      let merged = 0;
      for (const r of records) {
        if ((r.type === 'manhole' || r.type === 'catchBasin') && r.fields?.id) {
          const cached = _pdfCoordCache.get(r.fields.id);
          if (cached) {
            r.source.x = cached.x;
            r.source.y = cached.y;
            if (cached.page) r.source.page = cached.page;
            merged++;
          }
        }
      }
      console.log(`[AEC] Hybrid merge: injected ${merged} PDF coordinates into AI records (cache had ${_pdfCoordCache.size} entries)`);
    } else {
      console.log('[AEC] No PDF coordinate cache — run "Extract Data" first for accurate overlay positions');
    }

    // Auto-populate the network graph for overlay + review UI
    try {
      const graph = buildConfirmedNetwork(records);
      setNetworkGraph(graph);
      redrawAnnotations(); // Trigger canvas repaint to show network overlay
    } catch (graphErr) {
      console.warn('[AEC] Network graph build failed (non-fatal):', graphErr);
    }
  } catch (err) {
    console.error('AI extraction error:', err);
    setAecStatusMessage(`AI error: ${err.message || err}`);
  } finally {
    setAecIsExtracting(false);
  }
}

export {
  aecPanelVisible, setAecPanelVisible,
  aecRecords, setAecRecords,
  aecTextSpans, setAecTextSpans,
  aecSummary, setAecSummary,
  aecSearchQuery, setAecSearchQuery,
  aecSearchResults, setAecSearchResults,
  aecFilterType, setAecFilterType,
  aecStructures, setAecStructures,
  aecUngrouped,
  aecViewMode, setAecViewMode,
  aecIsExtracting,
  aecStatusMessage,
  runExtraction,
  updateSearch,
  getFilteredRecords,
  getExportCsv,
  downloadCsv,
  downloadStructuresCsv,
  runOcrExtraction,
  runAiExtraction,
};
