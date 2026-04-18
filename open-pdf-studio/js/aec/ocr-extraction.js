// OpenCivil — Optimized OCR Text Extraction via Tesseract.js
// For PDFs where text is drawn as vector paths (SHX fonts, scanned drawings).
// Uses aggressive image preprocessing for engineering drawing OCR.

import { createWorker, PSM } from 'tesseract.js';
import { getActiveDocument } from '../core/state.js';

let _worker = null;

/**
 * Get or create the Tesseract worker with optimized settings.
 */
async function getWorker() {
  if (!_worker) {
    _worker = await createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`[OCR] Progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    });
    // Set PSM to sparse text (mode 11) — ideal for engineering drawings
    // where text is scattered across the page, not in paragraphs
    await _worker.setParameters({
      tessedit_pageseg_mode: PSM?.SPARSE_TEXT || '11',
      // Whitelist common AEC characters
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.+-=()/#\'" %@:;,',
    });
  }
  return _worker;
}

/**
 * Render a PDF page to a canvas at high resolution.
 * Uses 5x scale (360 DPI) for maximum OCR accuracy.
 */
async function renderPageToImage(pdfDoc, pageNum, scale = 5) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');

  // White background (some PDFs have transparent bg which confuses OCR)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  return { canvas, width: viewport.width, height: viewport.height, scale };
}

/**
 * Preprocess image for better OCR on engineering drawings.
 * Steps:
 * 1. Convert to grayscale
 * 2. Adaptive thresholding (binarization)
 * 3. Morphological dilation (thicken thin text strokes)
 * 4. Invert if needed (ensure dark text on light background)
 */
function preprocessForOcr(sourceCanvas) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  // Create working canvas
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // Step 1: Convert to grayscale
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = gray;
  }

  // Step 2: Increase contrast (stretch histogram)
  let min = 255, max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  for (let i = 0; i < data.length; i += 4) {
    const stretched = Math.round(((data[i] - min) / range) * 255);
    data[i] = data[i + 1] = data[i + 2] = stretched;
  }

  // Step 3: Adaptive binarization (Otsu's method approximation)
  // Compute histogram
  const hist = new Array(256).fill(0);
  for (let i = 0; i < data.length; i += 4) hist[data[i]]++;
  const total = w * h;

  // Otsu's threshold
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, wF = 0, maxVariance = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  // Apply threshold — make text BLACK (0) and background WHITE (255)
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i] < threshold ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = v;
  }

  // Step 4: Morphological dilation (thicken text strokes by 1px)
  // This helps with thin SHX font strokes that might break during binarization
  const dilated = new Uint8ClampedArray(data);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      if (data[idx] === 0) { // Black pixel — dilate to neighbors
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const ni = ((y+dy) * w + (x+dx)) * 4;
          dilated[ni] = dilated[ni+1] = dilated[ni+2] = 0;
        }
      }
    }
  }

  // Write dilated result back
  for (let i = 0; i < data.length; i += 4) {
    data[i] = dilated[i];
    data[i + 1] = dilated[i + 1];
    data[i + 2] = dilated[i + 2];
  }

  ctx.putImageData(imageData, 0, 0);
  console.log(`[OCR] Preprocessed: ${w}x${h}, threshold=${threshold}`);
  return canvas;
}

/**
 * Run OCR on a single PDF page with full preprocessing.
 */
export async function ocrPage(pdfDoc, pageNum) {
  const worker = await getWorker();

  // Render at 4x scale (288 DPI) — balanced between accuracy and canvas size limits
  const img = await renderPageToImage(pdfDoc, pageNum, 4);

  // Preprocess for engineering drawing OCR
  const processed = preprocessForOcr(img.canvas);

  // Pass canvas directly to Tesseract (avoids data URL truncation for large images)
  const result = await worker.recognize(processed);
  const data = result.data || result;

  // Extract words from the Tesseract result
  let words = data.words || [];
  if (words.length === 0 && data.blocks) {
    words = [];
    for (const block of data.blocks) {
      for (const para of (block.paragraphs || [])) {
        for (const line of (para.lines || [])) {
          for (const word of (line.words || [])) {
            words.push(word);
          }
        }
      }
    }
  }

  // Fallback: parse from data.text if no structured words
  if (words.length === 0 && data.text && data.text.trim().length > 0) {
    console.log('[OCR] Using text fallback, confidence:', data.confidence);
    const lines = data.text.split('\n').filter(l => l.trim());
    let yPos = 0;
    for (const line of lines) {
      const lineWords = line.split(/\s+/).filter(w => w.trim());
      let xPos = 0;
      for (const w of lineWords) {
        words.push({
          text: w,
          bbox: { x0: xPos, y0: yPos, x1: xPos + w.length * 10, y1: yPos + 14 },
          confidence: data.confidence || 50,
        });
        xPos += w.length * 10 + 8;
      }
      yPos += 16;
    }
  }

  console.log(`[OCR] Page ${pageNum}: ${words.length} words, confidence: ${data.confidence}%`);

  // Convert to text spans (scale back from image pixels to PDF points)
  const spans = [];
  for (const word of words) {
    if (!word.text || !word.text.trim()) continue;
    // Filter out low-confidence noise (below 30%)
    if (word.confidence !== undefined && word.confidence < 30) continue;

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
 */
export async function ocrAllPages(onProgress) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) throw new Error('No PDF document loaded');

  const totalPages = doc.pdfDoc.numPages;
  const allSpans = [];

  for (let page = 1; page <= totalPages; page++) {
    if (onProgress) onProgress(page, totalPages, `OCR: Page ${page}/${totalPages} (5x render + preprocessing)...`);
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
