// Small example: 3 reports in 2 folders, laid out in 2 layers.

// folders: name -> nodes inside it
export const folders = { Sales: ['r001', 'r002'], Finance: ['r003'] };

// connections: [source, target]
export const nodes = [
  ['r001', 'r002'],
  ['r002', 'r001'],
  ['r002', 'r003'],
];

// layout: one row per layer
export const layout = [
  ['r001', 'r002'],
  ['r003'],
];

// options: spacing of the grid
export const options = { offsetX: 280, offsetY: 160 };
