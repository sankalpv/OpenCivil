# PDF Reading Accuracy Test Suite

## Overview

The project includes a comprehensive test suite to validate PDF text extraction accuracy on engineering drawings. A test specifically designed for the Meydenbauer storm drain drawing has been created.

## Test File

- **Test location**: `open-pdf-render/tests/test_meydenbauer_drawing.rs`
- **Three test functions**:
  1. `test_meydenbauer_text_extraction` — Validates text extraction accuracy (target: 95%+)
  2. `test_meydenbauer_rendering` — Verifies page rendering produces content
  3. `test_meydenbauer_draw_commands` — Ensures drawing commands are properly extracted

## Running the Test

### Setup

1. Place your PDF file in the test directory:
   ```bash
   cp "Meydenbauer - 60% 08-15-19[1] (1).pdf" open-pdf-render/
   ```

2. Navigate to the render crate:
   ```bash
   cd open-pdf-render
   ```

### Run All Tests

```bash
cargo test --test test_meydenbauer_drawing -- --nocapture
```

### Run Single Test

```bash
# Text extraction accuracy test
cargo test --test test_meydenbauer_drawing test_meydenbauer_text_extraction -- --nocapture

# Rendering test
cargo test --test test_meydenbauer_drawing test_meydenbauer_rendering -- --nocapture

# Draw commands test
cargo test --test test_meydenbauer_drawing test_meydenbauer_draw_commands -- --nocapture
```

## Expected Results

### Text Extraction (95%+ Accuracy Target)

The test verifies extraction of these key text elements:

- Main title: `STORM DRAIN IMPROVEMENT PROJECT`
- Location: `NE 4TH ST`, `SEC 27`
- City info: `City of`, `Bellevue`
- Technical sections: `DRAINAGE NOTES`, `CONSTRUCTION NOTES`, `OTHER UTILITY NOTES`
- Infrastructure: `UTILITIES`, `WATER VALVE`, `FORCE MAIN`
- Company: `Louis Berger`, `Seattle`
- Document info: `SHEET`, `60% SUBMITTAL`

**Expected**: All 18+ elements successfully extracted
**Result Format**:
```
=== RESULTS ===
Found: 18 / 18 expected text elements
Accuracy: 100.0%
```

### Rendering Test

- Image dimensions matching page size
- Non-white pixels > 0 (content is rendered)
- Content coverage > 10% (substantial content rendered)

### Draw Commands Test

- Extraction completes in reasonable time
- Command data > 100 bytes (contains substantial drawing instructions)

## Current Implementation Capabilities

### Text Extraction (extract_text, extract_text_spans)
- Uses Rust interpreter walking PDF content streams
- Supports multiple encodings and CMAPs
- Handles complex font systems (Type0, CIDFont, embedded fonts)
- Caches glyph parsing for performance

### Rendering (render_page)
- Converts PDF drawing commands to rasterized images
- Supports vector graphics, embedded images, text rendering
- Uses Tiny Skia for high-quality rendering
- Configurable scale and rotation

### Analysis (extract_draw_commands, analyze_page_type)
- Extracts low-level PDF drawing commands
- Distinguishes vector vs. rasterized content
- Provides timing metrics for performance analysis

## OCR Limitations

**Note**: This project does **NOT** currently include OCR capabilities. The tests validate native text extraction from PDFs with embedded text (searchable PDFs). 

For PDFs with:
- Scanned images without embedded text
- Low confidence OCR results  
- Mixed scanned/vector content

Consider the planned Bedrock/Claude Opus 4.7 integration (see commit `a7c95a04`) which adds AI-powered text extraction via AWS Bedrock.

## Troubleshooting

### Test Skipped
If test output shows "Test PDF not found" and passes with 0 errors, ensure:
1. PDF file is in `open-pdf-render/` directory (same as Cargo.toml)
2. Filename matches exactly: `Meydenbauer - 60% 08-15-19[1] (1).pdf`

### Rendering Issues
If `coverage_percent` is very low (< 10%):
- Check if PDF contains vector graphics (not just raster)
- Verify PDF is not encrypted or damaged
- Try `test_meydenbauer_rendering` with `--nocapture` for detailed output

### Text Extraction Issues
If text elements are not found:
1. Print the combined extracted text to see what was actually extracted
2. Check if text is embedded in the PDF or only in images
3. Compare with output of desktop PDF viewers' text extraction

## Test Metrics Explained

- **Accuracy**: (Found elements / Total expected) × 100
- **Coverage**: (Non-white pixels / Total pixels) × 100  
- **Extraction time**: Measured for performance profiling

## Next Steps

To achieve 95%+ accuracy on your specific PDF:

1. **Run the test** to identify any missing text elements
2. **Debug output** shows which elements were not found
3. **Verify PDF type**:
   - Native text (searchable): supported ✓
   - Scanned/image-based: requires OCR (planned feature)
4. **Report results** with test output if issues occur

## Related Code

- Core extraction: `open-pdf-render/src/interpreter.rs`
- Text spans API: `open-pdf-render/src/parser.rs::extract_text_spans()`
- Rust commands: `open-pdf-studio/src-tauri/src/lib.rs::extract_text()`
