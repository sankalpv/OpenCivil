// OpenCivil — AEC Ribbon Tab
// Provides AEC-specific tools: Extract Data, Export CSV, toggle AEC panel.

import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import { runExtraction, downloadCsv, aecPanelVisible, setAecPanelVisible } from '../../stores/aecStore.js';

export default function AecTab() {
  return (
    <div class="ribbon-content active">
      <RibbonGroup label="Extract">
        <RibbonButton
          label="Extract Data"
          icon="📊"
          onClick={runExtraction}
          large={true}
        />
        <RibbonButton
          label="Data Panel"
          icon="📋"
          onClick={() => setAecPanelVisible(!aecPanelVisible())}
        />
      </RibbonGroup>

      <RibbonGroup label="Export">
        <RibbonButton
          label="Export CSV"
          icon="📥"
          onClick={downloadCsv}
        />
      </RibbonGroup>

      <RibbonGroup label="AEC Data Types">
        <div style={{ display: 'flex', gap: '4px', 'align-items': 'center', padding: '4px 8px', 'font-size': '10px', color: 'var(--text-color-muted, #888)' }}>
          <span>Stations</span>
          <span>·</span>
          <span>Elevations</span>
          <span>·</span>
          <span>Pipe Sizes</span>
          <span>·</span>
          <span>Materials</span>
          <span>·</span>
          <span>Slopes</span>
          <span>·</span>
          <span>Manholes</span>
          <span>·</span>
          <span>Catch Basins</span>
        </div>
      </RibbonGroup>
    </div>
  );
}
