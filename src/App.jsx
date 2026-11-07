'use client';

import { create_graph } from './graphFactory';
import { folders, direct_node_connections } from './samples/sampleSmallGraphData';
// import { folders, direct_node_connections } from './samples/sampleBigGraphData';
const options = {
  selectedColor: '#e91e63', // Select a node: highlight of the picked node (pink)
  offsetX: 280,
  offsetY: 160,
  parentsColor: '#2e7d32', // Track node: chain of parents (green)
  childrenColor: '#7b1fa2', // Track node: chain of children (purple)
};

// Small example (data in samples/sampleSmallGraphData.js).
// For the 100-report example, switch the import above to samples/sampleBigGraphData
// and use { offsetX: 280, offsetY: 160 } as options.
const MyGraph = create_graph(folders, direct_node_connections, options);

export default function Page() {
  return <MyGraph />;
}
