// OpenCivil — AEC Data Extraction Panel
// Floating panel that displays extracted AEC data with search, filter, and export.

import { Show, For, createMemo } from 'solid-js';
import {
  aecPanelVisible, setAecPanelVisible,
  aecRecords, aecSummary, aecSearchQuery,
  aecSearchResults, aecFilterType, setAecFilterType,
  aecIsExtracting, aecStatusMessage,
  runExtraction, updateSearch, getFilteredRecords, downloadCsv,
} from '../stores/aecStore.js';
import { downloadXlsx } from '../../aec/xlsx-export.js';
import { downloadCivil3d } from '../../aec/civil3d-export.js';

// Record type display labels and colors
const TYPE_LABELS = {
  station: { label: 'Station', color: '#3b82f6' },
  manhole: { label: 'Manhole', color: '#6366f1' },
  catchBasin: { label: 'Catch Basin', color: '#a855f7' },
  rim: { label: 'RIM', color: '#06b6d4' },
  invertElevation: { label: 'IE', color: '#14b8a6' },
  invertIn: { label: 'INV In', color: '#0d9488' },
  invertOut: { label: 'INV Out', color: '#0891b2' },
  bottomOfStructure: { label: 'Bottom', color: '#64748b' },
  centerOfChannel: { label: 'Channel', color: '#475569' },
  elevation: { label: 'Elevation', color: '#22c55e' },
  pipeRun: { label: 'Pipe Run', color: '#e11d48' },
  pipeSize: { label: 'Pipe Size', color: '#f59e0b' },
  pipeMaterial: { label: 'Material', color: '#8b5cf6' },
  pipeLength: { label: 'Length', color: '#ec4899' },
  slope: { label: 'Slope', color: '#ef4444' },
  waterValve: { label: 'Water Valve', color: '#0ea5e9' },
  topOfNut: { label: 'Top of Nut', color: '#7dd3fc' },
  forceMain: { label: 'Force Main', color: '#f97316' },
  scale: { label: 'Scale', color: '#78716c' },
};

