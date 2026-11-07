'use client';

/**
 * graphFactory.jsx
 * Factory for creating Cytoscape graph components: report nodes grouped in
 * folders, placed on a grid layout, with search, a details panel and a
 * "save to clipboard" context menu.
 */

import { useEffect, useId, useRef, useState } from 'react';
import cytoscape from 'cytoscape';

// Defaults live in default_setting.js; they are re-exported so they stay importable from here
import {
  DEFAULT_SELECTED_COLOR,
  DEFAULT_TRACK1_PARENTS_COLOR,
  DEFAULT_TRACK1_CHILDREN_COLOR,
  DEFAULT_LAYOUT_COLUMNS,
  DEFAULT_TOP_CONTROLS_FONT_SIZE,
  DEFAULT_RIGHT_DISPLAY_FONT_SIZE,
  GRAPH_COLOR,
  REPORT_BACKGROUND_COLOR,
  FOLDER_BACKGROUND_COLOR,
} from './default_setting';

export {
  DEFAULT_SELECTED_COLOR,
  DEFAULT_TRACK1_PARENTS_COLOR,
  DEFAULT_TRACK1_CHILDREN_COLOR,
  DEFAULT_LAYOUT_COLUMNS,
  DEFAULT_TOP_CONTROLS_FONT_SIZE,
  DEFAULT_RIGHT_DISPLAY_FONT_SIZE,
};

// ---- Fixed look ----

// Report box size: wide enough for its label
const NODE_MIN_WIDTH = 200;
const NODE_HEIGHT = 60;
const CHAR_WIDTH = 9;
const PADDING_X = 20;

// Element types, stored in data.class (not a Cytoscape class)
const REPORT_CLASS = 'macromolecule';
const FOLDER_CLASS = 'compartment';
// Selector for report nodes (selects by data, see above)
export const REPORT_NODE = `node[class = "${REPORT_CLASS}"]`;

/**
 * Calculate rectangle dimensions based on text length.
 * @param {string} label - The node label text
 * @returns {{width: number, height: number}} Computed dimensions
 */
export function getNodeSize(label) {
  const text = String(label ?? '');
  return {
    width: Math.max(NODE_MIN_WIDTH, text.length * CHAR_WIDTH + PADDING_X * 2),
    height: NODE_HEIGHT,
  };
}

/**
 * Compares names alphabetically, case-insensitive; numeric so "n2" comes before "n10".
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareNames(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Renames duplicate node IDs in layout to make them unique.
 * Appends "(n)" suffix when duplicates are detected.
 * @param {string[][]} layout - 2D array of node IDs arranged in rows/columns
 * @returns {string[][]} Layout with renamed duplicates
 */
export function uniquifyLayout(layout = []) {
  const counts = new Map();
  return layout.map((row) =>
    row.map((id) => {
      const n = counts.get(id) ?? 0;
      counts.set(id, n + 1);
      if (n === 0) return id;
      const newId = `${id}(${n})`;
      console.info(`layout: duplicate id "${id}" — renamed to "${newId}"`);
      return newId;
    })
  );
}

/**
 * Positions nodes in the Cytoscape graph based on layout specification.
 * Handles missing/renamed nodes gracefully with fallbacks.
 * @param {cytoscape.Core} cy - Cytoscape instance
 * @param {string[][]} rows - 2D layout array with node IDs
 * @param {Object} opts - Layout options (startX, startY, offsetX, offsetY, base)
 */
export function applyLayout(cy, rows, opts = {}) {
  const {
    startX = 0,
    startY = 0,
    offsetX = 200,
    offsetY = 200,
    base = 1,
  } = opts;

  const placed = new Set();

  rows.forEach((ids, rowIndex) => {
    ids.forEach((rawId, colIndex) => {
      let id = rawId;
      let node = cy.getElementById(id);

      if (node.empty()) {
        const m = /^(.+)\((\d+)\)$/.exec(rawId);
        if (m && cy.getElementById(m[1]).nonempty()) {
          id = m[1];
          node = cy.getElementById(id);
          console.warn(
            `applyLayout: "${rawId}" not found — using "${id}" instead`
          );
        }
      }

      if (node.empty()) {
        console.warn(`applyLayout: node "${rawId}" not found`);
        return;
      }

      if (placed.has(id)) {
        console.warn(
          `applyLayout: duplicate layout entry for node "${id}" ` +
            `(from "${rawId}") — keeping the first position`
        );
        return;
      }
      placed.add(id);

      node.position({
        x: startX + (colIndex + base) * offsetX,
        y: startY + (rowIndex + base) * offsetY,
      });
    });
  });
}

