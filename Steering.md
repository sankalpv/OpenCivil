# OpenCivil — Product & Engineering Steering Document

> **Purpose:** This document provides a comprehensive overview of the OpenCivil codebase for AI product managers (ChatGPT, Grok, Gemini, Claude). It covers every file, every feature, every technology boundary, and every architectural decision in the system.

---

## 1. Product Overview

**OpenCivil** is an open-source, cross-platform PDF viewer, editor, and annotator built specifically for **AEC (Architecture, Engineering, Construction) professionals**. It is a fork of **Open PDF Studio** (v1.43.0), enhanced with construction-industry-specific tools.

### Market Position

| | OpenCivil | Bluebeam Revu | Adobe Acrobat Pro | Foxit PDF Editor |
|---|:---:|:---:|:---:|:---:|
| **Price** | Free (open-source) | $240/year | $240/year | $130/year |
| **License** | LGPL-3.0 / MIT | Proprietary | Proprietary | Proprietary |
| **AEC data extraction** | ✅ Built-in | ❌ | ❌ | ❌ |
| **Civil3D export** | ✅ LandXML | ❌ | ❌ | ❌ |
| **Construction stamps** | 16 AEC stamps | Custom stamps | Generic stamps | Generic stamps |
| **Measurement export** | CSV/XLSX | Limited | ❌ | ❌ |
| **OCR for drawings** | Tesseract + Bedrock AI | ❌ | ✅ | ✅ |
| **Platforms** | Win, Mac, Linux, Android | Windows only | Win, Mac | Win, Mac, Linux |
| **Offline** | 100% offline-capable | Yes | Cloud-dependent | Yes |
| **Telemetry** | None | Yes | Yes | Minimal |

### Target Users
- Civil engineers reviewing utility plans and grading drawings
- Construction managers marking up RFIs, submittals, and shop drawings
- Inspectors annotating field reports with measurement data
- AEC firms needing Bluebeam-compatible XFDF markup exchange

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        TAURI 2 DESKTOP SHELL                            │
│  src-tauri/src/lib.rs  —  44 Rust commands via IPC                      │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  Rust Backend                                                       ││
│  │  • File I/O (read, write, lock, unlock, rename, delete)            ││
│  │  • Session & preferences persistence (JSON files)                  ││
│  │  • PDF rendering via open-pdf-render crate (pure Rust → RGBA)      ││
│  │  • Printer management (Windows ShellExecuteW + CIM)                ││
│  │  • Plugin install/uninstall (ZIP extraction)                       ││
│  │  • Virtual printer (PowerShell + UAC elevation)                    ││
│  │  • URL download (reqwest), temp file management                    ││
│  │  • PDF bytes cache + parsed document handle cache                  ││
│  └───────────────────────────┬─────────────────────────────────────────┘│
│                              │ IPC: invoke() / Tauri FS plugin          │
│  ┌───────────────────────────▼─────────────────────────────────────────┐│
│  │  WEBVIEW (Vite + SolidJS + Vanilla JS)                              ││
│  │                                                                     ││
│  │  ┌──────────────┐  ┌─────────────┐  ┌──────────────────────────┐   ││
│  │  │  SolidJS UI   │  │  bridge.ts  │  │  Vanilla JS Engine       │   ││
│  │  │  (reactive)   │←─│  (facade)   │←─│  (PDF/canvas/tools)      │   ││
│  │  │  Ribbon, Tabs │  │  re-exports │  │  annotations, events     │   ││
│  │  │  Dialogs,     │  │  store APIs │  │  tool-dispatcher          │   ││
│  │  │  Panels       │  │             │  │  snap-engine              │   ││
│  │  └──────┬────────┘  └─────────────┘  └──────────┬───────────────┘   ││
│  │         │                                        │                   ││
│  │  ┌──────▼────────────────────────────────────────▼───────────────┐  ││
│  │  │              core/state.ts (createMutable)                     │  ││
│  │  │  Central app state — per-document DocumentState objects        │  ││
│  │  │  Interaction state, clipboard, editing, selections             │  ││
│  │  └──────────────────────────┬────────────────────────────────────┘  ││
│  │                             │                                       ││
│  │  ┌──────────────────────────▼────────────────────────────────────┐  ││
│  │  │               PDF PROCESSING LAYER                             │  ││
│  │  │  ┌──────────────────┐  ┌───────────────────┐  ┌────────────┐ │  ││
│  │  │  │  PDF.js v5.4      │  │  pdf-lib v1.17     │  │  MuPDF     │ │  ││
│  │  │  │  READ-ONLY:       │  │  WRITE:            │  │  WASM      │ │  ││
│  │  │  │  • Rendering      │  │  • Save with annot │  │  fallback  │ │  ││
│  │  │  │  • Text layer     │  │  • Create blank    │  │  renderer  │ │  ││
│  │  │  │  • Form fields    │  │  • Page rotation   │  │            │ │  ││
│  │  │  │  • Annotations    │  │  • Merge/extract   │  │            │ │  ││
│  │  │  └──────────────────┘  └───────────────────┘  └────────────┘ │  ││
│  │  └──────────────────────────────────────────────────────────────┘  ││
│  │                                                                     ││
│  │  ┌──────────────────────────────────────────────────────────────┐  ││
│  │  │  AEC MODULE (OpenCivil-specific)                              │  ││
│  │  │  • Regex-based data extraction (stations, elevations, pipes)  │  ││
│  │  │  • OCR via Tesseract.js + AWS Bedrock                        │  ││
│  │  │  • Spatial grouping of extracted data                         │  ││
│  │  │  • Civil3D LandXML export                                    │  ││
│  │  │  • XLSX spreadsheet export                                   │  ││
│  │  └──────────────────────────────────────────────────────────────┘  ││
│  │                                                                     ││
│  │  ┌──────────────────────────────────────────────────────────────┐  ││
│  │  │  i18next (37 languages, 8 namespaces, RTL support)           │  ││
│  │  └──────────────────────────────────────────────────────────────┘  ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  OPEN-PDF-RENDER  (standalone Rust crate, linked as local dependency)   │
│  Pure Rust PDF → RGBA bitmap renderer                                   │
│  lopdf (parsing) + tiny-skia (raster) + ttf-parser (fonts) + rayon     │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Architecture Decisions

1. **Hybrid UI**: SolidJS renders the chrome (ribbon, dialogs, panels). Vanilla JS handles all PDF canvas operations. `bridge.ts` is the decoupling layer.
2. **Three PDF Engines**: PDF.js for viewing, pdf-lib for writing, open-pdf-render for native Rust rendering. They never share parsed state — `originalBytesCache` bridges them.
3. **Tauri 2**: Provides native OS access without Electron's overhead. The app is ~15MB vs Electron's ~150MB.
4. **Document Handle Caching**: The Rust backend caches parsed PDF handles with their font registries, so glyph extraction (the dominant cost) only runs once per font per document.

---

## 3. Technology Stack

| Technology | Version | Role |
|------------|---------|------|
| **Tauri** | 2.10.2 | Desktop shell, IPC, window management, OS integration |
| **SolidJS** | 1.9.11 | Reactive UI framework (ribbon, dialogs, panels) |
| **Vite** | 7.3.1 | Build tool and dev server (port 3041) |
| **PDF.js** (pdfjs-dist) | 5.4.624 | PDF rendering engine (read-only) |
| **pdf-lib** | 1.17.1 | PDF creation and modification (write) |
| **MuPDF** (mupdf WASM) | 1.27.0 | Fallback PDF renderer for complex pages |
| **i18next** | 25.8.13 | Internationalization (37 languages) |
| **Tesseract.js** | 7.0.0 | Client-side OCR for scanned PDF drawings |
| **SheetJS** (xlsx) | 0.18.5 | XLSX spreadsheet export |
| **TypeScript** | 5.9.3 | Partial type checking (types, state, bridge) |
| **Playwright** | 1.59.1 | End-to-end testing |
| **lopdf** | 0.34 | Rust PDF parsing library |
| **tiny-skia** | 0.11 | Rust 2D rasterization (Skia subset) |
| **ttf-parser** | 0.25 | Rust TrueType/OpenType font parser |
| **rayon** | 1.x | Rust data parallelism (batch page rendering) |
| **image** | 0.25 | Rust image encoding (JPEG thumbnails) |
| **reqwest** | 0.12 | Rust HTTP client (PDF URL download, updates) |

### Tauri Plugins (8)

| Plugin | Purpose |
|--------|---------|
| `tauri-plugin-fs` | File system access with security scopes |
| `tauri-plugin-dialog` | Native open/save file dialogs |
| `tauri-plugin-shell` | Open URLs in default browser |
| `tauri-plugin-os` | OS detection (type, version, arch) |
| `tauri-plugin-process` | App exit/restart |
| `tauri-plugin-updater` | Auto-update from GitHub releases (desktop only) |
| `tauri-plugin-deep-link` | `openpdfstudio://` URL scheme handler |
| `tauri-plugin-single-instance` | Prevent multiple app instances, forward files |

