// OpenCivil — AEC Data Store
// SolidJS reactive store for AEC extracted data, search, and panel visibility.

import { createSignal } from 'solid-js';
import { extractAecData, recordsToCsv, searchSpans, summarizeRecords } from '../../aec/aec-extractor.js';
import { extractTextSpans, extractTextSpansBatch } from '../../text/rust-text-extraction.js';
import { state, getActiveDocument } from '../../core/state.js';

// Panel visibility
const [aecPanelVisible, setAecPanelVisible] = createSignal(false);

// Extraction state
const [aecRecords, setAecRecords] = createSignal([]);
const [aecTextSpans, setAecTextSpans] = createSignal([]);
const [aecSummary, setAecSummary] = createSignal({});
const [aecSearchQuery, setAecSearchQuery] = createSignal('');
const [aecSearchResults, setAecSearchResults] = createSignal([]);
const [aecFilterType, setAecFilterType] = createSignal('all');
const [aecIsExtracting, setAecIsExtracting] = createSignal(false);
const [aecStatusMessage, setAecStatusMessage] = createSignal('No data extracted yet');

/**
 * Run AEC data extraction on all pages of the current document.
 * Uses Rust text extraction for maximum accuracy on vector PDFs.
 */
async function runExtraction() {
  const doc = getActiveDocument();
  if (!doc || !doc.filePath) {
    setAecStatusMessage('No document open');
    return;
  }

  setAecIsExtracting(true);
  setAecStatusMessage('Extracting text from all pages...');

  try {
    const totalPages = doc.pageCount || 1;
    const allSpans = [];

    // Extract text from all pages using the Rust backend
    for (let page = 1; page <= totalPages; page++) {
      setAecStatusMessage(`Extracting page ${page} of ${totalPages}...`);
      const spans = await extractTextSpans(doc.filePath, page);
      // Tag each span with page number
      for (const s of spans) {
        allSpans.push({ ...s, page });
      }
    }

    setAecTextSpans(allSpans);
    setAecStatusMessage(`Parsing ${allSpans.length} text spans for AEC data...`);

    // Run AEC regex extraction
    const records = extractAecData(allSpans);
    setAecRecords(records);

    // Build summary
    const summary = summarizeRecords(records);
    setAecSummary(summary);

    setAecStatusMessage(
      `Found ${records.length} AEC records from ${allSpans.length} text spans (${totalPages} pages)`
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

export {
  aecPanelVisible, setAecPanelVisible,
  aecRecords, setAecRecords,
  aecTextSpans, setAecTextSpans,
  aecSummary, setAecSummary,
  aecSearchQuery, setAecSearchQuery,
  aecSearchResults, setAecSearchResults,
  aecFilterType, setAecFilterType,
  aecIsExtracting,
  aecStatusMessage,
  runExtraction,
  updateSearch,
  getFilteredRecords,
  getExportCsv,
  downloadCsv,
};