/**
 * Generates a unique ID by appending a counter suffix if needed.
 * @param {string} base - Base ID string
 * @param {Set<string>} taken - Set of already-used IDs (the new ID is added to it)
 * @returns {string} Unique ID
 */
export function uniqueId(base, taken) {
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  taken.add(id);
  return id;
}

/**
 * Builds a layout from the folders, used when no layout is given.
 * Each folder starts a new row and fills rows of at most `columns` reports
 * (folder order, then report order); reports in no folder come last.
 * Copies of a report in several folders ("id(1)", ...) sit in their own folder.
 * @param {Object[]} elements - Cytoscape elements from buildGraph
 * @param {number} [columns] - Maximum reports per row
 * @returns {string[][]} Layout rows of node IDs
 */
export function layoutFromFolders(elements, columns = DEFAULT_LAYOUT_COLUMNS) {
  const perRow = Math.max(1, Math.floor(columns) || 1);
  const reports = elements.filter((e) => e.data.class === REPORT_CLASS);
  const groups = elements
    .filter((e) => e.data.class === FOLDER_CLASS)
    .map((folder) => reports.filter((r) => r.data.parent === folder.data.id));
  groups.push(reports.filter((r) => !r.data.parent));

  const rows = [];
  for (const group of groups) {
    for (let i = 0; i < group.length; i += perRow) {
      rows.push(group.slice(i, i + perRow).map((r) => r.data.id));
    }
  }
  return rows;
}

/**
 * Builds the Cytoscape elements from folders, edges and extra node IDs.
 * Folders become compound nodes (FOLDER_CLASS); every report becomes a
 * REPORT_CLASS node. A report listed in several folders gets one copy per
 * folder ("id", "id(1)", ...); edges connect to the first copy.
 * @param {Object<string, string[]>} folders - Mapping of folder names to child IDs
 * @param {Array<[string, string]>} direct_node_connections - Array of [source, target] edge pairs
 * @param {string[]} extraIds - Other node IDs to create even without edges (e.g. from the layout)
 * @returns {Object[]} Cytoscape elements array
 */
export function buildGraph(folders = {}, direct_node_connections = [], extraIds = []) {
  const elements = [];
  const takenIds = new Set();

  // IDs of reports that are not necessarily in a folder
  const looseIds = new Set([...direct_node_connections.flat(), ...extraIds]);
  for (const children of Object.values(folders)) {
    for (const id of children) takenIds.add(id);
  }
  for (const id of looseIds) takenIds.add(id);

  const makeFolderId = (label) => {
    const cleaned = String(label ?? '').replace(/\s+/g, '');
    if (!cleaned) return 'folder';
    return cleaned[0].toLowerCase() + cleaned.slice(1);
  };

  // originalId -> [{ actualId, folderLabel }, ...] (one entry per folder the report appears in)
  const instances = new Map();
  const folderIdByLabel = new Map();

  for (const [folderLabel, children] of Object.entries(folders)) {
    const folderId = uniqueId(makeFolderId(folderLabel), takenIds);
    folderIdByLabel.set(folderLabel, folderId);
    elements.push({ data: { id: folderId, class: FOLDER_CLASS, label: folderLabel } });

    for (const childId of children) {
      const existing = instances.get(childId) ?? [];
      let actualId = childId;
      if (existing.length > 0) {
        let n = existing.length;
        actualId = `${childId}(${n})`;
        while (takenIds.has(actualId)) actualId = `${childId}(${++n})`;
        takenIds.add(actualId);
      }
      existing.push({ actualId, folderLabel });
      instances.set(childId, existing);
    }
  }

  const reports = [];
  for (const [originalId, copies] of instances) {
    for (const { actualId, folderLabel } of copies) {
      reports.push({ actualId, originalId, folderLabel });
    }
  }
  for (const id of looseIds) {
    if (!instances.has(id)) reports.push({ actualId: id, originalId: id, folderLabel: null });
  }

  for (const { actualId, originalId, folderLabel } of reports) {
    const data = {
      id: actualId,
      class: REPORT_CLASS,
      rawLabel: originalId, // report name
      displayLabel: folderLabel ? `${originalId} (${folderLabel})` : originalId,
      group: folderLabel,
    };
    if (folderLabel) data.parent = folderIdByLabel.get(folderLabel);
    elements.push({ data });
  }

  // [a,b] + [b,a] become one edge with arrows at both ends
  const resolve = (id) => instances.get(id)?.[0].actualId ?? id;
  const pairKey = (source, target) => `${source}->${target}`;
  const edgeByPair = new Map();

  direct_node_connections.forEach(([rawSource, rawTarget], index) => {
    const source = resolve(rawSource);
    const target = resolve(rawTarget);

    // Same edge listed twice: skip it
    if (edgeByPair.has(pairKey(source, target))) return;

    // Reverse edge already added: give it two arrows instead of adding a second line
    const reverse = edgeByPair.get(pairKey(target, source));
    if (reverse) {
      reverse.classes = 'bidirectional';
      return;
    }

    const edge = { data: { id: uniqueId(`e${index + 1}`, takenIds), source, target } };
    edgeByPair.set(pairKey(source, target), edge);
    elements.push(edge);
  });

  return elements;
}

