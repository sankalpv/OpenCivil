// OpenCivil — OCR Text Extraction via Tesseract.js
// For PDFs where text is drawn as vector paths (SHX fonts, scanned drawings).
// Renders each page to a canvas, runs Tesseract OCR, returns text spans.

import { createWorker } from 'tesseract.js';
import { getActiveDocument } from '../core/state.js';

let _worker = null;

/**
 * Get or create the Tesseract worker (lazy init, reused across calls).
 */
async function getWorker() {
  if (!_worker) {
    _worker = await createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`[OCR] Page progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    });
  }
  return _worker;
}

/**
 * Render a PDF page to a canvas and return the image data URL.
 * Uses PDF.js to render at high resolution for better OCR accuracy.
 *
 * @param {Object} pdfDoc  PDF.js document proxy
 * @param {number} pageNum 1-based page number
 * @param {number} [scale=3] Render scale (3x = 216 DPI for 72pt PDF)
 * @returns {Promise<{dataUrl: string, width: number, height: number}>}
 */
async function renderPageToImage(pdfDoc, pageNum, scale = 3) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');

  await page.render({ canvasContext: ctx, viewport }).promise;

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: viewport.width,
    height: viewport.height,
    pdfWidth: viewport.width / scale,
    pdfHeight: viewport.height / scale,
    scale,
  };
}

/**
 * Run OCR on a single PDF page.
 * Returns text spans in the same format as PDF.js getTextContent().
 *
 * @param {Object} pdfDoc  PDF.js document proxy
 * @param {number} pageNum 1-based page number
 * @returns {Promise<Array<{text: string, x: number, y: number, width: number, height: number, font_size: number, page: number}>>}
 */
export async function ocrPage(pdfDoc, pageNum) {
  const worker = await getWorker();

  // Render page to high-res image
  const img = await renderPageToImage(pdfDoc, pageNum);

  // Run OCR
  const { data } = await worker.recognize(img.dataUrl);

  // Convert Tesseract words to our text span format
  // Tesseract returns coordinates in image pixels; scale back to PDF points
  const spans = [];
  for (const word of data.words) {
    if (!word.text || !word.text.trim()) continue;

    const bbox = word.bbox;
    spans.push({
      text: word.text,
      x: bbox.x0 / img.scale,
      y: bbox.y0 / img.scale,
      width: (bbox.x1 - bbox.x0) / img.scale,
      height: (bbox.y1 - bbox.y0) / img.scale,
      font_size: (bbox.y1 - bbox.y0) / img.scale,
      page: pageNum,
      confidence: word.confidence,
      source: 'ocr',
    });
  }

  return spans;
}

/**
 * Run OCR on all pages of the current document.
 * Returns all text spans suitable for the AEC extractor.
 *
 * @param {Function} onProgress  Callback: (pageNum, totalPages, message) => void
 * @returns {Promise<Array>}
 */
export async function ocrAllPages(onProgress) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) throw new Error('No PDF document loaded');

  const totalPages = doc.pdfDoc.numPages;
  const allSpans = [];

  for (let page = 1; page <= totalPages; page++) {
    if (onProgress) onProgress(page, totalPages, `OCR: Processing page ${page} of ${totalPages}...`);

    const spans = await ocrPage(doc.pdfDoc, page);
    allSpans.push(...spans);

    console.log(`[OCR] Page ${page}: ${spans.length} words found`);
  }

  return allSpans;
}

/**
 * Clean up the Tesseract worker.
 */
export async function terminateOcr() {
  if (_worker) {
    await _worker.terminate();
    _worker = null;
  }
}
