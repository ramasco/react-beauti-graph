'use client';

import { create_graph } from './graphFactory';
// import { folders, nodes, layout } from './samples/sampleBigGraphData';
import { folders, nodes, layout, options } from './samples/sampleSmallGraphData';

// Small example (data in samples/sampleSmallGraphData.js).
// For the 100-report example, switch the import above to samples/sampleBigGraphData
// and use { offsetX: 280, offsetY: 160 } as options.
const MyGraph = create_graph(folders, nodes, layout, options);

export default function Page() {
  return <MyGraph />;
}
