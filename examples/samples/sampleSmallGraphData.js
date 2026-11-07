// Small example: 4 reports in 2 groups (the layout is built from the groups).

// node_groups: name -> reports inside it
export const node_groups = { Sales: ['r001', 'r002'], Finance: ['r003', 'r004'] };

// direct_node_connections: [source, target]
export const direct_node_connections = [
  ['r001', 'r002'],
  ['r002', 'r001'],
  ['r002', 'r003'],
  ['r004', 'r003'],
];
