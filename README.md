# react-beauti-graph

**react-beauti-graph by Antonio Ramasco**

A React component for drawing report dependency graphs with [Cytoscape](https://js.cytoscape.org/):
nodes grouped in folders, placed on a grid layout, with search, a details panel and clipboard export.

![react-beauti-graph example: Sales and Finance folders, a two-way arrow between r001 and r002, and the details panel for r001](https://raw.githubusercontent.com/ramasco/react-beauti-graph/main/docs/example.jpg)

*The [usage example](#usage) below, with `r001` selected.*

## Features

- **Folders (groups)** drawn as dashed boxes around their nodes; can be hidden with *Show Groups*
- **Grid layout**: one row per layer, defined as a list of rows
- **Connections** as arrows; `[a, b]` + `[b, a]` become one line with arrows at both ends; self connections drawn as a loop
- **Search box**: partial, case-insensitive search of any node, sorted alphabetically
- **Details panel** (double click or search): node, group, parent nodes and child nodes; click a name to jump to it
- **Save to clipboard** (right click): copies the same information as the details panel

## Install

From the [GitHub release](https://github.com/ramasco/react-beauti-graph/releases/latest):

```bash
npm install https://github.com/ramasco/react-beauti-graph/releases/download/v1.0.0/react-beauti-graph-1.0.0.tgz
```

Requires React 18 or newer. Cytoscape is installed automatically.

## Usage

```jsx
import { create_graph } from 'react-beauti-graph';
import 'react-beauti-graph/style.css';

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
  // The graph fills its container, so give the container a height
  return (
    <div style={{ height: '100vh' }}>
      <MyGraph />
    </div>
  );
}
```

Works in Next.js (App Router) out of the box: the library is marked `'use client'`.

### `create_graph(folders, connections, layout, options)`

| Argument | Type | Description |
|---|---|---|
| `folders` | `{ [folderName]: string[] }` | Nodes inside each folder (group). A node may be in several folders. |
| `connections` | `[source, target][]` | Arrows between nodes. `[a, b]` + `[b, a]` draw one two-way arrow; `[a, a]` draws a loop. |
| `layout` | `string[][]` | Grid positions, one row per layer. Nodes listed only here are still shown. |
| `options` | `{ offsetX, offsetY, startX, startY }` | Grid spacing and origin in pixels. |

Returns a React component.

## Development

```bash
npm install
npm run dev        # demo app at http://localhost:3000
npm test           # unit tests
npm run build:lib  # build the npm package into dist/
```

## License and credits

Licensed under the [Apache License 2.0](LICENSE).

You are free to use, modify and distribute this library, including in commercial
products, provided you keep the attribution in the [NOTICE](NOTICE) file:

> react-beauti-graph by Antonio Ramasco
