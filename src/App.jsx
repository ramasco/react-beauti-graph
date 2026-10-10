'use client';

import { create_graph } from './graphFactory';
import { folders, nodes, layout } from './bigGraphData';

// 100 reports, 5 folders, 10 layers (data in bigGraphData.js)
const MyGraph = create_graph(folders, nodes, layout, { offsetX: 280, offsetY: 160 });


export default function Page() {
  return <MyGraph />;
}
