// OpenCivil — XLSX Export
// Generates formatted Excel workbooks from extracted AEC data and measurements.
// Northing and Easting columns added via enrichRecordsWithCoordinates()
// Real-world coordinates calculated from station, offset, and scale data

import * as XLSX from 'xlsx';
import { buildPipeSchedule } from './aec-extractor.js';
import { enrichRecordsWithCoordinates } from './civil3d-export.js';
import { collectMeasurements } from './measurement-export.js';
import { getMeasureScale } from '../annotations/measurement.js';

/**
 * Export AEC records as a multi-sheet XLSX workbook.
 * Sheet 1: All AEC Records
 * Sheet 2: Pipe Schedule (grouped)
 * Sheet 3: Measurements
 *
 * @param {Array} records  AEC records from extractAecData()
 * @param {string} [filename='opencivil-aec-data.xlsx']
 */
export function downloadXlsx(records, filename = 'opencivil-aec-data.xlsx') {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: All AEC Records (with Northing/Easting) ──
  const enriched = enrichRecordsWithCoordinates(records);
  const recordRows = enriched.map(r => ({
    Type: r.type,
    Value: Object.values(r.fields).join(', '),
    Page: r.source.page,
    X: Math.round(r.source.x),
    Y: Math.round(r.source.y),
    Northing: r.northing != null ? Math.round(r.northing * 1000) / 1000 : '',
    Easting: r.easting != null ? Math.round(r.easting * 1000) / 1000 : '',
    'Source Text': r.source.text,
    'Font Size': r.source.fontSize ? Math.round(r.source.fontSize) : '',
  }));

  if (recordRows.length > 0) {
    const ws1 = XLSX.utils.json_to_sheet(recordRows);
    // Set column widths
    ws1['!cols'] = [
      { wch: 14 }, // Type
      { wch: 24 }, // Value
      { wch: 6 },  // Page
      { wch: 8 },  // X
      { wch: 8 },  // Y
      { wch: 14 }, // Northing
      { wch: 14 }, // Easting
      { wch: 40 }, // Source Text
      { wch: 10 }, // Font Size
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'AEC Records');
  }

  // ── Sheet 2: Pipe Schedule ──
  const pipes = buildPipeSchedule(records);
  if (pipes.length > 0) {
    const pipeRows = pipes.map(p => ({
      Station: p.station || '',
      Size: p.size || '',
      Material: p.material || '',
      Length: p.length || '',
      Slope: p.slope || '',
      'Invert In': p.invertIn || '',
      'Invert Out': p.invertOut || '',
      'Rim Elev': p.rimElevation || '',
    }));
    const ws2 = XLSX.utils.json_to_sheet(pipeRows);
    ws2['!cols'] = [
      { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 },
      { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'Pipe Schedule');
  }

  // ── Sheet 3: Measurements ──
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
        Created: m.createdAt || '',
      };
    });
    const ws3 = XLSX.utils.json_to_sheet(measureRows);
    ws3['!cols'] = [
      { wch: 12 }, { wch: 6 }, { wch: 16 }, { wch: 8 }, { wch: 24 }, { wch: 20 },
    ];
    XLSX.utils.book_append_sheet(wb, ws3, 'Measurements');
  }

  // ── Sheet 4: Summary ──
  const summary = {};
  for (const r of records) {
    summary[r.type] = (summary[r.type] || 0) + 1;
  }
  const summaryRows = Object.entries(summary).map(([type, count]) => ({
    'Data Type': type,
    Count: count,
  }));
  summaryRows.push({ 'Data Type': 'TOTAL', Count: records.length });
  summaryRows.push({ 'Data Type': 'Measurements', Count: measurements.length });
  summaryRows.push({ 'Data Type': 'Pipe Schedule Rows', Count: pipes.length });

  const ws4 = XLSX.utils.json_to_sheet(summaryRows);
  ws4['!cols'] = [{ wch: 20 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws4, 'Summary');

  // Download
  XLSX.writeFile(wb, filename);
}
