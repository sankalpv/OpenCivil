# OpenCivil

**Bluebeam Revu-class PDF viewer and editor for AEC professionals.**

Forked from [Open PDF Studio](https://github.com/OpenAEC-Foundation/open-pdf-studio) v1.43.0 and enhanced with AEC-specific data extraction, construction stamps, and measurement export.

---

## Quick Start

```bash
cd open-civil/open-pdf-studio

# Install dependencies
npm install

# Run in browser (frontend only, PDF.js fallback)
npm run dev
# → http://localhost:3041

# Run as desktop app (full Tauri + Rust backend)
npm run tauri dev
```

## Build for Production

```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/
```

---

## What's New in OpenCivil (vs upstream)

### AEC Data Extraction (NEW)
- **"AEC" ribbon tab** with Extract Data, Data Panel, Export CSV, Measurement CSV, and AEC Stamps
- **Extract Data button** — Parses all PDF text (via Rust or PDF.js) and finds:
  - Stationing (STA 1+50.00)
  - Elevations (EL 100.50, INV 98.00, RIM 102.5)
  - Pipe sizes (8", 12", 24"), Materials (PVC, RCP, HDPE)
  - Slopes (S=0.005, 0.50%), Pipe lengths (150 LF)
  - Manholes (MH-1, STMH-2), Catch basins (CB-1)
  - Scale notations (1"=20')
- **AEC Data Panel** — Floating panel with search, filter-by-type badges, sortable table
- **CSV Export** — Export extracted AEC data or measurements to CSV

### AEC Construction Stamps (NEW)
16 construction-industry stamps: RFI Required, ASI, Submittal, Shop Drawing, Field Verify, Coordinate, Revise & Resubmit, No Exception Taken, Noted, Hold Point, Issued for Construction, Issued for Permit, Bid Set, Record Drawing, Preliminary, Not for Construction

### Measurement CSV Export (NEW)
Export all measurement annotations (distance, area, perimeter) from the current document as CSV.

### Everything from Open PDF Studio
- Full PDF.js v5.4 + MuPDF WASM + custom Rust vector renderer
- Annotation tools (freehand, shapes, arrows, stamps, highlights, signatures, redaction, image)
- Calibrated measurements with scale bar + snap engine
- XFDF import/export (Bluebeam compatible)
- Dark/light themes, 37 languages
- Multi-tab, session persistence, file locking
- Text selection, search, form fields

---

## Architecture

```
open-civil/
├── open-pdf-studio/          # Main app
│   ├── js/
│   │   ├── aec/              # ★ NEW — AEC module
│   │   │   ├── aec-extractor.js      # Regex parsers for AEC data
│   │   │   └── measurement-export.js # Measurement CSV export
│   │   ├── annotations/      # Annotation engine (stamps.js has AEC_STAMPS)
│   │   ├── core/             # State management, platform
│   │   ├── pdf/              # PDF loading, rendering, saving
│   │   ├── solid/
│   │   │   ├── components/
│   │   │   │   ├── ribbon/
│   │   │   │   │   ├── AecTab.jsx    # ★ NEW — AEC ribbon tab
│   │   │   │   │   └── Ribbon.jsx    # Modified — added AEC tab
│   │   │   │   └── AecDataPanel.jsx  # ★ NEW — Data extraction panel
│   │   │   └── stores/
│   │   │       └── aecStore.js       # ★ NEW — AEC reactive store
│   │   ├── text/             # Text extraction (Rust + PDF.js)
│   │   └── tools/            # Tool management
│   ├── styles/               # CSS (ribbon, panels, themes)
│   └── src-tauri/            # Rust backend
├── open-pdf-render/          # Custom Rust PDF rendering crate
└── README.md
```

## Git Log

```
9f553e5e Module 2+3: AEC stamps, measurement CSV export, enhanced AEC tab
11545314 AEC: Add PDF.js fallback for browser-mode text extraction
e4a85e88 Module 1: AEC Data Extraction System
c94e29a4 Fork & rebrand: Open PDF Studio → OpenCivil
```

---

## License

MIT — inherited from Open PDF Studio.