---

## 4. Complete File Inventory

### 4.1 Root (`/`)

| File | Purpose |
|------|---------|
| `README.md` | Project README with feature list, comparison table, installation instructions |
| `CLAUDE.md` | Development guidelines — cursor rules, modal style, commit conventions |
| `LICENSE.md` | LGPL-3.0 license text |
| `MEYDENBAUER_PDF_ANALYSIS.md` | Analysis of a specific architectural drawing PDF for testing |
| `PDF_ACCURACY_TEST.md` | PDF rendering accuracy test results and methodology |
| `PDF_TESTING_SUMMARY.txt` | Summary of PDF compatibility testing |
| `package-lock.json` | Root npm lockfile |
| `.gitignore` | Git ignore rules |
| `test_pdf_capabilities.sh` | Shell script for automated PDF rendering tests |
| `test-pdf.pdf` | Sample PDF for testing |
| `2459-TO_Fragmenten.pdf` | Dutch architectural drawing PDF used for font/encoding tests |
| `Repos(Impertio)open-pdf-studioopen-pdf-studioinspect-freetext.js` | Inspection script (legacy) |

### 4.2 `open-pdf-studio/` — Main Application

#### 4.2.1 Root Config Files

| File | Purpose |
|------|---------|
| `package.json` | npm config: name=opencivil, v0.1.0, all dependencies and scripts |
| `package-lock.json` | npm lockfile |
| `vite.config.js` | Vite config: SolidJS plugin, port 3041, Bedrock proxy, MuPDF exclusion, chunk naming |
| `tsconfig.json` | TypeScript config for partial type checking |
| `index.html` | Main HTML entry point — loads Vite, mounts SolidJS app |
| `styles.css` | Master CSS file (imports all style modules) |
| `.gitignore` | App-specific git ignores |
| `.npmrc` | npm registry config |
| `README.md` | App-specific README (older, references Electron) |
| `CLAUDE.md` | Detailed architecture doc with diagrams, rules, file map, conventions |
| `OPENCIVIL.md` | OpenCivil fork documentation — what's new, quick start, architecture |
| `start-linux.sh` | Linux startup script |
| `create-icon.js` | Script to generate app icons from SVG source |
| `inspect-freetext.js` | Debug script to inspect FreeText annotations in a PDF |

#### 4.2.2 Test Files

| File | Purpose |
|------|---------|
| `test-e2e.mjs` | End-to-end tests using Playwright (full app lifecycle) |
| `test-integration.mjs` | Integration tests for PDF loading, annotation, and saving |
| `test-performance-cdp.mjs` | Performance benchmarks via Chrome DevTools Protocol |
| `test-real-pdf.mjs` | Real-world PDF compatibility tests |
| `test-symbols-cdp.mjs` | Symbol palette tests via CDP |
| `test-tauri-cdp.mjs` | Tauri-specific functionality tests via CDP |
| `test-zoom.mjs` | Zoom and pan interaction tests |

#### 4.2.3 `scripts/`

| File | Purpose |
|------|---------|
| `bump-version.js` | Bumps version number in package.json, Cargo.toml, and tauri.conf.json simultaneously |

---

### 4.3 `open-pdf-studio/js/` — JavaScript/TypeScript Source

#### 4.3.1 Entry Points

| File | Purpose |
|------|---------|
| `main.js` | Application entry point — initialization sequence, event wiring, startup orchestration |
| `bridge.ts` | **Critical facade** — vanilla JS calls this to reach SolidJS store functions. The single decoupling layer between the two UI paradigms |
| `theme-init.js` | Early theme detection (runs before SolidJS mounts to prevent flash of wrong theme) |

#### 4.3.2 `js/core/` — Central State & Platform

| File | Purpose |
|------|---------|
| `state.ts` | **Central mutable state** — built on SolidJS `createMutable`. Contains per-document `DocumentState` objects, interaction state (drawing, dragging, panning, measuring), clipboard state, editing state. ~70 getter/setter properties that delegate to sub-stores. Exports `getActiveDocument()`, `noPdf()`, `getPageRotation()` |
| `platform.js` | **Unified Tauri API wrapper** (~508 lines) — provides `isTauri()`, `isMobile()`, file dialogs, binary file I/O, window management, session/preferences persistence, OS info, `invoke()` for Rust commands. Falls back to web APIs when running in browser |
| `preferences.js` | Preferences load/save/apply. Theme management (5 themes: dark, light, blue, high-contrast, system). Per-annotation-type default styles. Preferences dialog launcher |
| `constants.ts` | Application-wide constants (annotation types, tool names, default values) |
| `undo-manager.js` | Undo/redo system — up to 100 levels per document. Records: add/delete/modify annotations, page rotations, bulk operations, watermarks, bookmarks, page structure changes |

#### 4.3.3 `js/core/stores/` — Low-Level State Sub-Stores

| File | Purpose |
|------|---------|
| `interaction-store.ts` | Mutable store for drawing, dragging, panning, measuring, rubber-banding, snapping state |
| `clipboard-store.ts` | Clipboard state for single and multi-annotation copy/paste |
| `editing-store.ts` | Text editing state (annotation text editing, PDF text editing) |
| `document-helpers.ts` | Helper functions for document state management |
| `selection-helpers.ts` | Multi-selection state helpers |

#### 4.3.4 `js/annotations/` — Annotation Engine

| File | Purpose |
|------|---------|
| `factory.js` | Creates annotation objects with default properties. `createAnnotation()` and `cloneAnnotation()` |
| `rendering.js` | **Master annotation renderer** — draws all 20+ annotation types on the overlay canvas using Canvas2D. Handles DPR scaling, spatial index rebuilding, continuous mode. `redrawAnnotations()` is the main entry point |
| `geometry.js` | Hit-testing — `findAnnotationAt(x,y)` checks every annotation type (rects, polygons, ellipses, arcs, polylines) with rotation-aware point-in-shape tests |
| `handles.js` | Resize/rotate handle calculation for selected annotations. Returns handle positions based on annotation type and rotation |
| `transforms.js` | Move, resize, and rotate operations on annotations. Handles callout leader recalculation, dimension text updates, aspect-ratio locking |
| `alignment.js` | Multi-select alignment: left/center/right/top/middle/bottom, horizontal/vertical distribution |
| `clipboard.js` | Copy/paste/duplicate for single and multi-annotation selections. Handles image paste from system clipboard |
| `measurement.js` | Distance, area, perimeter calculations with scale calibration. Supports arc segments, holes in area measurements. Format with units (mm, cm, m, in, ft). Document scale persistence |
| `stamps.js` | Built-in stamps (10 standard + 16 AEC) with SVG rasterization. Custom stamp loading from file |
| `signature.js` | Signature drawing dialog — multi-stroke, save up to 5 |
| `redaction.js` | Mark areas for redaction, apply to permanently remove content |
| `xfdf.js` | XFDF import/export for Bluebeam compatibility — converts between app annotation model and XML format |
| `z-order.js` | Z-ordering (bring to front/back, forward/backward), rotation, horizontal/vertical flip |
| `smart-guides.js` | Alignment guides shown while dragging annotations — snaps to edges/centers of nearby annotations |
| `spatial-index.js` | Grid-based spatial index for fast annotation lookup by viewport region. Used by rendering to skip off-screen annotations |
| `scale-bar.js` | Visual scale bar annotation creation, scale detection from PDF content |
| `dynamic-scaling.js` | Viewport-scale-dependent annotation sizing (annotations scale relative to zoom) |
| `image-drop.js` | Drag-and-drop image insertion as annotation |

#### 4.3.5 `js/annotations/rendering/` — Annotation Rendering Sub-Modules

| File | Purpose |
|------|---------|
| `shapes.js` | Canvas2D drawing for all shape types: rectangle, ellipse, polygon, cloud, cloud-polyline, line, arrow, polyline, arc |
| `measurements.js` | Rendering measurement annotations: distance labels, area fills, perimeter outlines with dimension text |
| `decorations.js` | Line endings (arrows, circles, diamonds, squares), border styles (dashed, dotted) |
| `hatch-patterns.js` | Cross-hatch, diagonal, dots, and other fill patterns for shapes |
| `comment-icons.js` | Sticky note icon rendering (SVG-based comment bubble) |
| `selection.js` | Selection rectangle rendering, resize handles, rotation handle |
| `ui-state.js` | Preview rendering during drawing (rubber-band shapes, polyline in-progress) |

#### 4.3.6 `js/pdf/` — PDF Processing Layer

