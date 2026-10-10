'use client';

import { create_graph } from './graphFactory';
// import { folders, nodes, layout } from './bigGraphData';
import { folders, nodes, layout, options } from './smallGraphData';

// Small example (data in smallGraphData.js).
// For the 100-report example, switch the import above to bigGraphData
// and use { offsetX: 280, offsetY: 160 } as options.
const MyGraph = create_graph(folders, nodes, layout, options);

export default function Page() {
  return <MyGraph />;
}
