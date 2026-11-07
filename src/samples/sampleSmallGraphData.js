// Small example: 3 reports in 2 folders (the layout is built from the folders).

// folders: name -> nodes inside it
export const folders = { Sales: ['r001', 'r002'], Finance: ['r003'] };

// direct_node_connections: [source, target]
export const direct_node_connections = [
  ['r001', 'r002'],
  ['r002', 'r001'],
  ['r002', 'r003'],
];

// options: spacing of the grid
export const options = { offsetX: 280, offsetY: 160 };