/**
 * Elements to draw for the current toggles: node label with or without
 * the group, and folders shown or hidden.
 * @param {Object[]} allElements - Output of buildGraph
 * @param {boolean} showFolders - Keep the folder (compartment) nodes
 * @param {boolean} showGroupInLabel - Label reports "id (Group)" instead of "id"
 * @returns {Object[]} Fresh element copies, safe to hand to a new Cytoscape instance
 */
export function getVisibleElements(allElements, showFolders, showGroupInLabel) {
  return allElements
    .filter((elem) => showFolders || elem.data.class !== FOLDER_CLASS)
    .map((elem) => {
      // Fresh copies each time, so one Cytoscape instance never shares objects with the next
      if (elem.data.class !== REPORT_CLASS) return { ...elem, data: { ...elem.data } };
      const graphLabel = showGroupInLabel ? elem.data.displayLabel : elem.data.rawLabel;
      const { width, height } = getNodeSize(graphLabel);
      return {
        ...elem,
        data: { ...elem.data, graphLabel, nodeWidth: width, nodeHeight: height },
      };
    });
}

/**
 * Collects the details shown in the side panel for a report node.
 * Parents point to the node, children are pointed to by it;
 * a two-way edge makes the other node both a parent and a child.
 * @param {cytoscape.NodeSingular} node - The double-clicked node
 * @returns {{id: string, name: string, group: string|null, parents: Object[], children: Object[]}}
 */
export function getNodeInfo(node) {
  const describe = (n) => ({ id: n.id(), name: n.data('rawLabel') ?? n.id(), group: n.data('group') });
  const parents = new Map();
  const children = new Map();

  node.connectedEdges().forEach((edge) => {
    const twoWay = edge.hasClass('bidirectional');
    if (edge.target().same(node)) {
      parents.set(edge.source().id(), describe(edge.source()));
      if (twoWay) children.set(edge.source().id(), describe(edge.source()));
    }
    if (edge.source().same(node)) {
      children.set(edge.target().id(), describe(edge.target()));
      if (twoWay) parents.set(edge.target().id(), describe(edge.target()));
    }
  });

  const byName = (a, b) => compareNames(a.name, b.name);
  return {
    ...describe(node),
    parents: [...parents.values()].sort(byName),
    children: [...children.values()].sort(byName),
  };
}

/**
 * Follows the edges from a node to collect its whole chain of parents
 * (nodes pointing to it, their parents, ...) or children. A two-way edge
 * counts in both directions, as in getNodeInfo.
 * @param {cytoscape.NodeSingular} start - The tracked node
 * @param {'parents'|'children'} direction - Which way to follow the edges
 * @returns {cytoscape.Collection} The start node plus every node and edge on the chain
 */
export function getTrackedElements(start, direction) {
  const upstream = direction === 'parents';
  let trail = start.collection();
  const seen = new Set([start.id()]);
  const queue = [start];

  while (queue.length > 0) {
    const node = queue.shift();
    node.connectedEdges().forEach((edge) => {
      const twoWay = edge.hasClass('bidirectional');
      let next = null;
      if (edge.target().same(node) && (upstream || twoWay)) next = edge.source();
      if (edge.source().same(node) && (!upstream || twoWay)) next = edge.target();
      if (!next) return;
      trail = trail.union(edge);
      if (!seen.has(next.id())) {
        seen.add(next.id());
        queue.push(next);
      }
    });
  }

  return trail.union(start.cy().collection([...seen].map((id) => start.cy().getElementById(id))));
}

/**
 * The parent/child lists shown in the side panel and copied to the clipboard;
 * empty lists are left out.
 * @param {ReturnType<typeof getNodeInfo>} info - Output of getNodeInfo
 * @returns {Array<[string, Object[]]>} [title, list] pairs
 */
