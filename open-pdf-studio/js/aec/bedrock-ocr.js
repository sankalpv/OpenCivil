// OpenCivil — Claude Opus 4.7 via AWS Bedrock for AI-powered text extraction
// Uses the Bedrock Converse API with multimodal (image + text) input.
// Far superior to Tesseract for SHX vector-drawn CAD text.

import { getActiveDocument } from '../core/state.js';

// ── Config (loaded from .env via Vite, or localStorage fallback) ──
function getConfig() {
  return {
    apiKey: import.meta.env.VITE_BEDROCK_API_KEY
      || localStorage.getItem('bedrock_api_key')
      || '',
    region: import.meta.env.VITE_BEDROCK_REGION
      || localStorage.getItem('bedrock_region')
      || 'us-west-2',
    modelId: import.meta.env.VITE_BEDROCK_MODEL_ID
      || localStorage.getItem('bedrock_model_id')
      || 'us.anthropic.claude-opus-4-7',
    maxTokens: parseInt(import.meta.env.VITE_BEDROCK_MAX_TOKENS
      || localStorage.getItem('bedrock_max_tokens')
      || '16384'),
  };
}

/**
 * Store Bedrock API key in localStorage (for runtime config without .env).
 */
export function setBedrockApiKey(key) {
  localStorage.setItem('bedrock_api_key', key);
}

export function getBedrockApiKey() {
  return getConfig().apiKey;
}

// ── AEC Extraction Prompt ──
const AEC_EXTRACTION_PROMPT = `You are an expert civil engineering drawing reader. Extract ALL text visible in this engineering plan/profile drawing.

Return a JSON object with this exact structure:
{
  "structures": [
    {
      "id": "SDMH-1",
      "type": "manhole|catchBasin|waterValve|inlet|outlet|cleanout|junction",
      "rim": "143.96",
      "inverts": [
        {"elevation": "142.99", "pipeSize": "8\\"", "material": "PVC", "direction": "S"}
      ],
      "bottom": "141.29",
      "station": "5+00",
      "notes": ""
    }
  ],
  "pipes": [
    {
      "from": "SDMH-1",
      "to": "SDMH-2",
      "size": "30\\"",
      "material": "PVC",
      "length": "249 LF",
      "slope": "0.5%",
      "station_start": "5+00",
      "station_end": "7+00"
    }
  ],
  "notes": [
    {"section": "DRAINAGE NOTES", "items": ["note 1...", "note 2..."]},
    {"section": "CONSTRUCTION NOTES", "items": ["..."]}
  ],
  "elevations": [
    {"label": "description", "value": "143.96", "station": "5+00"}
  ],
  "scales": ["1\\"=20'", "1\\"=5'"],
  "title_block": {
    "project": "",
    "sheet": "",
    "date": "",
    "designer": "",
    "checker": ""
  },
  "all_text": ["every single text string visible on the drawing"]
}

IMPORTANT:
- Extract EVERY piece of text, no matter how small
- Include all structure IDs (SDMH, SSMH, SDCB, CB, MH, etc.)
- Include all RIM elevations, IE (invert elevations), BOTTOM OF STRUCTURE values
- Include pipe sizes, materials (PVC, RCP, CONC, STL, HDPE), slopes
- Include all stations (format: X+XX or X+XX.XX)
- Include all notes sections (DRAINAGE NOTES, CONSTRUCTION NOTES, UTILITY NOTES, etc.)
- Include water valve data, force main labels
- Return ONLY valid JSON, no markdown wrapping`;

/**
 * Render PDF page to base64 PNG for Bedrock.
 * Uses 3x scale capped at 4000px max dimension (Bedrock image limit).
 */
async function renderPageForBedrock(pdfDoc, pageNum) {
  const page = await pdfDoc.getPage(pageNum);
  const MAX_DIM = 4000;

  let scale = 3;
  const baseVp = page.getViewport({ scale: 1 });
  const maxBase = Math.max(baseVp.width, baseVp.height);
  if (maxBase * scale > MAX_DIM) {
    scale = MAX_DIM / maxBase;
  }

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  console.log(`[AI] Rendered page ${pageNum}: ${canvas.width}×${canvas.height}px (scale ${scale.toFixed(2)}x)`);

  // Convert to base64 PNG (strip data URL prefix)
  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  return { base64, width: canvas.width, height: canvas.height, scale };
}

/**
 * Call Bedrock Converse API with an image and prompt.
 */
async function callBedrock(imageBase64, prompt) {
  const config = getConfig();

  if (!config.apiKey) {
    throw new Error('Bedrock API key not configured. Set VITE_BEDROCK_API_KEY in .env or use setBedrockApiKey()');
  }

  const url = `https://bedrock-runtime.${config.region}.amazonaws.com/model/${config.modelId}/converse`;

  const payload = {
    messages: [{
      role: 'user',
      content: [
        {
          image: {
            format: 'png',
            source: { bytes: imageBase64 },
          },
        },
        { text: prompt },
      ],
    }],
    inferenceConfig: {
      maxTokens: config.maxTokens,
    },
  };

  console.log(`[AI] Calling Bedrock: ${config.modelId} in ${config.region}`);

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[AI] Bedrock error:', resp.status, errText);
    throw new Error(`Bedrock API error ${resp.status}: ${errText.substring(0, 200)}`);
  }

  const result = await resp.json();

  // Extract text from Converse API response
  const output = result.output?.message?.content;
  if (output && output.length > 0) {
    const textBlock = output.find(b => b.text);
    if (textBlock) return textBlock.text;
  }

  throw new Error('No text in Bedrock response');
}