| File | Purpose |
|------|---------|
| `loader.js` | **PDF loading orchestrator** — manages both PDF.js and pdf-lib documents. `originalBytesCache` (the critical bridge between read and write engines). Handles PDF/A compliance detection, per-page annotation loading with async safety (loadId checks) |
| `renderer.js` | **Page rendering** — renders PDF pages to canvas with DPR-aware HiDPI. Manages single-page and continuous scroll modes. Handles MuPDF fallback, prefetches adjacent pages, manages zoom (fit width, fit page, actual size, custom %) |
| `saver.js` | **PDF saving** — converts app annotations back to PDF annotation dicts via pdf-lib. Handles coordinate transforms (app → PDF, Y-flip, CropBox-relative). Saves form field values |
| `page-manager.js` | Page operations: insert blank, delete, extract, reorder (drag-drop), merge PDFs, replace pages. Copy/cut/paste pages between documents |
| `exporter.js` | Export pages as PNG/JPEG (72-600 DPI), export as raster PDF, export single annotation as image |
| `form-layer.js` | Interactive PDF form rendering — AcroForms and XFA. JavaScript validation, toggle actions, keystroke restrictions. Shows form fields bar |
| `link-layer.js` | Clickable link annotations — internal (go-to-page) and external (open URL) links |
| `crop-margins.js` | Auto-detect whitespace margins and apply CropBox to trim pages |
| `pdf-viewport.js` | GPU-accelerated pan/zoom viewport using requestAnimationFrame. Screen↔world coordinate transforms, pinch-zoom, mouse wheel zoom at cursor |
| `tile-renderer.js` | Tile-based rendering for large pages — splits page into tiles, renders only visible ones, LRU cache eviction |
| `vector-renderer.js` | Renders draw commands from Rust (open-pdf-render) on Canvas2D. Interprets the binary draw command buffer (move, line, cubic, fill, stroke, images, text) |
| `mupdf-renderer.js` | MuPDF WASM fallback renderer — used when PDF.js can't handle complex pages |

#### 4.3.7 `js/pdf/loader/` — PDF Loading Sub-Modules

| File | Purpose |
|------|---------|
| `annotation-converter.js` | Converts PDF.js annotation objects to the app's internal annotation model (20+ types) |
| `color-extraction.js` | Uses pdf-lib to extract annotation colors that PDF.js doesn't provide (interior color, border color) |
| `image-extraction.js` | Extracts embedded images from PDF annotations (stamps, file attachments) |
| `pdf-helpers.js` | Shared PDF utilities (page dimension calculation, rotation helpers) |

#### 4.3.8 `js/pdf/saver/` — PDF Saving Sub-Modules

| File | Purpose |
|------|---------|
| `bookmarks.js` | Saves bookmark/outline tree to PDF via pdf-lib |
| `text-edits.js` | Saves inline PDF text edits back to the content stream |
| `watermarks.js` | Bakes watermark and header/footer annotations into saved PDF |
| `utils.js` | Shared saver utilities (color conversion, rectangle math) |

#### 4.3.9 `js/pdf/form-layer/` — Form Layer Sub-Modules

| File | Purpose |
|------|---------|
| `js-parser.js` | Parses PDF form field JavaScript actions (Calculate, Validate, Format scripts) |
| `validation-ui.js` | UI for form field validation errors and warnings |

#### 4.3.10 `js/tools/` — Tool Management

| File | Purpose |
|------|---------|
| `tool-dispatcher.js` | **Central event router** — handles pointerdown/move/up/dblclick and dispatches to the active tool. Manages drag, resize, draw, rubber-band selection flows |
| `manager.js` | Tool switching — `setTool()` updates cursor, enables/disables text selection, updates PDF/A restrictions |
| `tool-registry.js` | Registry pattern for tool definitions — `registerTool()`, `getTool()`, `getToolCursor()` |
| `tool-context.js` | Builds context object for tool handlers — resolves pointer coordinates, checks modals, provides effective scale |
| `annotation-creators.js` | Creates annotations from tool draw actions — converts start/end coordinates to annotation properties. Handles snapping, bounding box normalization |
| `snap-engine.js` | **Snap engine** — collects snap points from annotations + PDF geometry. Finds nearest endpoint/midpoint/center/edge/intersection/perpendicular snap. Draws snap indicators |
| `pdf-snap-extractor.js` | Extracts vector geometry from PDF content stream for snapping — parses path data into snap points and edge segments |
| `pdf-element-detector.js` | Detects PDF elements under cursor for element-aware interactions |
| `shape-preview.js` | Draws shape preview while user is drawing (before committing) |
| `pan-handler.js` | Pan/scroll handling for both single-page and continuous modes. Middle-button pan support |
| `keyboard-handlers.js` | Keyboard shortcuts — Delete, Ctrl+C/V/Z/Y, arrow nudge, tool hotkeys (V, H, T, N), F-keys |
| `screenshot.js` | Full-page and region screenshot — merges PDF canvas + annotation canvas, copies to clipboard or saves to file |
| `text-edit-tool.js` | Inline PDF text editing — hover detection over text spans, contenteditable overlay, text replacement |
| `text-editing.js` | Text annotation editing — in-place text editing for TextBox, Callout, StickyNote annotations |

#### 4.3.11 `js/tools/tools/` — Individual Tool Implementations

| File | Purpose |
|------|---------|
| `index.js` | Registers all tool implementations with the tool registry |
| `select-tool.js` | Default selection tool — click to select, rubber-band multi-select, drag to move, handles to resize |
| `hand-tool.js` | Pan tool — click-drag to scroll the viewport |
| `draw-tool.js` | Freehand pen drawing tool |
| `line-tool.js` | Line and arrow drawing tool |
| `shape-tool.js` | Shape tools — rectangle, ellipse, cloud |
| `polyline-tool.js` | Polyline and polygon tools — click to add vertices, double-click/Enter to finish |
| `text-tool.js` | Text box and callout annotation creation |
| `measurement-tool.js` | Distance, area, and perimeter measurement tools |
| `arc-tool.js` | Arc segment drawing tool (three-point arc) |
| `angle-tool.js` | Angle measurement tool |
| `calibration-pick-tool.js` | Scale calibration — pick two points on a known dimension |
| `scalebar-tool.js` | Place a visual scale bar annotation |
| `viewport-tool.js` | Viewport scale tool for multi-scale drawings |
| `array-tool.js` | Array/replicate tool — create arrays of annotations |
| `extend-tool.js` | Extend a line or polyline to meet another element |
| `trim-tool.js` | Trim a line or polyline at an intersection |
| `hover-translate-tool.js` | One-click translate — hover over annotation, click to move to new position |
| `plugin-tool.js` | Generic tool handler for plugin-registered custom tools |

#### 4.3.12 `js/text/` — Text Layer & Selection

| File | Purpose |
|------|---------|
| `text-layer.js` | Creates selectable text layer from PDF.js or Rust text spans. Maps PDF fonts to CSS. Injects synthetic spans for Rust-extracted text |
| `text-selection.js` | Text selection handling — mouse drag to select, right-click context menu, `getSelectedText()`, quad points for markup |
| `text-markup.js` | Creates highlight, underline, strikethrough annotations from text selection |
| `rust-text-extraction.js` | Calls Rust `extract_text` / `extract_text_batch` commands via Tauri IPC. Caches results per file+page |

#### 4.3.13 `js/search/` — Find & Replace

| File | Purpose |
|------|---------|
| `find-controller.js` | Search engine — extracts text from all pages, builds search patterns (case, whole word), tracks results with page/offset. Find next/previous navigation. Replace in annotations, text edits, and PDF content |
| `find-bar.js` | Find bar UI — search input, match count, navigation buttons, highlight all matches, replace bar |

#### 4.3.14 `js/aec/` — AEC Data Extraction (OpenCivil-Specific)