function infoSections(info) {
  return [
    ['Parent Nodes', info.parents],
    ['Child Nodes', info.children],
  ].filter(([, list]) => list.length > 0);
}

/**
 * The elements to hide for the reports unchecked in "Select a node": those reports
 * (Cytoscape then hides their edges too) and the folders left with no visible report.
 * @param {cytoscape.Core} cy - Cytoscape instance
 * @param {Set<string>} hiddenIds - IDs of the reports to hide
 * @returns {cytoscape.Collection} Elements to hide
 */
export function getHiddenElements(cy, hiddenIds) {
  const reports = cy.nodes(REPORT_NODE).filter((n) => hiddenIds.has(n.id()));
  const emptyFolders = cy
    .nodes(':parent')
    .filter((folder) => folder.children().every((child) => reports.has(child)));
  return reports.union(emptyFolders);
}

/**
 * Formats node details as plain text for the clipboard, matching the side panel:
 * the group and the parent/child lists appear only when not empty.
 * @param {ReturnType<typeof getNodeInfo>} info - Output of getNodeInfo
 * @returns {string} Text to copy
 */
export function formatNodeInfo(info) {
  const describe = (item) => (item.group ? `${item.name} (${item.group})` : item.name);
  const lines = [`Node: ${info.name}`];
  if (info.group) lines.push(`Group: ${info.group}`);
  for (const [title, list] of infoSections(info)) {
    lines.push('', `${title} (${list.length}):`, ...list.map(describe));
  }
  return lines.join('\n');
}

/**
 * Mixes a "#rrggbb" color with white (used as the tracked node's fill).
 * Other color formats fall back to white.
 * @param {string} color - Hex color
 * @param {number} [amount=0.88] - Share of white, 0..1
 * @returns {string} Hex color
 */
export function lightTint(color, amount = 0.88) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return '#ffffff';
  const value = parseInt(m[1], 16);
  return (
    '#' +
    [16, 8, 0]
      .map((shift) => {
        const channel = (value >> shift) & 0xff;
        return Math.round(channel + (255 - channel) * amount).toString(16).padStart(2, '0');
      })
      .join('')
  );
}

/**
 * Cytoscape stylesheet; later rules override earlier ones.
 * @param {{selectedColor?: string, parentsColor?: string, childrenColor?: string}} [colors]
 *   Selected node color and Track node chain colors
 * @returns {Object[]} Stylesheet
 */
export function makeStyles({
  selectedColor = DEFAULT_SELECTED_COLOR,
  parentsColor = DEFAULT_TRACK1_PARENTS_COLOR,
  childrenColor = DEFAULT_TRACK1_CHILDREN_COLOR,
} = {}) {
  return [
    {
      selector: 'node',
      style: {
        'background-color': REPORT_BACKGROUND_COLOR,
        label: 'data(graphLabel)',
        shape: 'rectangle',
        color: GRAPH_COLOR,
        'border-width': 2,
        'border-color': GRAPH_COLOR,
        'text-valign': 'center',
        'text-halign': 'center',
      },
    },
    {
      // Only report nodes carry size data; folders size to their children
      selector: 'node[nodeWidth][nodeHeight]',
      style: {
        width: 'data(nodeWidth)',
        height: 'data(nodeHeight)',
      },
    },
    {
      selector: 'node:parent',
      style: {
        'background-color': FOLDER_BACKGROUND_COLOR,
        'background-opacity': 0.5,
        'border-style': 'dashed',
        label: 'data(label)',
        'text-valign': 'top',
        'font-size': 14,
        'font-weight': 'bold',
        padding: '18px',
      },
    },
    {
      selector: '.selected',
      style: {
        'overlay-color': selectedColor,
        'overlay-opacity': 0.35,
        'overlay-padding': 8,
      },
    },
    {
      selector: 'edge',
      style: {
        'line-color': GRAPH_COLOR,
        width: 2,
        'curve-style': 'bezier',
        'target-arrow-shape': 'vee',
        'target-arrow-color': GRAPH_COLOR,
        'target-arrow-fill': 'filled',
        'arrow-scale': 2,
      },
    },
    {
      // Self connections ([a, a]): draw the loop above the box, large enough
      // to stick out of it (the default loop is hidden inside wide nodes)
      selector: 'edge:loop',
      style: {
        'loop-direction': '0deg',
        'loop-sweep': '-50deg',
        'control-point-step-size': 70,
      },
    },
    {
      selector: 'edge.bidirectional',
      style: {
        'source-arrow-shape': 'vee',
        'source-arrow-color': GRAPH_COLOR,
        'source-arrow-fill': 'filled',
      },
    },
    {
      // Track node: everything off the traced chain is dimmed
      selector: '.faded',
      style: { opacity: 0.15 },
    },
    ...[
      ['track-parents', parentsColor],
      ['track-children', childrenColor],
    ].flatMap(([cls, color]) => [
      {
        selector: `edge.${cls}`,
        style: {
          'line-color': color,
          'target-arrow-color': color,
          'source-arrow-color': color,
          width: 4,
        },
      },
      {
        selector: `node.${cls}`,
        style: { 'border-color': color, 'border-width': 3 },
      },
      {
        selector: `node.${cls}.track-root`,
        style: { 'border-width': 5, 'background-color': lightTint(color) },
      },
    ]),
    {
      // Unchecked in "Select a node": not drawn (nor are its edges)
      selector: '.hidden',
      style: { display: 'none' },
    },
  ];
}

