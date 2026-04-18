// OpenCivil — AEC Ribbon Tab
// Provides AEC-specific tools: Extract Data, Export CSV, measurement export,
// AEC stamps, and toggle AEC panel.

import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import { runExtraction, downloadCsv, aecPanelVisible, setAecPanelVisible } from '../../stores/aecStore.js';
import { downloadMeasurementsCsv } from '../../../aec/measurement-export.js';
import { AEC_STAMPS } from '../../../annotations/stamps.js';
import { getActiveDocument } from '../../../core/state.js';
import { createAnnotation } from '../../../annotations/factory.js';
import { recordAdd } from '../../../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';

function placeAecStamp(stamp) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;

  const ann = createAnnotation({
    type: 'stamp',
    page: doc.currentPage || 1,
    x: 100, y: 100,
    width: 180, height: 50,
    stampName: stamp.name,
    stampText: stamp.text,
    stampColor: stamp.color,
    color: stamp.color,
    strokeColor: stamp.color,
    opacity: 0.85,
    rotation: 0,
  });

  doc.annotations.push(ann);
  recordAdd(ann);
  if (doc.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

export default function AecTab() {
  return (
    <div class="ribbon-content active">
      <RibbonGroup label="Extract">
        <RibbonButton label="Extract Data" icon="📊" onClick={runExtraction} large={true} />
        <RibbonButton label="Data Panel" icon="📋" onClick={() => setAecPanelVisible(!aecPanelVisible())} />
      </RibbonGroup>

      <RibbonGroup label="Export">
        <RibbonButton label="AEC Data CSV" icon="📥" onClick={downloadCsv} />
        <RibbonButton label="Measures CSV" icon="📐" onClick={downloadMeasurementsCsv} />
      </RibbonGroup>

      <RibbonGroup label="AEC Stamps">
        <div style={{ display: 'flex', gap: '2px', 'flex-wrap': 'wrap', 'max-width': '400px', padding: '2px' }}>
          {AEC_STAMPS.slice(0, 8).map(stamp => (
            <button
              onClick={() => placeAecStamp(stamp)}
              title={stamp.text}
              style={{
                padding: '2px 6px', 'border-radius': '3px', 'font-size': '9px',
                border: '1px solid var(--border-color, #ccc)', cursor: 'pointer',
                background: stamp.color + '20', color: stamp.color,
                'font-weight': '600', 'white-space': 'nowrap',
              }}
            >
              {stamp.name}
            </button>
          ))}
        </div>
      </RibbonGroup>
    </div>
  );
}
