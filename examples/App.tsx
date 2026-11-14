import { useState } from 'react';
import { create_graph } from 'react-beauti-graph';
import type { GraphOptions } from 'react-beauti-graph';
import * as small from './samples/sampleSmallGraphData';
import * as big from './samples/sampleBigGraphData';

// Grid spacing. Colors and text sizes use the DEFAULT_... values in src/default_setting.ts;
// set an option here (e.g. parentsColor, topControlsFontSize) only to override one.
const options: GraphOptions = { offsetX: 280, offsetY: 160 };

// Demo data the dropdown can switch between. create_graph is called once per sample, outside the component.
const SAMPLES = [
  {
    id: 'small',
    label: 'sampleSmallGraphData',
    Graph: create_graph(small.node_groups, small.direct_node_connections, options),
  },
  {
    id: 'big',
    label: 'sampleBigGraphData',
    Graph: create_graph(big.node_groups, big.direct_node_connections, options),
  },
];

export default function App(): React.JSX.Element {
  const [sampleId, setSampleId] = useState(SAMPLES[0]?.id ?? '');
  const Graph = (SAMPLES.find((s) => s.id === sampleId) ?? SAMPLES[0])?.Graph;

  return (
    <>
      <div className="demo-bar">
        <label>
          Demo data:{' '}
          <select value={sampleId} onChange={(e) => setSampleId(e.target.value)}>
            {SAMPLES.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {Graph && <Graph key={sampleId} />}
    </>
  );
}
