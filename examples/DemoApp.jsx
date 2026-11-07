import { useState } from 'react';
import { create_graph } from 'react-beauti-graph';
import * as small from './samples/sampleSmallGraphData';
import * as big from './samples/sampleBigGraphData';

// Grid spacing. Colors and text sizes use the DEFAULT_... values in default_setting.js;
// set an option here (e.g. parentsColor, topControlsFontSize) only to override one.
const options = { offsetX: 280, offsetY: 160 };

// Demo data the dropdown can switch between. create_graph is called once per sample, outside the component.
const SAMPLES = [
  { id: 'small', label: 'sampleSmallGraphData', Graph: create_graph(small.node_groups, small.direct_node_connections, options) },
  { id: 'big', label: 'sampleBigGraphData', Graph: create_graph(big.node_groups, big.direct_node_connections, options) },
];

export default function DemoApp() {
  const [sampleId, setSampleId] = useState(SAMPLES[0].id);
  const { Graph } = SAMPLES.find((s) => s.id === sampleId);

  return (
    <>
      <div className="demo-bar">
        <label>
          Demo data:{' '}
          <select value={sampleId} onChange={(e) => setSampleId(e.target.value)}>
            {SAMPLES.map(({ id, label }) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
      </div>
      <Graph key={sampleId} />
    </>
  );
}
