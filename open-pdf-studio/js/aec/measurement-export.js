// OpenCivil — Measurement Export
// Export all measurement annotations from the current document as CSV.

import { getActiveDocument } from '../core/state.js';
import { getMeasureScale } from '../annotations/measurement.js';

/**
 * Collect all measurement annotations from the active document.
 * @returns {Array<Object>}
 */
export function collectMeasurements() {
  const doc = getActiveDocument();
  if (!doc?.annotations) return [];

  const measureTypes = ['distance', 'area', 'perimeter', 'polyline', 'angle', 'scaleBar'];
  return doc.annotations.filter(a => measureTypes.includes(a.type) || a.measureResult);
}

/**
 * Convert measurements to a CSV string.
 * @returns {string}
 */
export function measurementsToCsv() {
  const measurements = collectMeasurements();
  if (measurements.length === 0) return '';

  const headers = ['Type', 'Page', 'Value', 'Unit', 'Label', 'Points', 'Created'];
  const rows = measurements.map(m => {
    const scale = getMeasureScale(m.page);
    return [
      m.type || 'measure',
      m.page || 1,
      m.measureResult || m.result || '',
      scale.unit || 'mm',
      m.label || m.text || '',
      m.points ? m.points.map(p => `(${Math.round(p.x)},${Math.round(p.y)})`).join('; ') : '',
      m.createdAt || '',
    ];
  });

  const csvLines = [
    headers.join(','),
    ...rows.map(row =>
      row.map(val => {
        const s = String(val);
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')
    ),
  ];

  return csvLines.join('\n');
}

/**
 * Download measurements as CSV.
 */
export function downloadMeasurementsCsv() {
  const csv = measurementsToCsv();
  if (!csv) {
    alert('No measurements found in the current document.');
    return;
  }
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'opencivil-measurements.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Get a summary of measurements in the document.
 * @returns {Object}
 */
export function measurementSummary() {
  const measurements = collectMeasurements();
  const summary = { total: measurements.length };
  for (const m of measurements) {
    const type = m.type || 'other';
    summary[type] = (summary[type] || 0) + 1;
  }
  return summary;
}
