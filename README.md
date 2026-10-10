# react-beauti-graph

**react-beauti-graph by Antonio Ramasco**

A React component for drawing report dependency graphs with [Cytoscape](https://js.cytoscape.org/):
nodes grouped in folders, placed on a grid layout, with search, a details panel and clipboard export.

## Features

- **Folders (groups)** drawn as dashed boxes around their nodes; can be hidden with *Show Groups*
- **Grid layout**: one row per layer, defined as a list of rows
- **Connections** as arrows; `[a, b]` + `[b, a]` become one line with arrows at both ends; self connections drawn as a loop
- **Search box**: partial, case-insensitive search of any node, sorted alphabetically
- **Details panel** (double click or search): node, group, parent nodes and child nodes; click a name to jump to it
- **Save to clipboard** (right click): copies the same information as the details panel

## Usage

```jsx
import { create_graph } from './graphFactory';

const MyGraph = create_graph(
  // folders: name -> nodes inside it
  { Sales: ['r001', 'r002'], Finance: ['r003'] },
  // connections: [source, target]
  [
    ['r001', 'r002'],
    ['r002', 'r001'],
    ['r002', 'r003'],
  ],
  // layout: one row per layer
  [
    ['r001', 'r002'],
    ['r003'],
  ],
  // options: spacing of the grid
  { offsetX: 280, offsetY: 160 }
);

export default function Page() {
  return <MyGraph />;
}
```

## Development

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # unit tests
```

## License and credits

Licensed under the [Apache License 2.0](LICENSE).

You are free to use, modify and distribute this library, including in commercial
products, provided you keep the attribution in the [NOTICE](NOTICE) file:

> react-beauti-graph by Antonio Ramasco