/**
 * Parse Claude's JSON response into text spans for the AEC extractor.
 */
function parseAiResponse(jsonText, pageNum, imgScale) {
  // Strip markdown code fences if present
  let cleaned = jsonText.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  let data;
  try {
    data = JSON.parse(cleaned);
  } catch (e) {
    console.warn('[AI] Failed to parse JSON, using raw text fallback');
    // Fallback: treat entire response as text, split into words
    return jsonText.split(/\s+/).filter(w => w.trim()).map((w, i) => ({
      text: w, x: 0, y: i * 14, width: w.length * 8, height: 12,
      font_size: 12, page: pageNum, source: 'ai',
    }));
  }

  const spans = [];
  let yPos = 0;

  // Convert all_text array into spans
  if (data.all_text) {
    for (const text of data.all_text) {
      spans.push({
        text, x: 0, y: yPos, width: text.length * 8, height: 12,
        font_size: 12, page: pageNum, source: 'ai',
      });
      yPos += 14;
    }
  }

  // Convert structures into text spans (so regex pipeline can match them)
  if (data.structures) {
    for (const s of data.structures) {
      if (s.id) spans.push({ text: s.id, x: 0, y: yPos, width: 80, height: 12, font_size: 12, page: pageNum, source: 'ai' });
      yPos += 14;
      if (s.rim) {
        spans.push({ text: `RIM=${s.rim}`, x: 0, y: yPos, width: 80, height: 12, font_size: 12, page: pageNum, source: 'ai' });
        yPos += 14;
      }
      if (s.inverts) {
        for (const inv of s.inverts) {
          const parts = ['IE'];
          if (inv.pipeSize) parts.push(inv.pipeSize);
          if (inv.material) parts.push(inv.material);
          if (inv.direction) parts.push(`(${inv.direction})`);
          parts.push(`=${inv.elevation}`);
          spans.push({ text: parts.join(' '), x: 0, y: yPos, width: 120, height: 12, font_size: 12, page: pageNum, source: 'ai' });
          yPos += 14;
        }
      }
      if (s.bottom) {
        spans.push({ text: `BOTTOM OF STRUCTURE=${s.bottom}`, x: 0, y: yPos, width: 160, height: 12, font_size: 12, page: pageNum, source: 'ai' });
        yPos += 14;
      }
      if (s.station) {
        spans.push({ text: `STA ${s.station}`, x: 0, y: yPos, width: 60, height: 12, font_size: 12, page: pageNum, source: 'ai' });
        yPos += 14;
      }
    }
  }

  // Convert pipes
  if (data.pipes) {
    for (const p of data.pipes) {
      const parts = [];
      if (p.length) parts.push(p.length);
      if (p.size) parts.push(p.size);
      if (p.material) parts.push(p.material);
      if (p.slope) parts.push(`S=${p.slope}`);
      if (parts.length > 0) {
        spans.push({ text: parts.join(' '), x: 0, y: yPos, width: 160, height: 12, font_size: 12, page: pageNum, source: 'ai' });
        yPos += 14;
      }
    }
  }

  // Convert notes
  if (data.notes) {
    for (const section of data.notes) {
      spans.push({ text: section.section, x: 0, y: yPos, width: 120, height: 14, font_size: 14, page: pageNum, source: 'ai' });
      yPos += 16;
      for (const item of (section.items || [])) {
        spans.push({ text: item, x: 10, y: yPos, width: 200, height: 12, font_size: 12, page: pageNum, source: 'ai' });
        yPos += 14;
      }
    }
  }

  console.log(`[AI] Parsed ${spans.length} spans from Claude response`);
  return spans;
}

/**
 * Run AI extraction on a single page.
 */
export async function aiExtractPage(pdfDoc, pageNum) {
  const img = await renderPageForBedrock(pdfDoc, pageNum);
  const responseText = await callBedrock(img.base64, AEC_EXTRACTION_PROMPT);
  console.log(`[AI] Claude response length: ${responseText.length} chars`);
  return parseAiResponse(responseText, pageNum, img.scale);
}

/**
 * Run AI extraction on all pages.
 */
export async function aiExtractAllPages(onProgress) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) throw new Error('No PDF document loaded');

  const totalPages = doc.pdfDoc.numPages;
  const allSpans = [];

  for (let page = 1; page <= totalPages; page++) {
    if (onProgress) onProgress(page, totalPages, `AI: Analyzing page ${page}/${totalPages} with Claude Opus 4.7...`);
    const spans = await aiExtractPage(doc.pdfDoc, page);
    allSpans.push(...spans);
    console.log(`[AI] Page ${page}: ${spans.length} spans extracted`);
  }

  return allSpans;
}
