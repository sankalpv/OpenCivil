// OpenCivil — XLSX Export v2 (Network-Driven)
// Generates a multi-sheet Excel workbook from the confirmed pipe network,
// NOT from raw AEC extraction records.
//
// Sheet 1: Structures   — confirmed/export-relevant structures
// Sheet 2: PipeRuns     — confirmed pipe connections
// Sheet 3: ExportPreview — summary with validation status
// Sheet 4: Raw Extraction — old raw dump preserved for debug
//
// The main 3 sheets are built from the same confirmed graph used by
// the LandXML export, ensuring XML and XLSX are always consistent.

import * as XLSX from 'xlsx';
import { buildConfirmedNetwork } from './network-builder.js';
import { calculateRealWorldCoordinates, enrichRecordsWithCoordinates } from './civil3d-export.js';
import { collectMeasurements } from './measurement-export.js';
import { getMeasureScale } from '../annotations/measurement.js';

/**
 * Export AEC records as a network-driven multi-sheet XLSX workbook.
 *
 * @param {Array} records  AEC records from extractAecData()
 * @param {string} [filename='opencivil-aec-data.xlsx']
 */
export function downloadXlsx(records, filename = 'opencivil-aec-data.xlsx') {
  const wb = XLSX.utils.book_new();

  // ── Build confirmed network (same model as LandXML export) ──
  const network = buildConfirmedNetwork(records);
  const { structures, allStructures, pipes, errors } = network;

  // Calculate real-world coordinates
  const coords = calculateRealWorldCoordinates(records, structures);
  for (const [id, coord] of coords) {
    const s = structures.get(id);
    if (s) { s.northing = coord.northing; s.easting = coord.easting; }
  }

  // Also calculate coordinates for all structures (for reference sheet)
  const allCoords = calculateRealWorldCoordinates(records, allStructures);
  for (const [id, coord] of allCoords) {
    const s = allStructures.get(id);
    if (s) { s.northing = coord.northing; s.easting = coord.easting; }
  }

  // ═══════════════════════════════════════════════════════════
  // Sheet 1: Structures
  // ═══════════════════════════════════════════════════════════
  const structRows = [];
  const exportIds = new Set([...structures.keys()]);

  // Show all extracted storm structures, marking which ones are in the export
  for (const [id, s] of allStructures) {
    const inExport = exportIds.has(id);
    structRows.push({
      StructureId: id,
      Kind: s.type === 'manhole' ? 'Manhole' :
            s.type === 'catchBasin' ? 'Catch Basin' : s.type,
      IncludedInExport: inExport ? 'YES' : 'no',
      Northing: s.northing != null ? Math.round(s.northing * 1000) / 1000 : '',
      Easting: s.easting != null ? Math.round(s.easting * 1000) / 1000 : '',
      Diameter: s.diameter ? `${s.diameter}"` : '',
      Rim: s.rim != null ? s.rim : '',
      Station: s.station || '',
      Notes: !inExport ? 'Not connected to confirmed pipes' :
             s.manholeType ? s.manholeType : '',
    });
  }

  if (structRows.length > 0) {
    const ws1 = XLSX.utils.json_to_sheet(structRows);
    ws1['!cols'] = [
      { wch: 14 }, // StructureId
      { wch: 14 }, // Kind
      { wch: 16 }, // IncludedInExport
      { wch: 12 }, // Northing
      { wch: 12 }, // Easting
      { wch: 10 }, // Diameter
      { wch: 10 }, // Rim
      { wch: 12 }, // Station
      { wch: 30 }, // Notes
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Structures');
  }

  // ═══════════════════════════════════════════════════════════
  // Sheet 2: PipeRuns
  // ═══════════════════════════════════════════════════════════
  const pipeRows = pipes.map(p => ({
    PipeId: p.name,
    StartRef: p.startRef,
    EndRef: p.endRef,
    LengthLF: p.length,
    DiameterIn: p.diameter,
    Material: p.material,
    SlopePct: p.slope > 0 ? (p.slope * 100).toFixed(2) + '%' : '',
    Exportable: 'YES',
  }));

  if (pipeRows.length > 0) {
    const ws2 = XLSX.utils.json_to_sheet(pipeRows);
    ws2['!cols'] = [
      { wch: 10 }, // PipeId
      { wch: 12 }, // StartRef
      { wch: 12 }, // EndRef
      { wch: 10 }, // LengthLF
      { wch: 12 }, // DiameterIn
      { wch: 10 }, // Material
      { wch: 10 }, // SlopePct
      { wch: 12 }, // Exportable
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'PipeRuns');
  }

  // ═══════════════════════════════════════════════════════════
  // Sheet 3: ExportPreview
  // ═══════════════════════════════════════════════════════════
  const previewRows = [
    { Item: 'Export Structures', Value: structures.size },
    { Item: 'Total Extracted Structures', Value: allStructures.size },
    { Item: 'Confirmed Pipes', Value: pipes.length },
    { Item: 'Validation Warnings', Value: errors.length },
    { Item: 'MVP-Valid', Value: (pipes.length > 0 && structures.size >= 2 && errors.length === 0) ? 'YES' : 'NO' },
    { Item: '', Value: '' },
    { Item: '— Exported Structures —', Value: '' },
  ];

  for (const [id, s] of structures) {
    previewRows.push({ Item: `  ${id}`, Value: s.desc || s.type });
  }

  previewRows.push({ Item: '', Value: '' });
  previewRows.push({ Item: '— Pipe Connections —', Value: '' });

  for (const p of pipes) {
    previewRows.push({
      Item: `  ${p.name}`,
      Value: `${p.startRef} → ${p.endRef} (${p.length} LF, ${p.diameter}" ${p.material})`,
    });
  }

  if (errors.length > 0) {
    previewRows.push({ Item: '', Value: '' });
    previewRows.push({ Item: '— Validation Warnings —', Value: '' });
    for (const err of errors) {
      previewRows.push({ Item: '  ⚠', Value: err });
    }
  }

  // Excluded structures
  const excludedIds = [];
  for (const [id] of allStructures) {
    if (!structures.has(id)) excludedIds.push(id);
  }
  if (excludedIds.length > 0) {
    previewRows.push({ Item: '', Value: '' });
    previewRows.push({ Item: '— Excluded from Export —', Value: '' });
    for (const id of excludedIds) {
      const s = allStructures.get(id);
      previewRows.push({ Item: `  ${id}`, Value: `${s?.desc || s?.type || 'unknown'} — not connected to confirmed pipes` });
    }
  }

  const ws3 = XLSX.utils.json_to_sheet(previewRows);
  ws3['!cols'] = [{ wch: 28 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'ExportPreview');

  // ═══════════════════════════════════════════════════════════
  // Sheet 4: Raw Extraction (debug — preserved from old behavior)
  // ═══════════════════════════════════════════════════════════
  const enriched = enrichRecordsWithCoordinates(records);
  const rawRows = enriched.map(r => ({
    Type: r.type,
    Value: Object.values(r.fields).join(', '),
    Page: r.source.page,
    X: Math.round(r.source.x),
    Y: Math.round(r.source.y),
    Northing: r.northing != null ? Math.round(r.northing * 1000) / 1000 : '',
    Easting: r.easting != null ? Math.round(r.easting * 1000) / 1000 : '',
    'Source Text': r.source.text,
  }));

  if (rawRows.length > 0) {
    const ws4 = XLSX.utils.json_to_sheet(rawRows);
    ws4['!cols'] = [
      { wch: 14 }, { wch: 24 }, { wch: 6 }, { wch: 8 },
      { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 40 },
    ];
    XLSX.utils.book_append_sheet(wb, ws4, 'Raw Extraction');
  }

  // ═══════════════════════════════════════════════════════════
  // Sheet 5: Measurements (if any)
  // ═══════════════════════════════════════════════════════════
  try {
    const measurements = collectMeasurements();
    if (measurements.length > 0) {
      const measureRows = measurements.map(m => {
        const scale = getMeasureScale(m.page);
        return {
          Type: m.type || 'measure',
          Page: m.page || 1,
          Value: m.measureResult || m.result || '',
          Unit: scale.unit || 'mm',
          Label: m.label || m.text || '',
        };
      });
      const ws5 = XLSX.utils.json_to_sheet(measureRows);
      ws5['!cols'] = [{ wch: 12 }, { wch: 6 }, { wch: 16 }, { wch: 8 }, { wch: 24 }];
      XLSX.utils.book_append_sheet(wb, ws5, 'Measurements');
    }
  } catch (e) {
    // Measurements may not be available in all contexts — skip silently
  }

  // ── Download ──
  XLSX.writeFile(wb, filename);
}
