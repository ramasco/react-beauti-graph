'use client';

import { create_graph } from './graphFactory';
import { folders, nodes, layout } from './bigGraphData';

// 100 reports, 5 folders, 10 layers (data in bigGraphData.js)
const MyGraph = create_graph(folders, nodes, layout, { offsetX: 280, offsetY: 160 });

// Previous small example:
// const MyGraph = create_graph(
//   {
//     "Folder A": ["xxxxxxxxxxxxxxxxxxx", "n2", "n7"],
//     "Folder B": ["n3", "n4", "n5", "n6", "n7", "n8"],
//   },
//   [
//     ["xxxxxxxxxxxxxxxxxxx", 'n2'],
//     ['n2', "xxxxxxxxxxxxxxxxxxx"],
//     ['n2', 'n3'],
//     ['n3', 'n4'],
//     ["xxxxxxxxxxxxxxxxxxx", 'n7'],
//     ['n7', 'n8'],
//     ['n5', 'n7'],
//     ['n4', 'n6'],
//     ['n3', 'n9'],
//   ],
//   [
//     ["xxxxxxxxxxxxxxxxxxx", 'n2', 'n7'],
//     ['n3', 'n4', 'n5', 'n6', 'n7', 'n8'],
//     ['n9'],
//   ],
//   { offsetX: 320, offsetY: 200 });

export default function Page() {
  return <MyGraph />;
}