/** Default Cytoscape stylesheet (default track colors) */
export const STYLES = makeStyles();

// Default label of the first entry of the node search list (selects no node)
const NO_NODE_LABEL = 'ALL';

/**
 * Searchable node picker: typing any part of a name (case-insensitive) filters the list.
 * Arrow keys move through the matches, Enter picks one, Escape closes the list.
 * @param {string} [id] - id for the input (to link a <label>)
 * @param {{id: string, label: string}[]} options - Nodes to choose from
 * @param {string} selectedId - Currently selected node id ('' for none)
 * @param {(id: string) => void} onSelect - Called with the chosen node id
 * @param {string} [noneLabel] - Label of the first entry, which selects no node
 * @param {Set<string>} [hiddenIds] - With onToggleVisible: nodes whose checkbox is off
 * @param {(id: string) => void} [onToggleVisible] - When given, each node gets a checkbox
 *   (on = shown); called with the node id when it is clicked
 */
export function NodeSearch({
  id,
  options,
  selectedId,
  onSelect,
  noneLabel = NO_NODE_LABEL,
  hiddenIds,
  onToggleVisible,
}) {
  const [query, setQuery] = useState(''); // text shown in the box
  const [filter, setFilter] = useState(''); // text typed since the list opened
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const listRef = useRef(null);

  const selectedLabel = options.find((o) => o.id === selectedId)?.label ?? '';

  // Show the selected node's name (also when it is picked elsewhere, e.g. the side panel)
  useEffect(() => {
    setQuery(selectedLabel);
  }, [selectedLabel]);

  const needle = filter.trim().toLowerCase();
  const nodeMatches = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle))
    : options;
  // The "no node" entry (ALL by default) sits at the top of the list
  const noneOption = { id: '', label: noneLabel };
  const matches =
    !needle || noneLabel.toLowerCase().includes(needle)
      ? [noneOption, ...nodeMatches]
      : nodeMatches;

  const openList = () => {
    setFilter('');
    setActive(0);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setFilter('');
    setQuery(selectedLabel);
  };

  const choose = (opt) => {
    onSelect(opt.id);
    setQuery(opt.id ? opt.label : ''); // the "no node" entry leaves the box empty
    setFilter('');
    setOpen(false);
  };

  // Close the list when clicking outside the search box
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => {
      if (!boxRef.current?.contains(e.target)) close();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  });

  // Keep the highlighted match visible while using the arrow keys
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && matches[active]) {
      e.preventDefault();
      choose(matches[active]);
    } else if (e.key === 'Escape') {
      close();
    }
  };

  return (
    <div className="node-search" ref={boxRef}>
      <input
        id={id}
        type="text"
        value={query}
        placeholder="-- type to search --"
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setFilter(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={(e) => {
          e.target.select();
          openList();
        }}
        onClick={() => {
          // Reopen the list when clicking the box again after choosing
          if (!open) openList();
        }}
        onKeyDown={onKeyDown}
      />
      {query && (
        <button
          type="button"
          className="node-search-clear"
          aria-label="Clear"
          onClick={() => {
            onSelect('');
            setQuery('');
            setFilter('');
          }}
        >
          ×
        </button>
      )}
      {open && (
        <ul className="node-search-list" ref={listRef}>
          {matches.length === 0 ? (
            <li className="node-search-empty">no match</li>
          ) : (
            matches.map((opt, i) => (
              <li
                key={opt.id || '__none__'}
                className={
                  [i === active && 'active', hiddenIds?.has(opt.id) && 'off'].filter(Boolean).join(' ') ||
                  undefined
                }
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the input
                  choose(opt);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {onToggleVisible && opt.id && (
                  <input
                    type="checkbox"
                    checked={!hiddenIds?.has(opt.id)}
                    aria-label={`Show ${opt.label}`}
                    // Toggles the node only: does not pick it, and keeps the list open
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggleVisible(opt.id)}
                  />
                )}
                {opt.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Factory function that creates a React Graph component.
 * Initializes Cytoscape instance, manages graph state, and handles node selection.
 * @param {Object<string, string[]>} folders - Folder compartments mapping
 * @param {Array<[string, string]>} direct_node_connections - Edge definitions ([source, target] pairs)
 * @param {string[][]} [layout] - Layout grid (one row per layer). Optional: leave it out,
 *   e.g. create_graph(folders, direct_node_connections, options), to build it from the folders
 * @param {Object} options - Layout rendering options (startX, startY, offsetX, offsetY, base,
 *   layoutColumns = reports per row when the layout is built from the folders)
 *   plus the colors ("#rrggbb"): selectedColor (Select a node), parentsColor and
 *   childrenColor (Track node), topControlsFontSize (text size of the top controls row, e.g. '16px')
 *   and rightDisplayFontSize (text size of the right details panel)
 * @returns {React.FC} Graph component
 */
export function create_graph(
  folders = {},
  direct_node_connections = [],
  layout = null,
  options = {}
) {
  // The layout can be left out: create_graph(folders, direct_node_connections, options)
  if (layout && !Array.isArray(layout)) {
    options = layout;
    layout = null;
  }
  const hasLayout = Array.isArray(layout) && layout.length > 0;
  const {
    selectedColor = DEFAULT_SELECTED_COLOR,
    parentsColor = DEFAULT_TRACK1_PARENTS_COLOR,
    childrenColor = DEFAULT_TRACK1_CHILDREN_COLOR,
    topControlsFontSize = DEFAULT_TOP_CONTROLS_FONT_SIZE,
    rightDisplayFontSize = DEFAULT_RIGHT_DISPLAY_FONT_SIZE,
    layoutColumns = DEFAULT_LAYOUT_COLUMNS,
  } = options;
  const GRAPH_STYLES = makeStyles({ selectedColor, parentsColor, childrenColor });
  // Colors and text sizes for react-beauti-graph.css, set as CSS variables
  const CSS_VARS = {
    '--rbg-parents-color': parentsColor,
    '--rbg-children-color': childrenColor,
    '--rbg-top-controls-font-size': topControlsFontSize,
    '--rbg-right-display-font-size': rightDisplayFontSize,
  };
  // Nodes listed only in the layout (no folder, no edges) are still shown
  const ALL_ELEMENTS = buildGraph(folders, direct_node_connections, hasLayout ? layout.flat() : []);
  // No layout given: one block of rows per folder
  const LAYOUT = hasLayout
    ? uniquifyLayout(layout)
    : layoutFromFolders(ALL_ELEMENTS, layoutColumns);

  function Graph() {
    const containerRef = useRef(null);
    const cyRef = useRef(null);
    const uid = useId(); // unique ids, so several graphs can share a page
    const [nodeOptions, setNodeOptions] = useState([]);
    const [selectedId, setSelectedId] = useState('');
    const [fitRequest, setFitRequest] = useState(0); // bumped to zoom out to the full graph
    const [trackedId, setTrackedId] = useState(''); // '' = No tracking
    const [trackDirection, setTrackDirection] = useState('parents'); // 'parents' | 'children'
    const [showFolders, setShowFolders] = useState(true);
    const [showGroupInLabel, setShowGroupInLabel] = useState(true);
    const [contextMenu, setContextMenu] = useState(null); // { x, y, copyText }
    const [nodeInfo, setNodeInfo] = useState(null); // details panel for a double-clicked node
    const [hiddenIds, setHiddenIds] = useState(() => new Set()); // reports unchecked in "Select a node"

    // Initialize Cytoscape graph (rebuilt when a toggle changes)
    useEffect(() => {
      const containerEl = containerRef.current;
      if (!containerEl) return;

      const cy = cytoscape({
        container: containerEl,
        elements: getVisibleElements(ALL_ELEMENTS, showFolders, showGroupInLabel),
        style: GRAPH_STYLES,
        layout: { name: 'preset', fit: false },
      });

      // Right click on a report node opens the "Save to clipboard" menu
      // (copies the same information the side panel shows)
      cy.on('cxttap', REPORT_NODE, (evt) => {
        const copyText = formatNodeInfo(getNodeInfo(evt.target));
        const { clientX, clientY } = evt.originalEvent;
        setContextMenu({ x: clientX, y: clientY, copyText });
      });

      // Double click on a report node shows its details in the side panel
      cy.on('dbltap', REPORT_NODE, (evt) => {
        setNodeInfo(getNodeInfo(evt.target));
      });

      // Close the menu on any other interaction with the graph
      cy.on('tap cxttap', (evt) => {
        if (evt.target === cy) setContextMenu(null);
      });
      cy.on('tap', 'node', () => setContextMenu(null));
      cy.on('viewport', () => setContextMenu(null));

      // Suppress the browser's native context menu over the graph
      const preventNativeMenu = (e) => e.preventDefault();
      containerEl.addEventListener('contextmenu', preventNativeMenu);

      applyLayout(cy, LAYOUT, options);

      requestAnimationFrame(() => cy.resize());

      setNodeOptions(
        cy
          .nodes(REPORT_NODE)
          .map((n) => ({ id: n.id(), label: n.data('displayLabel') }))
          .sort((a, b) => compareNames(a.label, b.label))
      );

      cyRef.current = cy;

      return () => {
        containerEl.removeEventListener('contextmenu', preventNativeMenu);
        setContextMenu(null);
        cy.destroy();
        cyRef.current = null;
      };
    }, [showFolders, showGroupInLabel]);

    // Close the context menu on outside click or Escape
    useEffect(() => {
      if (!contextMenu) return;
      const onMouseDown = (e) => {
        if (!e.target.closest('.node-context-menu')) setContextMenu(null);
      };
      const onKeyDown = (e) => {
        if (e.key === 'Escape') setContextMenu(null);
      };
      document.addEventListener('mousedown', onMouseDown);
      document.addEventListener('keydown', onKeyDown);
      return () => {
        document.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('keydown', onKeyDown);
      };
    }, [contextMenu]);

    const copyToClipboard = () => {
      const { copyText } = contextMenu;
      setContextMenu(null);
      navigator.clipboard.writeText(copyText).catch((err) => console.error('Failed to copy:', err));
    };

    // Checkbox next to a report in "Select a node": show or hide it
    const toggleVisible = (id) => {
      setHiddenIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };

    // Selects a node (search box or side panel): jumps to it and shows its details.
    // A hidden node is shown again, so there is something to jump to.
    const showNode = (id) => {
      const node = cyRef.current?.getElementById(id);
      if (!node || node.empty()) return;
      if (hiddenIds.has(id)) toggleVisible(id);
      setSelectedId(id);
      setNodeInfo(getNodeInfo(node));
    };

    // ALL (or clearing the search): no selection, no details panel, whole graph in view
    const showAll = () => {
      setSelectedId('');
      setNodeInfo(null);
      setFitRequest((n) => n + 1);
    };

    // Hide the reports unchecked in "Select a node".
    // Also re-applied when a toggle rebuilds the graph. Runs before the zoom effects
    // below, so a hidden node picked in the list is shown before zooming to it.
    useEffect(() => {
      const cy = cyRef.current;
      if (!cy) return;
      cy.batch(() => {
        cy.elements().removeClass('hidden');
        getHiddenElements(cy, hiddenIds).addClass('hidden');
      });
    }, [hiddenIds, showFolders, showGroupInLabel]);

    // Zoom out to the full graph. Runs after the re-render, so the closed
    // details panel has already given its width back to the graph.
    useEffect(() => {
      const cy = cyRef.current;
      if (!fitRequest || !cy) return;
      cy.stop(); // cancel a running zoom to a node
      cy.resize();
      cy.animate({ fit: { eles: cy.elements().not('.hidden'), padding: 30 } }, { duration: 400 });
    }, [fitRequest]);

    // Highlight the selected node and center on it.
    // Also re-applied when a toggle rebuilds the graph, so the selection is kept.
    useEffect(() => {
      const cy = cyRef.current;
      if (!cy) return;

      cy.nodes().removeClass('selected');
      if (!selectedId) return;

      const node = cy.getElementById(selectedId);
      if (node.nonempty()) {
        node.addClass('selected');
        cy.animate({ center: { eles: node }, zoom: 1.8 }, { duration: 400 });
      }
    }, [selectedId, showFolders, showGroupInLabel]);

    // Track node: highlight the chain of parents/children, dim the rest.
    // Also re-applied when a toggle rebuilds the graph.
    useEffect(() => {
      const cy = cyRef.current;
      if (!cy) return;

      cy.elements().removeClass('faded track-parents track-children track-root');
      if (!trackedId) return;

      const root = cy.getElementById(trackedId);
      if (root.empty()) return;

      const trail = getTrackedElements(root, trackDirection);
      trail.addClass(`track-${trackDirection}`);
      root.addClass('track-root');
      // Folders stay visible; only reports and edges off the chain are dimmed
      cy.elements().not(trail).not('node:parent').addClass('faded');
    }, [trackedId, trackDirection, showFolders, showGroupInLabel]);

    // Opening/closing the side panel changes the graph width
    const panelOpen = nodeInfo !== null;
    useEffect(() => {
      cyRef.current?.resize();
    }, [panelOpen]);

    // Handle window resize
    useEffect(() => {
      const onResize = () => cyRef.current?.resize();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }, []);

    return (
      <div className="rbg-graph" style={CSS_VARS}>
        <div className="controls">
          {/* Each label stays next to its box when the row wraps */}
          <span className="control-group">
            <label htmlFor={`${uid}-search`}>Select a node:</label>
            <NodeSearch
              id={`${uid}-search`}
              options={nodeOptions}
              selectedId={selectedId}
              // Picking a node also opens its details panel, like a double click
              onSelect={(id) => (id ? showNode(id) : showAll())}
              // Checkbox next to each node: show it in the graph or not
              hiddenIds={hiddenIds}
              onToggleVisible={toggleVisible}
            />
          </span>
          <label>
            <input
              type="checkbox"
              checked={showFolders}
              onChange={(e) => setShowFolders(e.target.checked)}
            />
            Show Groups
          </label>
          <label>
            <input
              type="checkbox"
              checked={showGroupInLabel}
              onChange={(e) => setShowGroupInLabel(e.target.checked)}
            />
            Add Group to Node Name
          </label>
          <span className="control-group">
            <label htmlFor={`${uid}-track`}>Track node:</label>
            <NodeSearch
              id={`${uid}-track`}
              options={nodeOptions}
              selectedId={trackedId}
              onSelect={setTrackedId}
              noneLabel="No tracking"
            />
            {/* Nothing to track on "No tracking", so the switch is disabled */}
            <span className={trackedId ? 'track-switch' : 'track-switch disabled'}>
              <span className={trackDirection === 'parents' ? 'parents on' : 'parents'}>Parents</span>
              <button
                type="button"
                role="switch"
                aria-checked={trackDirection === 'children'}
                aria-label="Track children instead of parents"
                className="switch"
                disabled={!trackedId}
                onClick={() => setTrackDirection((d) => (d === 'parents' ? 'children' : 'parents'))}
              >
                <span className="switch-knob" />
              </button>
              <span className={trackDirection === 'children' ? 'children on' : 'children'}>Children</span>
            </span>
          </span>
          <span className="help">
            <button type="button" className="help-icon" aria-label="Help" aria-describedby={`${uid}-help`}>
              ?
            </button>
            <span id={`${uid}-help`} role="tooltip" className="help-tooltip">
              <strong>Double click</strong> on a node to see its information, parents and children.
              <br />
              <strong>Right click</strong> on a node to save the same information to the clipboard.
            </span>
          </span>
        </div>
        <div className="graph-area">
          <div ref={containerRef} className="cy-container" />
          {nodeInfo && (
            <aside className="node-info-panel">
              <div className="node-info-header">
                <h2><strong>Node:</strong> {nodeInfo.name}</h2>
                <button type="button" onClick={() => setNodeInfo(null)} aria-label="Close">×</button>
              </div>
              {nodeInfo.group && <p><strong>Group:</strong> {nodeInfo.group}</p>}
              {infoSections(nodeInfo).map(([title, list]) => (
                <section key={title}>
                  <h3>{title} ({list.length}):</h3>
                  <ul>
                    {list.map((item) => (
                      <li key={item.id}>
                        <button type="button" onClick={() => showNode(item.id)}>
                          {item.name}
                          {item.group && <span> ({item.group})</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </aside>
          )}
        </div>
        {contextMenu && (
          <div
            className="node-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button type="button" onClick={copyToClipboard}>
              Save to clipboard
            </button>
          </div>
        )}
      </div>
    );
  }

  Graph.displayName = 'CytoscapeGraph';
  return Graph;
}