| File | Purpose |
|------|---------|
| `aec-extractor.js` | **Core AEC parser** — regex-based extraction of: stations (STA 1+50.00), elevations (EL 100.50, INV 98.00, RIM 102.5), pipe sizes (8", 12", 24"), materials (PVC, RCP, HDPE), slopes (S=0.005, 0.50%), pipe lengths (150 LF), manholes (MH-1, STMH-2), catch basins (CB-1), scale notations (1"=20'). Also builds pipe schedules, exports to CSV, and summarizes records |
| `bedrock-ocr.js` | AWS Bedrock AI integration — renders PDF pages as images, sends to Claude/Bedrock for intelligent AEC data extraction from scanned drawings. Configurable model/region/API key |
| `ocr-extraction.js` | Tesseract.js OCR — client-side OCR for scanned PDFs. Renders pages at 4x scale, preprocesses for OCR, extracts text spans with coordinates |
| `spatial-grouper.js` | Groups extracted AEC data by spatial proximity on the drawing — clusters nearby stations, elevations, and pipe data into logical structure records (e.g., "Manhole MH-1 at STA 1+50, RIM 102.5, INV 98.0") |
| `civil3d-export.js` | **Civil3D LandXML export** — builds storm sewer structures and pipes from extracted data. Calculates real-world coordinates from stations and offsets. Generates LandXML with `<PipeNetwork>`, `<Struct>`, `<Pipe>` elements. Parses slopes, pipe references, and invert elevations |
| `xlsx-export.js` | XLSX spreadsheet export using SheetJS — exports extracted AEC data to a formatted Excel workbook |
| `measurement-export.js` | Exports all measurement annotations (distance, area, perimeter) from the current document as CSV |

#### 4.3.15 `js/services/` — External Services

| File | Purpose |
|------|---------|
| `ai-api.js` | AI service client — auth token management (access + refresh), user registration/login, usage tracking, subscription/plan management, sync and streaming chat API calls |
| `ai-translate.js` | AI-powered document translation — translates text blocks page-by-page, creates overlay annotations with translated text. Undo support |
| `connectivity.js` | Network connectivity detection — online/offline state, automatic retry with exponential backoff, `OfflineError` class |
| `input-history.js` | Input history for AI chat — persists chat history to disk, up/down arrow navigation through previous inputs |
| `mini-markdown.js` | Lightweight Markdown→HTML renderer for AI chat responses (bold, italic, code, links, lists, headers) |

#### 4.3.16 `js/plugins/` — Plugin System

| File | Purpose |
|------|---------|
| `plugin-manager.js` | Plugin lifecycle — `installPluginFromFile()` (ZIP extraction), `loadPlugin()`, `unloadPlugin()`, `loadInstalledPlugins()` on startup |
| `plugin-api.js` | Plugin API sandbox — `createPluginApi(pluginId)` provides controlled access to annotation types, tool palettes, state, and preferences |
| `annotation-type-registry.js` | Registry for plugin-defined custom annotation types with render/hit-test handlers |
| `palette-registry.js` | Registry for plugin-defined tool palettes (floating toolbars) |

#### 4.3.17 `js/watermark/` — Watermarks & Headers/Footers

| File | Purpose |
|------|---------|
| `watermark-dialog.js` | Watermark creation dialog — text/image watermarks with opacity, rotation, position, scale. Header/footer dialog with variables ({page}, {pages}, {date}, {time}, {filename}) |
| `watermark-renderer.js` | Renders watermarks on the canvas — behind content or in front. Handles page range filtering, position calculation, variable substitution |

#### 4.3.18 `js/stores/` — Persistent Stores

| File | Purpose |
|------|---------|
| `places.js` | Bookmarked folder places for quick file access — save/remove favorite directories |
| `sessions.js` | Named workspace sessions — save/restore sets of open documents with page positions |

#### 4.3.19 `js/utils/` — Utilities

| File | Purpose |
|------|---------|
| `colors.js` | Color conversion: hex↔array, parseColor for various formats |
| `fonts.js` | System font detection, font dropdown initialization, font availability checking |
| `helpers.js` | Date formatting, image ID generation, angle snapping, annotation type display names |
| `math.js` | Geometric math: point-to-line distance, point-near-rect, point-near-ellipse |

#### 4.3.20 `js/mobile/` — Mobile Support

| File | Purpose |
|------|---------|
| `touch-gestures.js` | Pinch-zoom, swipe navigation, double-tap zoom for touch devices |
| `recent-files.js` | Recent files management with pin/unpin (persisted to localStorage) |

#### 4.3.21 `js/types/` — TypeScript Type Definitions

| File | Purpose |
|------|---------|
| `annotation.ts` | TypeScript types for all 20+ annotation types (rect, ellipse, polygon, cloud, polyline, line, arrow, highlight, underline, strikethrough, freetext, callout, sticky, stamp, image, signature, redaction, measurement, arc, dimension) |
| `document.ts` | `DocumentState` interface — per-document state (PDF doc, pages, annotations, watermarks, bookmarks, form fields, view mode, zoom, file path, modified flag) |
| `preferences.ts` | Preferences type definitions (theme, language, snap settings, default styles, behavior flags) |
| `ai.ts` | AI service types (chat messages, usage, plans, subscriptions) |
| `global.d.ts` | Global TypeScript declarations (`__TAURI__`, `__APP_VERSION__`, module declarations) |

#### 4.3.22 `js/i18n/` — Internationalization

| File | Purpose |
|------|---------|
| `config.js` | i18next initialization — configures 37 languages, 8 namespaces, lazy loading, fallback language |
| `useTranslation.js` | SolidJS reactive hook — bridges i18next's imperative API with SolidJS signals. Language change triggers reactive re-render. Farsi/Arabic digit localization |

**37 Languages (8 namespaces each = ~296 JSON files):**
`ar` (Arabic), `bg` (Bulgarian), `bn` (Bengali), `ca` (Catalan), `cs` (Czech), `da` (Danish), `de` (German), `el` (Greek), `en` (English), `es` (Spanish), `fa` (Farsi), `fi` (Finnish), `fr` (French), `he` (Hebrew), `hi` (Hindi), `hr` (Croatian), `hu` (Hungarian), `id` (Indonesian), `it` (Italian), `ja` (Japanese), `ko` (Korean), `ms` (Malay), `nb` (Norwegian), `nl` (Dutch), `pl` (Polish), `pt` (Portuguese), `ro` (Romanian), `ru` (Russian), `sk` (Slovak), `sr` (Serbian), `sv` (Swedish), `sw` (Swahili), `ta` (Tamil), `th` (Thai), `tr` (Turkish), `uk` (Ukrainian), `ur` (Urdu), `vi` (Vietnamese), `zh` (Chinese)

**8 Namespaces per language:**
`appMenu.json`, `common.json`, `context.json`, `dialogs.json`, `preferences.json`, `properties.json`, `ribbon.json`, `statusbar.json`

---

### 4.4 `open-pdf-studio/js/solid/` — SolidJS Components

#### 4.4.1 Root Components

| File | Purpose |
|------|---------|
| `App.jsx` | Root desktop component — assembles TitleBar, Ribbon, FindBar, main canvas area, LeftPanel, PropertiesPanel, StatusBar, all dialog hosts, overlays |
| `MobileApp.jsx` | Root mobile component — simplified layout for touch devices |

#### 4.4.2 `components/` — UI Components

| File | Purpose |
|------|---------|
| `TitleBar.jsx` | Custom window title bar (no native decorations) — app icon, document title, minimize/maximize/close buttons |
| `DocumentTabs.jsx` | Multi-tab bar — tab per open PDF, drag-to-reorder, close button, unsaved indicator, context menu |
| `StatusBar.jsx` | Bottom bar — page number, zoom slider, zoom percentage, view mode toggle, page dimensions |
| `FindBar.jsx` | Search bar — search input, match count, prev/next, highlight all, match case, whole word, replace bar |
| `ToolPalette.jsx` | Floating/dockable tool palette — all annotation tools, dock to left/right |
| `ExtensionToolPalette.jsx` | Tool palette for plugin-registered tools |
| `SymbolPalette.jsx` | Symbol library palette — NEN 1414 symbols, custom symbols, drag to place |
| `ContextMenu.jsx` | Right-click context menu — dynamic items based on clicked element |
| `Dialog.jsx` | Base dialog component — draggable, Windows-style (square corners, gradient title bar) |
| `DialogHost.jsx` | Mounts active dialog from dialogStore |
| `LoadingOverlay.jsx` | Full-screen loading spinner with message |
| `NotificationBar.jsx` | Top notification bar for non-blocking messages |
| `PdfABar.jsx` | PDF/A compliance bar — warns user about read-only mode |
| `FormFieldsBar.jsx` | Form fields notification bar — shown when form fields are detected |
| `StickyNotePopup.jsx` | Floating popup for editing sticky note content |
| `TextEditOverlay.jsx` | Overlay for inline text annotation editing |
| `PdfTextEditOverlay.jsx` | Overlay for inline PDF content text editing |
| `ScreenshotOverlay.jsx` | Region selection overlay for screenshot tool |
| `AecDataPanel.jsx` | **OpenCivil-specific** — floating AEC data panel with search, type filter badges, sortable table |
| `AIPanel.jsx` | AI chat panel — conversation UI, streaming responses, model selection |
| `SchedulePanel.jsx` | Schedule/timeline panel (placeholder for future functionality) |
| `AccountDropdown.jsx` | User account dropdown (AI service login/logout) |

#### 4.4.3 `components/ribbon/` — Ribbon Interface (7+ Tabs)

| File | Purpose |
|------|---------|
| `Ribbon.jsx` | Ribbon container — manages tab switching, collapse/expand, responsive layout |
| `RibbonTab.jsx` | Individual ribbon tab component |
| `RibbonGroup.jsx` | Group within a tab (labeled section with separator) |
| `RibbonButton.jsx` | Standard ribbon button with icon + label |
| `RibbonButtonStack.jsx` | Vertical stack of small ribbon buttons |
| `SplitButton.jsx` | Button with dropdown (e.g., Save ▼ for Save As) |
| `ColorPickerButton.jsx` | Color picker dropdown integrated into ribbon |
| `ThemePicker.jsx` | Theme selection dropdown (Dark, Light, Blue, High Contrast, System) |
| `autoShrinkLabel.js` | Utility to auto-shrink ribbon button labels when space is tight |
| `HomeTab.jsx` | Home tab — clipboard, undo/redo, font, paragraph, styles gallery, editing tools |
| `CommentTab.jsx` | Comment tab — all annotation tools (shapes, text, markup, stamps, signatures, measurement) |
| `ViewTab.jsx` | View tab — zoom, page navigation, view modes, panels, grid, ruler |
| `MeasureTab.jsx` | Measure tab — distance, area, perimeter, angle, scale calibration |
| `OrganizeTab.jsx` | Organize tab — page operations (insert, delete, extract, merge, reorder, rotate) |
| `ArrangeTab.jsx` | Arrange tab — alignment, distribution, z-order, flip, rotate, match size |
| `FormatTab.jsx` | Format tab — fill, stroke, line width, opacity, border style, blend mode, hatch pattern |
| `HelpTab.jsx` | Help tab — keyboard shortcuts, about, preferences, feedback, updates |
| `AecTab.jsx` | **OpenCivil-specific** — AEC ribbon tab: Extract Data, Data Panel, Export CSV, Measurement CSV, AEC Stamps, Civil3D Export |
| `AITab.jsx` | AI tab — translate, AI chat, AI data extraction |

#### 4.4.4 `components/app-menu/` — Application Menu (File Menu)

| File | Purpose |
|------|---------|
| `AppMenu.jsx` | Full-screen app menu overlay (like Office backstage) |
| `OpenPanel.jsx` | Open file panel — recent files, pinned files, browse, open URL |
| `ExportPanel.jsx` | Export panel — export as images, raster PDF, XFDF |
| `ImportPanel.jsx` | Import panel — import XFDF annotations |
| `ExtensionsPanel.jsx` | Plugin management panel — install/uninstall/enable extensions |
| `AboutPanel.jsx` | About screen — version, license, credits |

#### 4.4.5 `components/dialogs/` — Modal Dialogs

| File | Purpose |
|------|---------|
| `AboutDialog.jsx` | About box with version and license info |
| `BookmarkDialog.jsx` | Create/edit bookmark with title, color, style |
| `CalibrationDialog.jsx` | Scale calibration — enter known distance and unit |
| `ConfirmDialog.jsx` | Generic confirmation dialog (Yes/No/Cancel) |
| `CropMarginsDialog.jsx` | Crop margins settings (padding, threshold, apply-to options) |
| `DeletePagesDialog.jsx` | Page deletion confirmation |
| `ExtractPagesDialog.jsx` | Extract pages options (page range, delete from original) |
| `ExtensionsDialog.jsx` | Extension/plugin management dialog |
| `FeedbackDialog.jsx` | User feedback submission form |
| `FormValidationDialog.jsx` | Form field validation error details |
| `HeaderFooterDialog.jsx` | Header/footer creation with variables and positioning |
| `InsertPageDialog.jsx` | Insert blank page dialog (size, orientation, position) |
| `ManageWatermarksDialog.jsx` | List, edit, delete watermarks and headers/footers |
| `MergePdfsDialog.jsx` | Merge multiple PDFs — file list, reorder, position |
| `MessageDialog.jsx` | Generic message dialog |
| `NewDocDialog.jsx` | New document creation (size presets or custom dimensions) |
| `PagePropertiesDialog.jsx` | View page properties (dimensions, rotation) |
| `PageSetupDialog.jsx` | Page setup for printing (margins, orientation) |
| `PrintDialog.jsx` | Full print dialog — printer selection, page range, scaling, copies, preview |
| `ScaleDialog.jsx` | Manual scale entry dialog |
| `ShortcutsDialog.jsx` | Keyboard shortcuts reference |
| `SignatureDialog.jsx` | Signature drawing/selection dialog |
| `StampPickerDialog.jsx` | Stamp selection grid (standard + AEC stamps) |
| `TextAnnotationDialog.jsx` | Text annotation properties (font, size, alignment) |
| `TitleBlockDialog.jsx` | Title block template insertion |
| `UpdateDialog.jsx` | Auto-update dialog (download progress, skip version, remind later) |
| `ViewportScaleDialog.jsx` | Viewport-specific scale settings for multi-scale drawings |
| `WatermarkDialog.jsx` | Watermark creation (text/image, opacity, rotation, position) |
| `AILoginDialog.jsx` | AI service login dialog |
| `AIPlanDialog.jsx` | AI subscription plan selection |
| `AITranslateDialog.jsx` | AI translation options (target language, page range) |

#### 4.4.6 `components/left-panel/` — Left Navigation Panel (10 Tabs)

| File | Purpose |
|------|---------|
| `LeftPanel.jsx` | Left panel container — manages 11 tabs, collapse/expand |
| `LeftPanelTab.jsx` | Individual tab button component |
| `ThumbnailItem.jsx` | Page thumbnail component — lazy-rendered, draggable for reorder |

#### 4.4.7 `components/left-panel/panels/` — Left Panel Tab Contents

| File | Purpose |
|------|---------|
| `ThumbnailsPanel.jsx` | Page thumbnails — grid view, drag-to-reorder, right-click context menu |
| `BookmarksPanel.jsx` | Bookmark tree — hierarchical, editable, color-coded |
| `AnnotationsPanel.jsx` | Annotation list — grouped by page, click to navigate, filter by type |
| `MeasurementsPanel.jsx` | Measurement list — all measurements with values and units |
| `AttachmentsPanel.jsx` | File attachments embedded in the PDF |
| `SignaturesPanel.jsx` | Digital signature validation panel |
| `LayersPanel.jsx` | PDF optional content groups (layers) — toggle visibility |
| `FormFieldsPanel.jsx` | Form field listing — navigate to fields |
| `DestinationsPanel.jsx` | Named destinations listing |
| `LinksPanel.jsx` | Link annotations listing |
| `TagsPanel.jsx` | PDF structure tags tree (accessibility) |

#### 4.4.8 `components/properties-panel/` — Right Properties Panel

| File | Purpose |
|------|---------|
| `PropertiesPanel.jsx` | Right panel container — shows properties of selected annotation or document info |
| `PanelHeader.jsx` | Panel header with title and collapse button |
| `CollapsibleSection.jsx` | Expandable/collapsible section within properties |
| `GeneralSection.jsx` | Common properties — type, author, subject, creation date |
| `AppearanceSection.jsx` | Visual properties — fill, stroke, opacity, border style, blend mode |
| `DimensionsSection.jsx` | Position and size (x, y, width, height, rotation) |
| `ContentSection.jsx` | Text content, popup text, reply text |
| `TextFormatSection.jsx` | Font family, size, weight, color, alignment |
| `ParagraphSection.jsx` | Paragraph properties — line spacing, alignment |
| `HatchPatternSection.jsx` | Hatch fill pattern selection and configuration |
| `LineEndingsSection.jsx` | Start/end arrow style selection |
| `MeasurementSection.jsx` | Measurement-specific properties (scale, units, precision) |
| `ImageSection.jsx` | Image annotation properties (original size, fit mode) |
| `ActionsSection.jsx` | Annotation actions (flatten, edit, set as default style) |
| `CustomFieldsSection.jsx` | Custom key-value properties |
| `RepliesSection.jsx` | Annotation reply thread |
| `DocInfoView.jsx` | Document info (when no annotation selected) — title, author, pages, file size |
| `ColorPalettePicker.jsx` | Reusable color palette picker used across sections |

#### 4.4.9 `components/preferences/` — Preferences Dialog

| File | Purpose |
|------|---------|
| `PreferencesDialog.jsx` | Preferences dialog with tabbed sections |
| `GeneralTab.jsx` | General settings — theme, language, startup behavior |
| `PageDisplayTab.jsx` | Page display — default zoom, view mode, background color |
| `AnnotationsTab.jsx` | Annotation defaults — colors, line widths, font |
| `BehaviorTab.jsx` | Behavior — auto-save, confirm on close, snap settings |
| `FileAssocTab.jsx` | File association — set as default PDF app (Windows) |
| `VirtualPrinterTab.jsx` | Virtual printer install/uninstall (Windows) |
| `LanguageSelect.jsx` | Language dropdown with flag icons |
| `PrefColorPicker.jsx` | Color picker for preferences |
| `PrefComboBox.jsx` | Combo box for preferences |
| `PrefSelect.jsx` | Select dropdown for preferences |
| `useDropdown.js` | Dropdown positioning hook |

#### 4.4.10 `stores/` — SolidJS Signal Stores (22)

| File | Purpose |
|------|---------|
| `ribbonStore.js` | Active ribbon tab, collapse state |
| `dialogStore.js` | Active dialog stack, dialog parameters |
| `leftPanelStore.js` | Left panel visibility, active tab, width |
| `propertiesStore.js` | Properties panel visibility, active section |
| `findBarStore.js` | Find bar state (query, results, options) |
| `contextMenuStore.js` | Context menu position and items |
| `appMenuStore.js` | App menu open/close state |
| `loadingStore.js` | Loading overlay state and message |
| `formatStore.js` | Format ribbon state (fill, stroke, opacity selections) |
| `fontStore.js` | Available fonts, selected font |
| `formFieldsBarStore.js` | Form fields bar visibility |
| `pdfaBarStore.js` | PDF/A bar visibility and compliance info |
| `pdfTextEditStore.js` | PDF text edit overlay state |
| `textEditOverlayStore.js` | Text annotation edit overlay state |
| `stickyNotePopupStore.js` | Sticky note popup position and content |
| `screenshotStore.js` | Screenshot overlay state (region selection) |
| `symbolStore.js` | Symbol palette visibility and selected symbols |
| `aecStore.js` | **OpenCivil-specific** — AEC extraction state (records, loading, panel visibility) |
| `aiStore.js` | AI panel state (messages, session, loading) |
| `scheduleStore.js` | Schedule panel state |
| `defaultAppBarStore.js` | "Set as default app" notification bar |
| `paletteOrder.js` | Tool palette button order persistence |

#### 4.4.11 `stores/panels/` — Left Panel Sub-Stores (10)

| File | Purpose |
|------|---------|
| `thumbnailStore.js` | Thumbnail rendering state, selection |
| `bookmarksStore.js` | Bookmark tree state, expand/collapse, CRUD operations |
| `annotationsStore.js` | Annotation list state, filtering, sorting |
| `attachmentsStore.js` | Attachment list state |
| `signaturesStore.js` | Digital signature state |
| `layersStore.js` | Layer visibility state |
| `formFieldsStore.js` | Form fields list state |
| `destinationsStore.js` | Named destinations state |
| `linksStore.js` | Links list state |
| `tagsStore.js` | Tags tree state |

#### 4.4.12 `data/` — Static Data

| File | Purpose |
|------|---------|
| `ribbonIcons.js` | SVG icon paths for all ribbon buttons |
| `leftPanelIcons.js` | SVG icon paths for left panel tabs |
| `contextMenuIcons.js` | SVG icon paths for context menu items |
| `symbolLibrary.js` | Symbol definitions (custom shapes for civil/mechanical) |
| `nen1414Library.js` | NEN 1414 Dutch fire safety symbol library metadata |

---

### 4.5 `open-pdf-studio/js/ui/` — Vanilla JS UI Components

#### 4.5.1 Root

| File | Purpose |
|------|---------|
| `setup.js` | UI initialization — wires up DOM events, canvas setup |
| `dom-elements.js` | DOM element references (cached querySelector results) |
| `cursor.js` | Cursor management — sets cursor based on tool/state |

#### 4.5.2 `chrome/` — Window Chrome

| File | Purpose |
|------|---------|
| `tabs.js` | Multi-tab document management — add/remove/switch tabs, unsaved indicators |
| `status-bar.js` | Status bar updates (page number, zoom %, dimensions) |
| `context-menus.js` | Context menu construction and positioning |
| `dialogs.js` | Legacy dialog helpers (before SolidJS migration) |
| `menus.js` | Menu construction utilities |
| `confirm-dialog.js` | Confirmation dialog utility |
| `updater.js` | Auto-update check and download UI |

#### 4.5.3 `cursors/`

| File | Purpose |
|------|---------|
| `annotation-cursors.js` | Custom cursor images for annotation tools (crosshair, pen, eraser, etc.) |

#### 4.5.4 `panels/` — Vanilla JS Panel Logic

| File | Purpose |
|------|---------|
| `left-panel.js` | Left panel toggle and tab switching |
| `annotations-list.js` | Annotation list panel logic |
| `attachments.js` | Attachments panel logic |
| `bookmarks.js` | Bookmarks panel CRUD operations |
| `destinations.js` | Named destinations panel |
| `form-fields.js` | Form fields panel logic |
| `layers.js` | Layers panel visibility toggles |
| `links.js` | Links panel logic |
| `properties-panel.js` | Properties panel toggle |
| `signatures.js` | Digital signatures panel |
| `tags.js` | Tags tree panel |

#### 4.5.5 `setup/`

| File | Purpose |
|------|---------|
| `navigation-events.js` | Page navigation keyboard/mouse events (arrow keys, page up/down, scroll) |

---

### 4.6 `open-pdf-studio/styles/` — CSS Stylesheets (20)

| File | Purpose |
|------|---------|
| `base.css` | CSS reset, scrollbar styling, global variables |
| `layout.css` | Main layout grid (title bar, ribbon, content area, panels) |
| `themes.css` | 5 theme definitions (dark, light, blue, high-contrast, system) with CSS custom properties |
| `fonts.css` | @font-face declarations, font stack defaults |
| `ribbon.css` | Ribbon bar styling (tabs, groups, buttons, dropdowns) |
| `document-tabs.css` | Document tab bar styling |
| `titlebar.css` | Custom title bar (minimize, maximize, close buttons) |
| `panels.css` | Left and right panel styling |
| `properties-panel.css` | Right properties panel detailed styling |
| `status-bar.css` | Bottom status bar styling |
| `context-menu.css` | Right-click context menu styling |
| `dialogs.css` | Modal dialog base styling (Windows Forms aesthetic) |
| `find-bar.css` | Find/replace bar styling |
| `form-layer.css` | PDF form field overlay styling |
| `text-layer.css` | Text selection layer styling |
| `page-controls.css` | Page navigation controls styling |
| `tool-palette.css` | Floating tool palette styling |
| `symbol-palette.css` | Symbol palette styling |
| `app-menu.css` | Full-screen app menu (backstage) styling |
| `mobile.css` | Mobile-specific responsive overrides |
| `rtl.css` | Right-to-left language support (Arabic, Hebrew, Farsi, Urdu) |
| `ai-panel.css` | AI chat panel styling |
| `schedule-panel.css` | Schedule panel styling |

---

### 4.7 `open-pdf-studio/src-tauri/` — Rust Backend

#### 4.7.1 Source

| File | Purpose |
|------|---------|
| `src/lib.rs` | **All 44 Tauri commands** (see Section 6 below) + app initialization, plugin registration, window setup |
| `src/main.rs` | Tauri entry point — calls `app_lib::run()` |
| `build.rs` | Tauri build script |

#### 4.7.2 Configuration

| File | Purpose |
|------|---------|
| `Cargo.toml` | Rust dependencies — tauri 2.10.2, 8 plugins, open-pdf-render, reqwest, zip, image. Dev profile with opt-level=3 for rendering crates |
| `tauri.conf.json` | Tauri config — product name "OpenCivil", window settings, CSP policy, bundle targets (NSIS/DMG/deb/AppImage), file associations (.pdf), updater endpoint, deep-link scheme |
| `.gitignore` | Rust build artifact ignores |

#### 4.7.3 Windows-Specific

| File | Purpose |
|------|---------|
| `pdfium-win64.tgz` | PDFium library for Windows (legacy, may not be used) |
| `pdfium-win64.zip` | PDFium library ZIP (legacy) |
| `nsis/installer.nsi` | NSIS installer template (custom Windows installer UI) |
| `nsis/hooks.nsh` | NSIS installer hooks (file association, start menu) |
| `pdfium-extract/` | PDFium extraction directory (build artifact) |

#### 4.7.4 `icons/`
App icons in multiple sizes: 32×32, 128×128, 128×128@2x, icon.icns (macOS), icon.ico (Windows), icon.png

#### 4.7.5 `capabilities/`
Tauri 2 capability files defining which plugins and commands each window can access.

---

### 4.8 `open-pdf-render/` — Pure Rust PDF Rendering Crate

#### 4.8.1 Source (`src/`)

| File | Purpose |
|------|---------|
| `lib.rs` | Public API — `PdfRenderer`, `RenderedPage` (width, height, RGBA bytes), `TextSpan` (text with position/size), `PageType` enum (Vector/Tile), `RenderError` |
| `parser.rs` | `DocumentHandle` — loads PDF via lopdf, extracts page dimensions, content streams, MediaBox/CropBox. Provides `render_page()`, `extract_draw_commands()`, `extract_text_spans()`, `analyze_page_type()`. Batch operations via rayon |
| `interpreter.rs` | PDF content stream interpreter — walks all graphics operators (moveto, lineto, curveto, rectangle, fill, stroke, clip, text, image). Builds draw command buffer. Extracts text spans with position. Handles Form XObjects recursively |
| `renderer.rs` | `SkiaRenderer` — renders draw commands to RGBA bitmap via tiny-skia. Implements path building, fill (even-odd/winding), stroke (line cap/join/dash), image drawing with CTM transform |
| `text_renderer.rs` | Renders text glyphs — `render_text_glyphs()` and `render_cid_text_glyphs()` using parsed font outlines on tiny-skia paths |
| `font_parser.rs` | `ParsedFont` — parses TrueType/OpenType fonts embedded in PDF. Extracts glyph outlines (contours, Bézier curves) using ttf-parser. Converts quadratic to cubic curves |
| `fonts.rs` | `FontRegistry` — caches parsed fonts per document. Resolves font references from PDF Resources. Handles Type1, TrueType, CIDFont with ToUnicode mapping. Falls back to system fonts |
| `encoding.rs` | PDF character encoding — WinAnsiEncoding, MacRomanEncoding, glyph name→Unicode mapping, Differences array parsing |
| `color.rs` | Color space conversion — CMYK→RGB, Gray→RGB, RGB→RGBA8 |
| `graphics_state.rs` | `GraphicsState` stack — current transform matrix (CTM), fill/stroke colors, line width, line cap/join, dash pattern, miter limit |
| `image_decode.rs` | Placeholder for inline image decoding (minimal implementation) |
| `draw_commands.rs` | `DrawCommandBuffer` — compact binary format for serializing draw commands between Rust and JS. Opcodes: MoveTo, LineTo, CubicTo, Rect, ClosePath, SetStroke, SetFill, Stroke, Fill, FillEvenOdd, SaveState, RestoreState, Transform, SetLineCap, SetLineJoin, SetMiterLimit, SetDash, BeginPath, TextAt, Clip, ClipEvenOdd, DrawImage |

#### 4.8.2 Tests (`tests/`) — 22 Test Files

| File | Purpose |
|------|---------|
| `render_test.rs` | Basic rendering smoke tests |
| `test_2459.rs` | Tests for the 2459-TO_Fragmenten.pdf (Dutch architectural) |
| `test_2459_compare.rs` | Visual comparison tests for 2459 |
| `test_2459_fonts.rs` | Font extraction tests for 2459 |
| `test_2459_render.rs` | Rendering tests for 2459 |
| `test_3037_cmap.rs` | CMap (character map) parsing tests |
| `test_3037_encoding.rs` | Character encoding tests |
| `test_3037_findF.rs` | Font finding tests |
| `test_3037_fonts.rs` | Font registry tests |
| `test_3037_fonttype.rs` | Font type detection tests |
| `test_3037_glyphmap.rs` | Glyph mapping tests |
| `test_3037_render.rs` | Rendering tests for document 3037 |
| `test_3037_tounicode.rs` | ToUnicode CMap parsing tests |
| `test_3037_trace.rs` | Content stream tracing tests |
| `test_all_pdfs.rs` | Batch rendering tests across all sample PDFs |
| `test_meydenbauer_drawing.rs` | Architectural drawing rendering test |
| `test_real_pdf.rs` | Real-world PDF compatibility tests |
| `test_tauri_command.rs` | Tests for Tauri command integration |
| `test_text_analysis.rs` | Text extraction analysis |
| `test_text_count.rs` | Text character counting tests |
| `test_text_debug.rs` | Text extraction debugging |
| `test_xobj_text.rs` | Text extraction from Form XObjects |

#### 4.8.3 Examples

| File | Purpose |
|------|---------|
| `examples/inspect_page.rs` | CLI tool to inspect a PDF page's content stream and draw commands |

---

### 4.9 `open-pdf-studio/assets/` — Static Assets

#### `assets/nen1414/` — NEN 1414 Fire Safety Symbols (~95 PNG files)
Dutch fire safety standard symbols: fire equipment (`Tb*`), danger signs (`Td*`), rescue signs (`Tn*`, `Tr*`), warning signs (`Tv*`, `Tw*`). Used in the Symbol Palette for Dutch AEC users.

### 4.10 `open-pdf-studio/public/` — Static Public Files

| File | Purpose |
|------|---------|
| `favicon.ico` | Browser tab icon |
| `icon.ico` | Windows icon |
| `icon.png` | General icon |
| `icon.svg` | Vector icon source |
| `_redirects` | Netlify redirect rules (for web deployment) |
| `js/theme-init.js` | Pre-SolidJS theme initialization (prevents flash of wrong theme) |
| `pdfjs/` | PDF.js worker and CMap files |

---

### 4.11 Packaging & Distribution

#### `flatpak/`

| File | Purpose |
|------|---------|
| `org.openaec.OpenPdfStudio.yml` | Flatpak build manifest |
| `org.openaec.OpenPdfStudio.desktop` | Linux desktop entry |
| `org.openaec.OpenPdfStudio.metainfo.xml` | AppStream metadata (for Linux app stores) |

#### `snap/`

| File | Purpose |
|------|---------|
| `snapcraft.yaml` | Snap package build config |
| `gui/open-pdf-studio.desktop` | Linux desktop entry for Snap |
| `gui/open-pdf-studio.png` | Snap store icon |

#### `android-apk/`
Contains Android build outputs (`app/build/outputs/`).

### 4.12 `mcp-server/` — MCP Testing Server

| File | Purpose |
|------|---------|
| `README.md` | Documentation for MCP server testing |
| `test-symbols-cdp.mjs` | Tests symbol palette via Chrome DevTools Protocol |
| `test-tauri-cdp.mjs` | Tests Tauri functionality via CDP |
| `test-zoom-pan.mjs` | Tests zoom and pan interactions via CDP |

### 4.13 `docs/` — Documentation

| File | Purpose |
|------|---------|
| `snap-banner.svg` | Snap Store banner image |
| `screenshots/main-view.jpg` | Main view screenshot for README |
| `screenshots/comment-tools.jpg` | Comment tools screenshot |
| `screenshots/print-dialog.jpg` | Print dialog screenshot |
| `superpowers/plans/` | 6 planning documents for rendering engine evolution |
| `superpowers/specs/` | 5 design specification documents |

---

## 5. Feature Map

| Feature | Implementing Files |
|---------|-------------------|
| **PDF rendering** | `pdf/renderer.js`, `pdf/tile-renderer.js`, `pdf/vector-renderer.js`, `pdf/mupdf-renderer.js`, `open-pdf-render/` |
| **Pan/zoom viewport** | `pdf/pdf-viewport.js`, `tools/pan-handler.js` |
| **Annotation drawing** | `tools/tool-dispatcher.js`, `tools/annotation-creators.js`, `annotations/factory.js` |
| **Annotation rendering** | `annotations/rendering.js`, `annotations/rendering/*` |
| **Shape tools** | `tools/tools/shape-tool.js`, `tools/tools/line-tool.js`, `tools/tools/polyline-tool.js`, `tools/tools/arc-tool.js` |
| **Measurement tools** | `tools/tools/measurement-tool.js`, `annotations/measurement.js`, `annotations/scale-bar.js` |
| **Text annotations** | `tools/tools/text-tool.js`, `tools/text-editing.js` |
| **PDF text editing** | `tools/text-edit-tool.js` |
| **Stamps** | `annotations/stamps.js`, `solid/components/dialogs/StampPickerDialog.jsx` |
| **Signatures** | `annotations/signature.js`, `solid/components/dialogs/SignatureDialog.jsx` |
| **Snap engine** | `tools/snap-engine.js`, `tools/pdf-snap-extractor.js` |
| **Selection & alignment** | `annotations/alignment.js`, `annotations/smart-guides.js`, `tools/tools/select-tool.js` |
| **Clipboard** | `annotations/clipboard.js` |
| **Undo/redo** | `core/undo-manager.js` |
| **PDF saving** | `pdf/saver.js`, `pdf/saver/*` |
| **Page management** | `pdf/page-manager.js` |
| **XFDF import/export** | `annotations/xfdf.js` |
| **Form fields** | `pdf/form-layer.js`, `pdf/form-layer/*` |
| **Text selection** | `text/text-selection.js`, `text/text-layer.js`, `text/text-markup.js` |
| **Find & replace** | `search/find-controller.js`, `search/find-bar.js` |
| **Watermarks** | `watermark/watermark-dialog.js`, `watermark/watermark-renderer.js` |
| **Multi-tab** | `ui/chrome/tabs.js`, `solid/components/DocumentTabs.jsx` |
| **Printing** | `solid/components/dialogs/PrintDialog.jsx`, Tauri commands: `get_printers`, `print_pdf` |
| **Export** | `pdf/exporter.js` |
| **Preferences** | `core/preferences.js`, `solid/components/preferences/*` |
| **i18n** | `i18n/config.js`, `i18n/useTranslation.js`, `i18n/locales/` |
| **Plugin system** | `plugins/plugin-manager.js`, `plugins/plugin-api.js`, `plugins/*-registry.js` |
| **AEC extraction** | `aec/aec-extractor.js`, `aec/bedrock-ocr.js`, `aec/ocr-extraction.js` |
| **AEC spatial grouping** | `aec/spatial-grouper.js` |
| **Civil3D export** | `aec/civil3d-export.js` |
| **XLSX export** | `aec/xlsx-export.js` |
| **AI chat** | `services/ai-api.js`, `solid/components/AIPanel.jsx` |
| **AI translation** | `services/ai-translate.js`, `solid/components/dialogs/AITranslateDialog.jsx` |

---

## 6. Tauri Commands (44 IPC Commands)

### File Operations (8)
| Command | Purpose |
|---------|---------|
| `read_file` | Read binary file from disk |
| `write_file` | Write base64-encoded data to file |
| `file_exists` | Check if a file exists |
| `delete_file` | Delete a file |
| `rename_file` | Rename/move a file |
| `lock_file` | Lock file (FILE_SHARE_READ on Windows, advisory on Unix) |
| `unlock_file` | Release file lock |
| `allow_fs_scope` | Grant Tauri FS plugin access to a specific path |

### Session & Preferences (5)
| Command | Purpose |
|---------|---------|
| `save_session` | Save session JSON to app data dir |
| `load_session` | Load session JSON |
| `save_preferences` | Save preferences JSON |
| `load_preferences` | Load preferences JSON |
| `get_username` | Get OS username (via whoami crate) |

### PDF Rendering — open-pdf-render (10)
| Command | Purpose |
|---------|---------|
| `render_pdf_page` | Render page to RGBA bitmap, write to temp file, return path |
| `render_thumbnail` | Render low-res thumbnail, return as base64 JPEG data URL |
| `analyze_page_type` | Determine if page is Vector or Tile type |
| `extract_draw_commands` | Extract binary draw command buffer for a page |
| `extract_draw_commands_batch` | Batch extract draw commands (parallel via rayon) |
| `extract_text` | Extract text spans with positions for one page |
| `extract_text_batch` | Batch text extraction (parallel via rayon) |
| `extract_page_text` | Extract text as JSON positions string |
| `get_page_dimensions` | Get all page dimensions (parallelized) |
| `invalidate_pdf_cache` / `clear_pdf_cache` | Cache management for bytes and document handles |

### Printing (4)
| Command | Purpose |
|---------|---------|
| `get_printers` | List installed printers via PowerShell CIM (Windows) |
| `print_pdf` | Print to specific printer via ShellExecuteW (Windows) |
| `open_printer_properties` | Open printer preferences dialog (Windows) |
| `write_temp_pdf` | Write binary data to temp file for printing |

### Virtual Printer (3)
| Command | Purpose |
|---------|---------|
| `install_virtual_printer` | Install "Open PDF Studio" printer via PowerShell + UAC |
| `remove_virtual_printer` | Remove virtual printer |
| `is_virtual_printer_installed` | Check if virtual printer exists |

### Plugin System (4)
| Command | Purpose |
|---------|---------|
| `list_plugins` | List installed plugins from app data dir |
| `install_plugin` | Extract plugin ZIP, validate plugin.json, install to plugins dir |
| `uninstall_plugin` | Remove plugin directory |
| `read_plugin_file` | Read a file from within a plugin directory (path-traversal safe) |

### System (7)
| Command | Purpose |
|---------|---------|
| `get_opened_file` | Get PDF files passed via command line |
| `is_dev_mode` | Check if running in debug mode |
| `is_default_pdf_app` | Check if app is default PDF handler (Windows) |
| `open_default_apps_settings` | Open Windows Default Apps settings |
| `open_url` | Open URL in default browser |
| `get_temp_dir` | Get system temp directory |
| `play_alert_sound` | Play system alert sound (platform-specific) |

### Networking (2)
| Command | Purpose |
|---------|---------|
| `download_pdf_from_url` | Download PDF from URL to temp file |
| `list_pdf_files` | List PDF files in a directory |

---

## 7. Data Flow

### 7.1 Opening a PDF

```
User selects file → platform.openFileDialog() → Tauri FS plugin reads bytes
→ originalBytesCache stores raw bytes
→ PDF.js loads document (from bytes.slice()) → pdfDoc
→ pdf-lib loads document (from originalBytesCache) → pdfDocLib
→ Rust parses document → DocHandleCache stores handle
→ renderer.renderPage() → PDF.js renders to <canvas id="pdf-canvas">
→ text-layer created (from Rust or PDF.js)
→ form-layer created (from PDF.js)
→ link-layer created (from PDF.js)
→ annotations loaded per-page (annotation-converter.js)
→ annotations drawn on <canvas id="annotation-canvas">
```

### 7.2 Saving a PDF

```
User clicks Save → saver.savePDF()
→ pdf-lib reads originalBytesCache for this file
→ For each page, for each annotation:
    → Convert app coords to PDF coords (Y-flip, CropBox offset)
    → Create PDF annotation dict via pdf-lib
→ Save form field values to pdf-lib
→ Save bookmarks, watermarks, text edits
→ pdfDocLib.save() → new Uint8Array
→ unlock_file() → write bytes → lock_file()
→ Update originalBytesCache with new bytes
→ invalidate_pdf_cache (Rust side)
```

### 7.3 AEC Data Extraction

```
User clicks "Extract Data" (AEC tab)
→ For each page:
    → Get text spans (Rust extract_text or PDF.js getTextContent)
    → aec-extractor.extractAecData(spans)
        → Regex match: stations, elevations, pipes, slopes, manholes
    → Optionally: ocrPage() or aiExtractPage() for scanned drawings
→ spatial-grouper.groupByBoundingBox(records)
    → Clusters nearby data into structures
→ Results stored in aecStore
→ AecDataPanel shows sortable/filterable table
→ User can export: CSV, XLSX, Civil3D LandXML
```

---

## 8. Build & Deployment

### Development
```bash
cd open-pdf-studio
npm install
npm run dev          # Vite dev server on :3041 (browser-only)
npm run tauri dev    # Full Tauri desktop app with hot reload
```

### Production Build
```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/
#   Windows: .exe (NSIS installer)
#   macOS: .dmg (universal binary)
#   Linux: .deb, .AppImage
```

### Platforms
- **Windows**: NSIS installer with file association, virtual printer option
- **macOS**: DMG with universal binary (Intel + Apple Silicon)
- **Linux**: .deb, AppImage, Snap (Ubuntu App Center), Flatpak
- **Android**: APK (Tauri mobile)
- **Web**: Vite build to `dist/` (deployable to any static host, limited functionality)

---

## 9. Git Remotes & Lineage

```
origin:     https://github.com/OpenAEC-Foundation/open-pdf-studio.git  (upstream)
opencivil:  https://github.com/sankalpv/OpenCivil.git  (fork)
```

**Fork commits:**
1. `c94e29a4` — Fork & rebrand: Open PDF Studio → OpenCivil
2. `e4a85e88` — Module 1: AEC Data Extraction System
3. `11545314` — AEC: Add PDF.js fallback for browser-mode text extraction
4. `9f553e5e` — Module 2+3: AEC stamps, measurement CSV export, enhanced AEC tab

---

## 10. Key Numbers

| Metric | Count |
|--------|-------|
| Total source files (JS/TS/JSX) | ~180 |
| Total Rust source files | 12 |
| Total Rust test files | 22 |
| SolidJS components | ~75 |
| SolidJS stores | 32 (22 + 10 panel stores) |
| Tauri commands | 44 |
| Annotation types | 20+ |
| Ribbon tabs | 9 (Home, Comment, View, Measure, Organize, Arrange, Format, Help, AEC, AI) |
| Left panel tabs | 11 |
| Languages | 37 |
| i18n namespaces | 8 |
| i18n JSON files | ~296 |
| CSS stylesheets | 23 |
| Tools | 19+ |
| Dialogs | 30+ |
| NEN 1414 symbols | ~95 |
| AEC stamps | 16 |
| Standard stamps | 10 |
| Supported platforms | 5 (Windows, macOS, Linux, Android, Web) |

---

*Document generated from full codebase analysis. Last updated: April 2026.*