export default function AecDataPanel() {
  const filteredRecords = createMemo(() => getFilteredRecords());

  const typeOptions = createMemo(() => {
    const summary = aecSummary();
    const types = Object.keys(summary);
    return [{ value: 'all', label: `All (${aecRecords().length})` },
      ...types.map(t => ({
        value: t,
        label: `${TYPE_LABELS[t]?.label || t} (${summary[t]})`,
      }))
    ];
  });

  return (
    <Show when={aecPanelVisible()}>
      <div class="aec-data-panel" style={{
        position: 'fixed', right: '8px', top: '120px', bottom: '40px',
        width: '360px', 'z-index': '1000',
        background: 'var(--panel-bg, #fff)', border: '1px solid var(--border-color, #ddd)',
        'border-radius': '8px', display: 'flex', 'flex-direction': 'column',
        'box-shadow': '0 4px 24px rgba(0,0,0,0.15)',
        'font-size': '12px', color: 'var(--text-color, #333)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '8px 12px', display: 'flex', 'align-items': 'center',
          'justify-content': 'space-between',
          background: 'var(--ribbon-bg, #f0f0f0)', 'border-bottom': '1px solid var(--border-color, #ddd)',
          'font-weight': '600', 'font-size': '13px',
        }}>
          <span>◆ AEC Data Extraction</span>
          <button onClick={() => setAecPanelVisible(false)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            'font-size': '16px', color: 'var(--text-color, #666)', padding: '0 4px',
          }}>✕</button>
        </div>

        {/* Controls */}
        <div style={{ padding: '8px 12px', display: 'flex', gap: '6px', 'flex-wrap': 'wrap',
          'border-bottom': '1px solid var(--border-color, #ddd)' }}>
          <button onClick={runExtraction} disabled={aecIsExtracting()} style={{
            padding: '4px 12px', background: 'var(--accent-color, #2563eb)',
            color: '#fff', border: 'none', 'border-radius': '4px', cursor: 'pointer',
            'font-size': '11px', opacity: aecIsExtracting() ? '0.6' : '1',
          }}>
            {aecIsExtracting() ? '⏳ Extracting...' : '📊 Extract Data'}
          </button>
          <button onClick={downloadCsv} disabled={aecRecords().length === 0} style={{
            padding: '4px 10px', background: 'var(--btn-bg, #e5e7eb)',
            color: 'var(--text-color, #333)', border: '1px solid var(--border-color, #ddd)',
            'border-radius': '4px', cursor: 'pointer', 'font-size': '10px',
            opacity: aecRecords().length === 0 ? '0.5' : '1',
          }}>
            📋 CSV
          </button>
          <button onClick={() => downloadXlsx(aecRecords())} disabled={aecRecords().length === 0} style={{
            padding: '4px 10px', background: 'var(--btn-bg, #e5e7eb)',
            color: 'var(--text-color, #333)', border: '1px solid var(--border-color, #ddd)',
            'border-radius': '4px', cursor: 'pointer', 'font-size': '10px',
            opacity: aecRecords().length === 0 ? '0.5' : '1',
          }}>
            📗 Excel
          </button>
          <button onClick={() => downloadCivil3d(aecRecords())} disabled={aecRecords().length === 0} style={{
            padding: '4px 10px', background: 'var(--btn-bg, #e5e7eb)',
            color: 'var(--text-color, #333)', border: '1px solid var(--border-color, #ddd)',
            'border-radius': '4px', cursor: 'pointer', 'font-size': '10px',
            opacity: aecRecords().length === 0 ? '0.5' : '1',
          }}>
            🏗️ Civil3D
          </button>
        </div>

        {/* Status */}
        <div style={{ padding: '4px 12px', 'font-size': '10px',
          color: 'var(--muted-color, #888)',
          'border-bottom': '1px solid var(--border-color, #eee)' }}>
          {aecStatusMessage()}
        </div>

        {/* Search */}
        <div style={{ padding: '8px 12px' }}>
          <input type="text" placeholder="Search extracted text..."
            value={aecSearchQuery()} onInput={(e) => updateSearch(e.currentTarget.value)}
            style={{
              width: '100%', padding: '6px 8px', border: '1px solid var(--border-color, #ddd)',
              'border-radius': '4px', 'font-size': '12px',
              background: 'var(--input-bg, #fff)', color: 'var(--text-color, #333)',
            }}
          />
        </div>

        {/* Type filter */}
        <Show when={aecRecords().length > 0}>
          <div style={{ padding: '0 12px 8px', display: 'flex', gap: '4px', 'flex-wrap': 'wrap' }}>
            <For each={typeOptions()}>
              {(opt) => (
                <button onClick={() => setAecFilterType(opt.value)} style={{
                  padding: '2px 8px', 'border-radius': '12px', 'font-size': '10px',
                  border: '1px solid var(--border-color, #ddd)', cursor: 'pointer',
                  background: aecFilterType() === opt.value ? 'var(--accent-color, #2563eb)' : 'transparent',
                  color: aecFilterType() === opt.value ? '#fff' : 'var(--text-color, #666)',
                }}>
                  {opt.label}
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* Search results */}
        <Show when={aecSearchQuery()?.trim() && aecSearchResults().length > 0}>
          <div style={{ padding: '4px 12px', 'font-size': '10px', color: 'var(--accent-color, #2563eb)' }}>
            {aecSearchResults().length} search results
          </div>
        </Show>

        {/* Records table */}
        <div style={{ flex: '1', 'overflow-y': 'auto', padding: '0' }}>
          <Show when={aecSearchQuery()?.trim()}>
            <For each={aecSearchResults().slice(0, 200)}>
              {(span) => (
                <div style={{
                  padding: '4px 12px', 'border-bottom': '1px solid var(--border-color, #eee)',
                  'font-size': '11px',
                }}>
                  <span style={{ color: 'var(--accent-color, #2563eb)', 'font-size': '9px' }}>
                    P{span.page}{' '}
                  </span>
                  {span.text}
                </div>
              )}
            </For>
          </Show>

          <Show when={!aecSearchQuery()?.trim() && filteredRecords().length > 0}>
            <table style={{ width: '100%', 'border-collapse': 'collapse', 'font-size': '11px' }}>
              <thead>
                <tr style={{ background: 'var(--ribbon-bg, #f5f5f5)', position: 'sticky', top: '0' }}>
                  <th style={{ padding: '4px 8px', 'text-align': 'left', 'font-size': '10px' }}>Type</th>
                  <th style={{ padding: '4px 8px', 'text-align': 'left', 'font-size': '10px' }}>Value</th>
                  <th style={{ padding: '4px 8px', 'text-align': 'left', 'font-size': '10px' }}>Page</th>
                </tr>
              </thead>
              <tbody>
                <For each={filteredRecords().slice(0, 500)}>
                  {(record) => {
                    const typeInfo = TYPE_LABELS[record.type] || { label: record.type, color: '#888' };
                    const value = Object.values(record.fields).join(', ');
                    return (
                      <tr style={{ 'border-bottom': '1px solid var(--border-color, #eee)' }}>
                        <td style={{ padding: '3px 8px' }}>
                          <span style={{
                            display: 'inline-block', padding: '1px 6px', 'border-radius': '8px',
                            'font-size': '9px', color: '#fff', background: typeInfo.color,
                          }}>
                            {typeInfo.label}
                          </span>
                        </td>
                        <td style={{ padding: '3px 8px', 'font-family': 'monospace' }}>{value}</td>
                        <td style={{ padding: '3px 8px', color: 'var(--muted-color, #888)' }}>{record.source.page}</td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </Show>

          <Show when={!aecSearchQuery()?.trim() && filteredRecords().length === 0 && !aecIsExtracting()}>
            <div style={{ padding: '24px', 'text-align': 'center', color: 'var(--muted-color, #999)' }}>
              <div style={{ 'font-size': '24px', 'margin-bottom': '8px' }}>📊</div>
              <div>Click "Extract Data" to parse AEC data</div>
              <div style={{ 'font-size': '10px', 'margin-top': '4px' }}>
                Stations · Elevations · Pipe Sizes · Materials · Slopes · Manholes
              </div>
            </div>
          </Show>
        </div>

        {/* Summary footer */}
        <Show when={aecRecords().length > 0}>
          <div style={{
            padding: '6px 12px', 'font-size': '10px', color: 'var(--muted-color, #888)',
            'border-top': '1px solid var(--border-color, #ddd)',
            display: 'flex', gap: '8px', 'flex-wrap': 'wrap',
          }}>
            <For each={Object.entries(aecSummary())}>
              {([type, count]) => (
                <span>
                  <span style={{
                    display: 'inline-block', width: '8px', height: '8px',
                    'border-radius': '50%', background: TYPE_LABELS[type]?.color || '#888',
                    'margin-right': '3px',
                  }} />
                  {TYPE_LABELS[type]?.label || type}: {count}
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
