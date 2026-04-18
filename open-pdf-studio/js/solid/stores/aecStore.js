// OpenCivil — AEC Data Store
// SolidJS reactive store for AEC extracted data, search, and panel visibility.

import { createSignal } from 'solid-js';
import { extractAecData, recordsToCsv, searchSpans, summarizeRecords } from '../../aec/aec-extractor.js';
import { groupByBoundingBox, structuresToCsv } from '../../aec/spatial-grouper.js';
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
    setAecStatusMessage(`Parsing ${allSpans.length} text spans for AEC data...`);

    // Run AEC regex extraction
    const records = extractAecData(allSpans);
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
};
