// OpenCivil — AEC Network Pipe Inspector
// Minimal inspector panel for reviewing and editing pipe connections.
// Shows pipe details + start/end dropdowns + promote button for unresolved pipes.

import { Show, For, createMemo } from 'solid-js';
import {
  selectedPipeId, selectedUnresolvedPipeId, getSelectedPipe,
  getAllStructureIds, updatePipeConnection, promoteUnresolvedPipe,
  clearSelection,
} from '../../stores/aecNetworkStore.js';
import { redrawAnnotations } from '../../../annotations/rendering.js';

export default function AecNetworkInspector() {
  const pipe = createMemo(() => getSelectedPipe());
  const structIds = createMemo(() => getAllStructureIds());
  const isUnresolved = () => !!selectedUnresolvedPipeId();
  const isConfirmed = () => !!selectedPipeId();
  const hasSelection = () => isConfirmed() || isUnresolved();

  // Local state for dropdowns (unresolved pipe endpoint assignment)
  let startSelect, endSelect;

  function handleStartChange(e) {
    const p = pipe();
    if (!p) return;
    if (isConfirmed()) {
      updatePipeConnection(p.name || p.id, e.target.value, p.endRef);
      redrawAnnotations();
    }
  }

  function handleEndChange(e) {
    const p = pipe();
    if (!p) return;
    if (isConfirmed()) {
      updatePipeConnection(p.name || p.id, p.startRef, e.target.value);
      redrawAnnotations();
    }
  }

  function handlePromote() {
    const p = pipe();
    if (!p || !startSelect || !endSelect) return;
    const start = startSelect.value;
    const end = endSelect.value;
    if (!start || !end || start === end) {
      alert('Please select different start and end structures.');
      return;
    }
    promoteUnresolvedPipe(p.name || p.id, start, end);
    redrawAnnotations();
  }

  function handleClose() {
    clearSelection();
    redrawAnnotations();
  }

  return (
    <Show when={hasSelection()}>
      <div style={{
        padding: '8px',
        'border-top': '2px solid var(--border-color, #d4d4d4)',
        'font-size': '12px',
        'font-family': 'Segoe UI, sans-serif',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          'justify-content': 'space-between',
          'align-items': 'center',
          'margin-bottom': '6px',
        }}>
          <span style={{
            'font-weight': 'bold',
            color: isUnresolved() ? '#f59e0b' : '#16a34a',
          }}>
            {isUnresolved() ? '⚠ Unresolved Pipe' : '✓ Confirmed Pipe'}
          </span>
          <button onClick={handleClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            'font-size': '14px', padding: '0 4px',
          }}>✕</button>
        </div>

        <Show when={pipe()}>
          {(p) => (
            <div>
              {/* Pipe details */}
              <table style={{ width: '100%', 'border-collapse': 'collapse', 'margin-bottom': '8px' }}>
                <tbody>
                  <tr><td style={tdLabel}>Name</td><td style={tdVal}>{p().name || p().id}</td></tr>
                  <tr><td style={tdLabel}>Length</td><td style={tdVal}>{p().length} LF</td></tr>
                  <tr><td style={tdLabel}>Diameter</td><td style={tdVal}>{p().diameter}"</td></tr>
                  <tr><td style={tdLabel}>Material</td><td style={tdVal}>{p().material}</td></tr>
                  <tr>
                    <td style={tdLabel}>Slope</td>
                    <td style={tdVal}>{p().slope > 0 ? (p().slope * 100).toFixed(2) + '%' : '—'}</td>
                  </tr>
                  <tr>
                    <td style={tdLabel}>Confidence</td>
                    <td style={tdVal}>
                      <span style={{ color: p().confidence === 'unresolved' ? '#f59e0b' : p().confidence === 'manual' ? '#3b82f6' : '#16a34a' }}>
                        {p().confidence || 'unknown'}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Warning for unresolved */}
              <Show when={p().warning}>
                <div style={{
                  background: '#fef3c7', border: '1px solid #f59e0b',
                  padding: '4px 6px', 'margin-bottom': '8px', 'font-size': '11px',
                  color: '#92400e',
                }}>
                  {p().warning}
                </div>
              </Show>

              {/* Start/End dropdowns */}
              <div style={{ 'margin-bottom': '4px' }}>
                <label style={labelStyle}>Start Structure</label>
                <select
                  ref={el => startSelect = el}
                  value={p().startRef || ''}
                  onChange={isConfirmed() ? handleStartChange : undefined}
                  style={selectStyle}
                >
                  <option value="">— select —</option>
                  <For each={structIds()}>
                    {(id) => <option value={id}>{id}</option>}
                  </For>
                </select>
              </div>

              <div style={{ 'margin-bottom': '8px' }}>
                <label style={labelStyle}>End Structure</label>
                <select
                  ref={el => endSelect = el}
                  value={p().endRef || ''}
                  onChange={isConfirmed() ? handleEndChange : undefined}
                  style={selectStyle}
                >
                  <option value="">— select —</option>
                  <For each={structIds()}>
                    {(id) => <option value={id}>{id}</option>}
                  </For>
                </select>
              </div>

              {/* Promote button for unresolved pipes */}
              <Show when={isUnresolved()}>
                <button onClick={handlePromote} style={{
                  width: '100%', padding: '6px',
                  background: '#16a34a', color: 'white',
                  border: 'none', cursor: 'pointer',
                  'font-weight': 'bold', 'font-size': '12px',
                }}>
                  ✓ Confirm Pipe with These Endpoints
                </button>
              </Show>
            </div>
          )}
        </Show>
      </div>
    </Show>
  );
}

// Inline styles for table
const tdLabel = { 'font-weight': '600', padding: '2px 4px', color: '#666', width: '80px' };
const tdVal = { padding: '2px 4px' };
const labelStyle = { display: 'block', 'font-weight': '600', color: '#666', 'margin-bottom': '2px', 'font-size': '11px' };
const selectStyle = { width: '100%', padding: '3px', 'font-size': '12px', 'margin-bottom': '2px' };
