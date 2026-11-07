'use client';

/**
 * graphFactory.tsx
 * Factory for creating Cytoscape graph components: report nodes grouped in
 * groups, placed on a grid layout, with search, a details panel and a
 * "save to clipboard" context menu.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, FC } from 'react';
import cytoscape from 'cytoscape';
import type { StylesheetJson } from 'cytoscape';

// Defaults live in default_setting.ts; re-exported so they stay importable from here
import {
  DEFAULT_SELECTED_COLOR,
  DEFAULT_TRACK1_PARENTS_COLOR,
  DEFAULT_TRACK1_CHILDREN_COLOR,
  DEFAULT_TRACK2_PARENTS_COLOR,
  DEFAULT_TRACK2_CHILDREN_COLOR,
  DEFAULT_TRACK_COMMON_COLOR,
  DEFAULT_LAYOUT_COLUMNS,
  DEFAULT_TOP_CONTROLS_FONT_SIZE,
  DEFAULT_RIGHT_DISPLAY_FONT_SIZE,
  GRAPH_COLOR,
  REPORT_BACKGROUND_COLOR,
  FOLDER_BACKGROUND_COLOR,
} from './default_setting.ts';

export * from './default_setting.ts';

// The + / - buttons change the text size of the chosen area by this many pixels per click,
// within these limits. Sizes of the graph text (px) before the buttons change them.
const FONT_STEP = 2;
const MIN_FONT_DELTA = -8;
const MAX_FONT_DELTA = 16;
const REPORT_FONT_SIZE = 16;
const FOLDER_FONT_SIZE = 14;
// Areas the font dropdown can pick
type FontArea = 'top' | 'right' | 'graph';
const FONT_AREAS: readonly (readonly [FontArea, string])[] = [
  ['top', 'Font Top Panel'],
  ['right', 'Font Right Panel'],
  ['graph', 'Font Graph Panel'],
];

// Report box: as big as its label plus this much space (px) around the text on every side
const REPORT_PADDING = 4;
const LABEL_FONT_FAMILY = 'Helvetica Neue, Helvetica, Arial, sans-serif';
// Height of one line of text, as a share of the font size
const LINE_HEIGHT = 1.2;
// Width of one character as a share of the font size, for when the text cannot be measured
const FALLBACK_CHAR_WIDTH = 0.6;

// Element types, stored in data.class (not a Cytoscape class)
const REPORT_CLASS = 'macromolecule';
const FOLDER_CLASS = 'compartment';
// Selector for report nodes (selects by data, see above)
export const REPORT_NODE = `node[class = "${REPORT_CLASS}"]`;

/** Group (folder box) names mapped to the names of the reports inside them */
export type NodeGroups = Record<string, string[]>;
/** Arrows: [source, target] */
export type Connections = [string, string][];
/** Layout grid: one list of report ids per row */
export type Layout = string[][];

/** Data of a graph element (a group box, a report or an arrow) */
export interface ElementData {
  id: string;
  class?: string;
  label?: string;
  rawLabel?: string;
  displayLabel?: string;
  group?: string | null;
  parent?: string | undefined;
  source?: string;
  target?: string;
  graphLabel?: string | undefined;
}

/** A Cytoscape element as built by buildGraph */
export interface GraphElement {
  data: ElementData;
  classes?: string;
}

/** Grid placement options of the layout */
export interface LayoutOptions {
  startX?: number | undefined;
  startY?: number | undefined;
  offsetX?: number | undefined;
  offsetY?: number | undefined;
  base?: number | undefined;
}

/** A report listed in a group's details: its id, name and group */
export interface NodeRef {
  id: string;
  name: string;
  group: string | null;
}

/** Details of a report shown in the side panel */
export interface NodeInfo extends NodeRef {
  parents: NodeRef[];
  children: NodeRef[];
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/**
 * Width in px of a text drawn with the label font, measured on a canvas.
 * Without a canvas (tests, server) it is estimated from the number of characters.
 * @param {string} text - The label
 * @param {number} fontSize - Font size in px
 * @returns {number} Width in px
 */
function measureText(text: string, fontSize: number): number {
  if (measureContext === undefined) {
    try {
      measureContext = document.createElement('canvas').getContext('2d');
    } catch {
      measureContext = null;
    }
  }
  if (!measureContext) {
    return text.length * fontSize * FALLBACK_CHAR_WIDTH;
  }
  measureContext.font = `${fontSize}px ${LABEL_FONT_FAMILY}`;
  return measureContext.measureText(text).width;
}

/**
 * Size of a report box: exactly the label plus a little padding.
 * @param {string|undefined} label - The node label text
 * @param {number} [fontSize] - Font size of the label in px
 * @returns {{width: number, height: number}} Box size in px
 */
export function getNodeSize(
  label: string | undefined,
  fontSize: number = REPORT_FONT_SIZE
): { width: number; height: number } {
  return {
    width: Math.ceil(measureText(label ?? '', fontSize)) + REPORT_PADDING * 2,
    height: Math.ceil(fontSize * LINE_HEIGHT) + REPORT_PADDING * 2,
  };
}

/**
 * Compares names alphabetically, case-insensitive; numeric so "n2" comes before "n10".
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Renames duplicate node IDs in layout to make them unique.
 * Appends "(n)" suffix when duplicates are detected.
 * @param {string[][]} layout - 2D array of node IDs arranged in rows/columns
 * @returns {string[][]} Layout with renamed duplicates
 */
export function uniquifyLayout(layout: Layout = []): Layout {
  const counts = new Map<string, number>();
  return layout.map((row) =>
    row.map((id) => {
      const n = counts.get(id) ?? 0;
      counts.set(id, n + 1);
      if (n === 0) {
        return id;
      }
      const newId = `${id}(${n})`;
      console.warn(`layout: duplicate id "${id}" — renamed to "${newId}"`);
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
export function applyLayout(cy: cytoscape.Core, rows: Layout, opts: LayoutOptions = {}): void {
  const { startX = 0, startY = 0, offsetX = 200, offsetY = 200, base = 1 } = opts;

  const placed = new Set();

  rows.forEach((ids, rowIndex) => {
    ids.forEach((rawId, colIndex) => {
      let id = rawId;
      let node = cy.getElementById(id);

      if (node.empty()) {
        const m = /^(.+)\((\d+)\)$/.exec(rawId);
        const original = m?.[1];
        if (original !== undefined && cy.getElementById(original).nonempty()) {
          id = original;
          node = cy.getElementById(id);
          console.warn(`applyLayout: "${rawId}" not found — using "${id}" instead`);
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
export function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}_${n++}`;
  }
  taken.add(id);
  return id;
}

/**
 * Builds a layout from the groups, used when no layout is given.
 * Each group starts a new row and fills rows of at most `columns` reports
 * (group order, then report order); reports in no group come last.
 * Copies of a report in several groups ("id(1)", ...) sit in their own group.
 * @param {Object[]} elements - Cytoscape elements from buildGraph
 * @param {number} [columns] - Maximum reports per row
 * @returns {string[][]} Layout rows of node IDs
 */
export function layoutFromFolders(elements: GraphElement[], columns = DEFAULT_LAYOUT_COLUMNS): Layout {
  const perRow = Math.max(1, Math.floor(columns) || 1);
  const reports = elements.filter((e) => e.data.class === REPORT_CLASS);
  const groups = elements
    .filter((e) => e.data.class === FOLDER_CLASS)
    .map((folder) => reports.filter((r) => r.data.parent === folder.data.id));
  groups.push(reports.filter((r) => !r.data.parent));

  const rows: Layout = [];
  for (const group of groups) {
    for (let i = 0; i < group.length; i += perRow) {
      rows.push(group.slice(i, i + perRow).map((r) => r.data.id));
    }
  }
  return rows;
}

/**
 * Builds the Cytoscape elements from groups, edges and extra node IDs.
 * Folders become compound nodes (FOLDER_CLASS); every report becomes a
 * REPORT_CLASS node. A report listed in several groups gets one copy per
 * group ("id", "id(1)", ...); edges connect to the first copy.
 * @param {Object<string, string[]>} node_groups - Mapping of group names to child IDs
 * @param {Array<[string, string]>} direct_node_connections - Array of [source, target] edge pairs
 * @param {string[]} extraIds - Other node IDs to create even without edges (e.g. from the layout)
 * @returns {Object[]} Cytoscape elements array
 */
export function buildGraph(
  node_groups: NodeGroups = {},
  direct_node_connections: Connections = [],
  extraIds: string[] = []
): GraphElement[] {
  const elements: GraphElement[] = [];
  const takenIds = new Set<string>();

  // IDs of reports that are not necessarily in a group
  const looseIds = new Set([...direct_node_connections.flat(), ...extraIds]);
  for (const children of Object.values(node_groups)) {
    for (const id of children) {
      takenIds.add(id);
    }
  }
  for (const id of looseIds) {
    takenIds.add(id);
  }

  const makeFolderId = (label: string): string => {
    const cleaned = label.replace(/\s+/g, '');
    if (!cleaned) {
      return 'folder';
    }
    return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
  };

  // originalId -> [{ actualId, folderLabel }, ...] (one entry per group the report appears in)
  const instances = new Map<string, { actualId: string; folderLabel: string }[]>();
  const folderIdByLabel = new Map<string, string>();

  for (const [folderLabel, children] of Object.entries(node_groups)) {
    const folderId = uniqueId(makeFolderId(folderLabel), takenIds);
    folderIdByLabel.set(folderLabel, folderId);
    elements.push({ data: { id: folderId, class: FOLDER_CLASS, label: folderLabel } });

    for (const childId of children) {
      const existing = instances.get(childId) ?? [];
      let actualId = childId;
      if (existing.length > 0) {
        let n = existing.length;
        actualId = `${childId}(${n})`;
        while (takenIds.has(actualId)) {
          actualId = `${childId}(${++n})`;
        }
        takenIds.add(actualId);
      }
      existing.push({ actualId, folderLabel });
      instances.set(childId, existing);
    }
  }

  const reports: { actualId: string; originalId: string; folderLabel: string | null }[] = [];
  for (const [originalId, copies] of instances) {
    for (const { actualId, folderLabel } of copies) {
      reports.push({ actualId, originalId, folderLabel });
    }
  }
  for (const id of looseIds) {
    if (!instances.has(id)) {
      reports.push({ actualId: id, originalId: id, folderLabel: null });
    }
  }

  for (const { actualId, originalId, folderLabel } of reports) {
    const data: ElementData = {
      id: actualId,
      class: REPORT_CLASS,
      rawLabel: originalId, // report name
      displayLabel: folderLabel ? `${originalId} (${folderLabel})` : originalId,
      group: folderLabel,
    };
    if (folderLabel) {
      data.parent = folderIdByLabel.get(folderLabel);
    }
    elements.push({ data });
  }

  // [a,b] + [b,a] become one edge with arrows at both ends
  const resolve = (id: string): string => instances.get(id)?.[0]?.actualId ?? id;
  const pairKey = (source: string, target: string): string => `${source}->${target}`;
  const edgeByPair = new Map<string, GraphElement>();

  direct_node_connections.forEach(([rawSource, rawTarget], index) => {
    const source = resolve(rawSource);
    const target = resolve(rawTarget);

    // Same edge listed twice: skip it
    if (edgeByPair.has(pairKey(source, target))) {
      return;
    }

    // Reverse edge already added: give it two arrows instead of adding a second line
    const reverse = edgeByPair.get(pairKey(target, source));
    if (reverse) {
      reverse.classes = 'bidirectional';
      return;
    }

    const edge: GraphElement = { data: { id: uniqueId(`e${index + 1}`, takenIds), source, target } };
    edgeByPair.set(pairKey(source, target), edge);
    elements.push(edge);
  });

  return elements;
}

/**
 * Elements to draw for the current toggles: node label with or without
 * the group, and groups shown or hidden.
 * @param {Object[]} allElements - Output of buildGraph
 * @param {boolean} showFolders - Keep the group (compartment) nodes
 * @param {boolean} showGroupInLabel - Label reports "id (Group)" instead of "id"
 * @returns {Object[]} Fresh element copies, safe to hand to a new Cytoscape instance
 */
export function getVisibleElements(
  allElements: GraphElement[],
  showFolders: boolean,
  showGroupInLabel: boolean
): GraphElement[] {
  return allElements
    .filter((elem) => showFolders || elem.data.class !== FOLDER_CLASS)
    .map((elem) => {
      // Fresh copies each time, so one Cytoscape instance never shares objects with the next
      if (elem.data.class !== REPORT_CLASS) {
        return { ...elem, data: { ...elem.data } };
      }
      const graphLabel = showGroupInLabel ? elem.data.displayLabel : elem.data.rawLabel;
      return { ...elem, data: { ...elem.data, graphLabel } };
    });
}

/**
 * Collects the details shown in the side panel for a report node.
 * Parents point to the node, children are pointed to by it;
 * a two-way edge makes the other node both a parent and a child.
 * With allLevels, the lists hold the whole chains instead: the parents of the parents, ...
 * and the children of the children, ... (the node itself is left out).
 * @param {cytoscape.NodeSingular} node - The double-clicked node
 * @param {boolean} [allLevels] - Every level of parents and children, not just the first
 * @returns {{id: string, name: string, group: string|null, parents: Object[], children: Object[]}}
 */
export function getNodeInfo(node: cytoscape.NodeSingular, allLevels = false): NodeInfo {
  const describe = (n: cytoscape.NodeSingular): NodeRef => ({
    id: n.id(),
    name: (n.data('rawLabel') as string | undefined) ?? n.id(),
    group: (n.data('group') as string | null | undefined) ?? null,
  });
  const parents = new Map<string, NodeRef>();
  const children = new Map<string, NodeRef>();

  node.connectedEdges().forEach((edge) => {
    const twoWay = edge.hasClass('bidirectional');
    if (edge.target().same(node)) {
      parents.set(edge.source().id(), describe(edge.source()));
      if (twoWay) {
        children.set(edge.source().id(), describe(edge.source()));
      }
    }
    if (edge.source().same(node)) {
      children.set(edge.target().id(), describe(edge.target()));
      if (twoWay) {
        parents.set(edge.target().id(), describe(edge.target()));
      }
    }
  });

  if (allLevels) {
    const chains: [Map<string, NodeRef>, 'parents' | 'children'][] = [
      [parents, 'parents'],
      [children, 'children'],
    ];
    for (const [map, direction] of chains) {
      map.clear();
      getTrackedElements(node, direction)
        .nodes()
        .forEach((n) => {
          if (!n.same(node)) {
            map.set(n.id(), describe(n));
          }
        });
    }
  }

  const byName = (a: NodeRef, b: NodeRef): number => compareNames(a.name, b.name);
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
export function getTrackedElements(
  start: cytoscape.NodeSingular,
  direction: 'parents' | 'children'
): cytoscape.Collection {
  const upstream = direction === 'parents';
  let trail = start.cy().collection();
  const seen = new Set([start.id()]);
  const queue: cytoscape.NodeSingular[] = [start];

  for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
    const current = node;
    current.connectedEdges().forEach((edge) => {
      const twoWay = edge.hasClass('bidirectional');
      let next: cytoscape.NodeSingular | null = null;
      if (edge.target().same(current) && (upstream || twoWay)) {
        next = edge.source();
      }
      if (edge.source().same(current) && (!upstream || twoWay)) {
        next = edge.target();
      }
      if (!next) {
        return;
      }
      trail = trail.union(edge);
      if (!seen.has(next.id())) {
        seen.add(next.id());
        queue.push(next);
      }
    });
  }

  return trail.union(
    start
      .cy()
      .nodes()
      .filter((n) => seen.has(n.id()))
  );
}

/**
 * The parent/child lists shown in the side panel and copied to the clipboard;
 * empty lists are left out.
 * @param {ReturnType<typeof getNodeInfo>} info - Output of getNodeInfo
 * @returns {Array<[string, Object[]]>} [title, list] pairs
 */
function infoSections(info: NodeInfo): [string, NodeRef[]][] {
  const sections: [string, NodeRef[]][] = [
    ['Parent Nodes', info.parents],
    ['Child Nodes', info.children],
  ];
  return sections.filter(([, list]) => list.length > 0);
}

/**
 * The elements to hide for the reports unchecked in "Node to Display": those reports
 * (Cytoscape then hides their edges too) and the groups left with no visible report.
 * @param {cytoscape.Core} cy - Cytoscape instance
 * @param {Set<string>} hiddenIds - IDs of the reports to hide
 * @returns {cytoscape.Collection} Elements to hide
 */
export function getHiddenElements(cy: cytoscape.Core, hiddenIds: Set<string>): cytoscape.Collection {
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
export function formatNodeInfo(info: NodeInfo): string {
  const describe = (item: NodeRef): string => (item.group ? `${item.name} (${item.group})` : item.name);
  const lines = [`Node: ${info.name}`];
  if (info.group) {
    lines.push(`Group: ${info.group}`);
  }
  for (const [title, list] of infoSections(info)) {
    lines.push('', `${title} (${list.length}):`, ...list.map(describe));
  }
  return lines.join('\n');
}

/**
 * Reads a "#rrggbb" or "rgb(r, g, b)" color as one number (0xrrggbb).
 * @param {string} color - Hex or rgb() color
 * @returns {number|null} The color, or null for any other format
 */
function parseColor(color: string): number | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (hex !== undefined) {
    return parseInt(hex, 16);
  }
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(color);
  if (rgb === null) {
    return null;
  }
  const [red = 0, green = 0, blue = 0] = rgb.slice(1).map((part) => Math.min(Number(part), 255));
  return (red << 16) | (green << 8) | blue;
}

/**
 * Mixes a "#rrggbb" or "rgb(r, g, b)" color with white (used as the tracked node's fill).
 * Other color formats fall back to white.
 * @param {string} color - Hex or rgb() color
 * @param {number} [amount=0.88] - Share of white, 0..1
 * @returns {string} Hex color
 */
export function lightTint(color: string, amount = 0.88): string {
  const value = parseColor(color);
  if (value === null) {
    return '#ffffff';
  }
  return `#${[16, 8, 0]
    .map((shift) => {
      const channel = (value >> shift) & 0xff;
      return Math.round(channel + (255 - channel) * amount)
        .toString(16)
        .padStart(2, '0');
    })
    .join('')}`;
}

/**
 * Highlights the tracked chains (Track node 1 and 2) and dims the rest.
 * Elements on one chain get that track's class (track-parents, track2-children, ...);
 * elements on both chains also get "track-mixed" with the common color in
 * data(trackMixColor) and, for the tracked nodes, its light tint in data(trackMixFill).
 * @param {cytoscape.Core} cy - Cytoscape instance
 * @param {{id: string, direction: 'parents'|'children'}[]} tracks - Track 1 and Track 2 ('' id = off)
 * @param {string} [commonColor] - Hex color of elements on both chains
 */
export interface Track {
  id: string;
  direction: 'parents' | 'children';
}

export function applyTracking(
  cy: cytoscape.Core,
  tracks: Track[],
  commonColor: string = DEFAULT_TRACK_COMMON_COLOR
): void {
  const PREFIXES = ['track', 'track2'] as const;
  const allClasses = PREFIXES.flatMap((p) => [`${p}-parents`, `${p}-children`, `${p}-root`])
    .concat('faded', 'track-mixed')
    .join(' ');

  cy.batch(() => {
    cy.elements().removeClass(allClasses).removeData('trackMixColor trackMixFill');

    const trails = tracks.map(({ id, direction }, i): cytoscape.Collection | null => {
      if (!id) {
        return null;
      }
      const root = cy.getElementById(id);
      if (root.empty()) {
        return null;
      }
      const trail = getTrackedElements(root, direction);
      const prefix = PREFIXES[i] ?? 'track';
      trail.addClass(`${prefix}-${direction}`);
      root.addClass(`${prefix}-root`);
      return trail;
    });

    const active = trails.filter((trail): trail is cytoscape.Collection => trail !== null);
    if (active.length === 0) {
      return;
    }

    const [first, second] = trails;
    if (first && second) {
      first.intersection(second).forEach((ele) => {
        ele.data({ trackMixColor: commonColor, trackMixFill: lightTint(commonColor) });
        ele.addClass('track-mixed');
      });
    }

    // Folders stay visible; only reports and edges off every chain are dimmed
    const onChains = active.reduce((all, trail) => all.union(trail));
    cy.elements().not(onChains).not('node:parent').addClass('faded');
  });
}

/**
 * Cytoscape stylesheet; later rules override earlier ones.
 * @param {{selectedColor?: string, parentsColor?: string, childrenColor?: string,
 *   track2ParentsColor?: string, track2ChildrenColor?: string}} [colors]
 *   Selected node color and Track node 1 / Track node 2 chain colors
 * @returns {Object[]} Stylesheet
 */
export interface StyleColors {
  selectedColor?: string | undefined;
  parentsColor?: string | undefined;
  childrenColor?: string | undefined;
  track2ParentsColor?: string | undefined;
  track2ChildrenColor?: string | undefined;
}

export function makeStyles({
  selectedColor = DEFAULT_SELECTED_COLOR,
  parentsColor = DEFAULT_TRACK1_PARENTS_COLOR,
  childrenColor = DEFAULT_TRACK1_CHILDREN_COLOR,
  track2ParentsColor = DEFAULT_TRACK2_PARENTS_COLOR,
  track2ChildrenColor = DEFAULT_TRACK2_CHILDREN_COLOR,
}: StyleColors = {}): StylesheetJson {
  return [
    {
      selector: 'node',
      style: {
        'background-color': REPORT_BACKGROUND_COLOR,
        label: 'data(graphLabel)',
        shape: 'rectangle',
        // The box size comes from the label (set in the graph text effect); groups size to their children
        'font-family': LABEL_FONT_FAMILY,
        'font-size': REPORT_FONT_SIZE,
        color: GRAPH_COLOR,
        'border-width': 2,
        'border-color': GRAPH_COLOR,
        'text-valign': 'center',
        'text-halign': 'center',
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
        'font-size': FOLDER_FONT_SIZE,
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
    ...(
      [
        ['track-parents', 'track-root', parentsColor],
        ['track-children', 'track-root', childrenColor],
        ['track2-parents', 'track2-root', track2ParentsColor],
        ['track2-children', 'track2-root', track2ChildrenColor],
      ] as const
    ).flatMap(([cls, root, color]) => [
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
        selector: `node.${cls}.${root}`,
        style: { 'border-width': 5, 'background-color': lightTint(color) },
      },
    ]),
    // On both tracked chains: the common color (set per element by applyTracking)
    {
      selector: 'edge.track-mixed',
      style: {
        'line-color': 'data(trackMixColor)',
        'target-arrow-color': 'data(trackMixColor)',
        'source-arrow-color': 'data(trackMixColor)',
        width: 5,
      },
    },
    {
      selector: 'node.track-mixed',
      style: { 'border-color': 'data(trackMixColor)', 'border-width': 4 },
    },
    {
      selector: 'node.track-mixed.track-root, node.track-mixed.track2-root',
      style: { 'border-width': 6, 'background-color': 'data(trackMixFill)' },
    },
    {
      // Unchecked in "Node to Display": not drawn (nor are its edges)
      selector: '.hidden',
      style: { display: 'none' },
    },
  ];
}

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
export interface NodeSearchProps {
  id?: string;
  options: { id: string; label: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
  noneLabel?: string;
  hiddenIds?: Set<string>;
  onToggleVisible?: (id: string) => void;
}

export function NodeSearch({
  id,
  options,
  selectedId,
  onSelect,
  noneLabel = NO_NODE_LABEL,
  hiddenIds,
  onToggleVisible,
}: NodeSearchProps): React.JSX.Element {
  const [query, setQuery] = useState(''); // text shown in the box
  const [filter, setFilter] = useState(''); // text typed since the list opened
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedLabel = options.find((o) => o.id === selectedId)?.label ?? '';

  // Show the selected node's name (also when it is picked elsewhere, e.g. the side panel)
  const [shownLabel, setShownLabel] = useState<string | null>(null); // null: not synced yet
  if (shownLabel !== selectedLabel) {
    setShownLabel(selectedLabel);
    setQuery(selectedLabel);
  }

  const needle = filter.trim().toLowerCase();
  const nodeMatches = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  // The "no node" entry (ALL by default) sits at the top of the list
  const noneOption: { id: string; label: string } = { id: '', label: noneLabel };
  const matches =
    !needle || noneLabel.toLowerCase().includes(needle) ? [noneOption, ...nodeMatches] : nodeMatches;

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

  const choose = (opt: { id: string; label: string }): void => {
    onSelect(opt.id);
    setQuery(opt.id ? opt.label : ''); // the "no node" entry leaves the box empty
    setFilter('');
    setOpen(false);
  };

  // Close the list when clicking outside the search box
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onMouseDown = (e: MouseEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  });

  // Keep the highlighted match visible while using the arrow keys
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      }
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open) {
      const chosen = matches[active];
      if (chosen) {
        e.preventDefault();
        choose(chosen);
      }
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
          if (!open) {
            openList();
          }
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
        <ul className="node-search-list" ref={listRef} role="listbox">
          {matches.length === 0 ? (
            <li className="node-search-empty" role="option" aria-selected="false" aria-disabled="true">
              no match
            </li>
          ) : (
            matches.map((opt, i) => (
              <li
                key={opt.id || '__none__'}
                role="option"
                aria-selected={i === active}
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

/** Options of create_graph: grid placement, colors ("#rrggbb" or "rgb(r, g, b)") and text sizes (CSS lengths) */
export interface GraphOptions extends LayoutOptions {
  /** Reports per row when the layout is built from the groups */
  layoutColumns?: number | undefined;
  selectedColor?: string | undefined;
  parentsColor?: string | undefined;
  childrenColor?: string | undefined;
  track2ParentsColor?: string | undefined;
  track2ChildrenColor?: string | undefined;
  commonColor?: string | undefined;
  topControlsFontSize?: string | undefined;
  rightDisplayFontSize?: string | undefined;
}

/**
 * Factory function that creates a React Graph component.
 * Initializes Cytoscape instance, manages graph state, and handles node selection.
 * @param {Object<string, string[]>} node_groups - Group (group box) names mapped to their report names
 * @param {Array<[string, string]>} direct_node_connections - Edge definitions ([source, target] pairs)
 * @param {string[][]|Object} [layoutOrOptions] - Layout grid (one row per layer). Optional: leave it out
 *   and pass the options in its place, e.g. create_graph(node_groups, direct_node_connections, options),
 *   to build the layout from the groups
 * @param {Object} [optionsArg] - Layout rendering options (startX, startY, offsetX, offsetY, base,
 *   layoutColumns = reports per row when the layout is built from the groups)
 *   plus the colors ("#rrggbb"): selectedColor (Node to Display), parentsColor and
 *   childrenColor (Track node 1), track2ParentsColor and track2ChildrenColor (Track node 2;
 *   commonColor = elements on both chains, default rgb(239, 108, 0)), topControlsFontSize (text size of the top controls row, e.g. '16px')
 *   and rightDisplayFontSize (text size of the right details panel)
 * @returns {React.FC} Graph component
 */
export function create_graph(
  node_groups: NodeGroups = {},
  direct_node_connections: Connections = [],
  layoutOrOptions: Layout | GraphOptions | null = null,
  optionsArg: GraphOptions = {}
): FC {
  // The layout can be left out: create_graph(node_groups, direct_node_connections, options)
  const layout: Layout | null = Array.isArray(layoutOrOptions) ? layoutOrOptions : null;
  const options: GraphOptions =
    layoutOrOptions !== null && !Array.isArray(layoutOrOptions) ? layoutOrOptions : optionsArg;
  const hasLayout = layout !== null && layout.length > 0;
  const {
    selectedColor = DEFAULT_SELECTED_COLOR,
    parentsColor = DEFAULT_TRACK1_PARENTS_COLOR,
    childrenColor = DEFAULT_TRACK1_CHILDREN_COLOR,
    track2ParentsColor = DEFAULT_TRACK2_PARENTS_COLOR,
    track2ChildrenColor = DEFAULT_TRACK2_CHILDREN_COLOR,
    commonColor = DEFAULT_TRACK_COMMON_COLOR,
    topControlsFontSize = DEFAULT_TOP_CONTROLS_FONT_SIZE,
    rightDisplayFontSize = DEFAULT_RIGHT_DISPLAY_FONT_SIZE,
    layoutColumns = DEFAULT_LAYOUT_COLUMNS,
  } = options;
  const GRAPH_STYLES = makeStyles({
    selectedColor,
    parentsColor,
    childrenColor,
    track2ParentsColor,
    track2ChildrenColor,
  });
  // Colors for react-beauti-graph.css, set as CSS variables (the text sizes are added in the component)
  const CSS_VARS = {
    '--rbg-parents-color': parentsColor,
    '--rbg-children-color': childrenColor,
  };
  // The Track node 2 switch reuses the same CSS with its own colors
  const TRACK2_CSS_VARS = {
    '--rbg-parents-color': track2ParentsColor,
    '--rbg-children-color': track2ChildrenColor,
  };
  // Nodes listed only in the layout (no group, no edges) are still shown
  const ALL_ELEMENTS = buildGraph(
    node_groups,
    direct_node_connections,
    layout !== null && hasLayout ? layout.flat() : []
  );
  // No layout given: one block of rows per group
  const LAYOUT =
    layout !== null && hasLayout ? uniquifyLayout(layout) : layoutFromFolders(ALL_ELEMENTS, layoutColumns);

  function Graph(): React.JSX.Element {
    const containerRef = useRef<HTMLDivElement>(null);
    const cyRef = useRef<cytoscape.Core | null>(null);
    const uid = useId(); // unique ids, so several graphs can share a page
    const [nodeOptions, setNodeOptions] = useState<{ id: string; label: string }[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [fitRequest, setFitRequest] = useState(0); // bumped to zoom out to the full graph
    const [trackedId, setTrackedId] = useState(''); // '' = Show Nothing
    const [trackDirection, setTrackDirection] = useState<Track['direction']>('parents');
    const [tracked2Id, setTracked2Id] = useState(''); // Track node 2, '' = Show Nothing
    const [track2Direction, setTrack2Direction] = useState<Track['direction']>('parents');
    const [showFolders, setShowFolders] = useState(true);
    const [showGroupInLabel, setShowGroupInLabel] = useState(true);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; copyText: string } | null>(null);
    const [nodeInfo, setNodeInfo] = useState<NodeInfo | null>(null); // details panel for a double-clicked node
    const [fontArea, setFontArea] = useState<FontArea>('top'); // area the + / - buttons change
    const [fontDeltas, setFontDeltas] = useState<Record<FontArea, number>>({ top: 0, right: 0, graph: 0 }); // px added per area
    const [allLevels, setAllLevels] = useState(false); // panel: one level (default) or all levels
    const allLevelsRef = useRef(false); // read by the Cytoscape event handlers
    useEffect(() => {
      allLevelsRef.current = allLevels;
    }, [allLevels]);
    const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set()); // reports unchecked in "Node to Display"

    // Initialize Cytoscape graph (rebuilt when a toggle changes)
    useEffect(() => {
      const containerEl = containerRef.current;
      if (!containerEl) {
        return undefined;
      }

      const cy = cytoscape({
        container: containerEl,
        elements: getVisibleElements(
          ALL_ELEMENTS,
          showFolders,
          showGroupInLabel
        ) as cytoscape.ElementDefinition[],
        style: GRAPH_STYLES,
        layout: { name: 'preset', fit: false },
      });

      // Right click on a report node opens the "Save to clipboard" menu
      // (copies the same information the side panel shows)
      cy.on('cxttap', REPORT_NODE, (evt) => {
        const copyText = formatNodeInfo(
          getNodeInfo(evt.target as cytoscape.NodeSingular, allLevelsRef.current)
        );
        const { clientX, clientY } = evt.originalEvent;
        setContextMenu({ x: clientX, y: clientY, copyText });
      });

      // Double click on a report node shows its details in the side panel
      cy.on('dbltap', REPORT_NODE, (evt) => {
        setNodeInfo(getNodeInfo(evt.target as cytoscape.NodeSingular, allLevelsRef.current));
      });

      // Close the menu on any other interaction with the graph
      cy.on('tap cxttap', (evt) => {
        if (evt.target === cy) {
          setContextMenu(null);
        }
      });
      cy.on('tap', 'node', () => setContextMenu(null));
      cy.on('viewport', () => setContextMenu(null));

      // Suppress the browser's native context menu over the graph
      const preventNativeMenu = (e: Event): void => e.preventDefault();
      containerEl.addEventListener('contextmenu', preventNativeMenu);

      applyLayout(cy, LAYOUT, options);

      requestAnimationFrame(() => cy.resize());

      setNodeOptions(
        cy
          .nodes(REPORT_NODE)
          .map((n) => ({ id: n.id(), label: n.data('displayLabel') as string }))
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

    // Graph text size, and every report box sized to its label (so the + / - buttons resize both).
    // Declared after the effect above, so it also runs when that one rebuilds the graph.
    useEffect(() => {
      const cy = cyRef.current;
      if (!cy) {
        return;
      }
      const delta = fontDeltas.graph;
      cy.batch(() => {
        cy.nodes(REPORT_NODE).forEach((n) => {
          const fontSize = REPORT_FONT_SIZE + delta;
          const { width, height } = getNodeSize(n.data('graphLabel') as string | undefined, fontSize);
          n.style({ 'font-size': fontSize, width, height });
        });
        cy.nodes(':parent').style('font-size', FOLDER_FONT_SIZE + delta);
      });
    }, [fontDeltas.graph, showFolders, showGroupInLabel]);

    // Close the context menu on outside click or Escape
    useEffect(() => {
      if (!contextMenu) {
        return undefined;
      }
      const onMouseDown = (e: MouseEvent): void => {
        if (!(e.target as Element).closest('.node-context-menu')) {
          setContextMenu(null);
        }
      };
      const onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          setContextMenu(null);
        }
      };
      document.addEventListener('mousedown', onMouseDown);
      document.addEventListener('keydown', onKeyDown);
      return () => {
        document.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('keydown', onKeyDown);
      };
    }, [contextMenu]);

    const copyToClipboard = (): void => {
      if (contextMenu === null) {
        return;
      }
      const { copyText } = contextMenu;
      setContextMenu(null);
      navigator.clipboard.writeText(copyText).catch((err: unknown) => {
        console.error('Failed to copy:', err);
      });
    };

    // Checkbox next to a report in "Node to Display": show or hide it
    const toggleVisible = (id: string): void => {
      setHiddenIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    };

    // Selects a node (search box or side panel): jumps to it and shows its details.
    // A hidden node is shown again, so there is something to jump to.
    const showNode = (id: string): void => {
      const node = cyRef.current?.getElementById(id);
      if (!node || node.empty()) {
        return;
      }
      if (hiddenIds.has(id)) {
        toggleVisible(id);
      }
      setSelectedId(id);
      setNodeInfo(getNodeInfo(node, allLevels));
    };

    // ALL (or clearing the search): no selection, no details panel, whole graph in view
    const showAll = () => {
      setSelectedId('');
      setNodeInfo(null);
      setFitRequest((n) => n + 1);
    };

    // Hide the reports unchecked in "Node to Display".
    // Also re-applied when a toggle rebuilds the graph. Runs before the zoom effects
    // below, so a hidden node picked in the list is shown before zooming to it.
    useEffect(() => {
      const cy = cyRef.current;
      if (!cy) {
        return;
      }
      cy.batch(() => {
        cy.elements().removeClass('hidden');
        getHiddenElements(cy, hiddenIds).addClass('hidden');
      });
    }, [hiddenIds, showFolders, showGroupInLabel]);

    // Zoom out to the full graph. Runs after the re-render, so the closed
    // details panel has already given its width back to the graph.
    useEffect(() => {
      const cy = cyRef.current;
      if (!fitRequest || !cy) {
        return;
      }
      cy.stop(); // cancel a running zoom to a node
      cy.resize();
      cy.animate({ fit: { eles: cy.elements().not('.hidden'), padding: 30 } }, { duration: 400 });
    }, [fitRequest]);

    // Highlight the selected node and center on it.
    // Also re-applied when a toggle rebuilds the graph, so the selection is kept.
    useEffect(() => {
      const cy = cyRef.current;
      if (!cy) {
        return;
      }

      cy.nodes().removeClass('selected');
      if (!selectedId) {
        return;
      }

      const node = cy.getElementById(selectedId);
      if (node.nonempty()) {
        node.addClass('selected');
        cy.animate({ center: { eles: node }, zoom: 1.8 }, { duration: 400 });
      }
    }, [selectedId, showFolders, showGroupInLabel]);

    // Track node 1 and 2: highlight each chain of parents/children (common color where
    // they meet), dim the rest. Also re-applied when a toggle rebuilds the graph.
    useEffect(() => {
      const cy = cyRef.current;
      if (!cy) {
        return;
      }
      applyTracking(
        cy,
        [
          { id: trackedId, direction: trackDirection },
          { id: tracked2Id, direction: track2Direction },
        ],
        commonColor
      );
    }, [trackedId, trackDirection, tracked2Id, track2Direction, showFolders, showGroupInLabel]);

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

    const TRACK_CONTROLS: {
      n: 1 | 2;
      id: string;
      setId: (id: string) => void;
      direction: Track['direction'];
      setDirection: React.Dispatch<React.SetStateAction<Track['direction']>>;
      style: CSSProperties | undefined;
    }[] = [
      {
        n: 1,
        id: trackedId,
        setId: setTrackedId,
        direction: trackDirection,
        setDirection: setTrackDirection,
        style: undefined,
      },
      {
        n: 2,
        id: tracked2Id,
        setId: setTracked2Id,
        direction: track2Direction,
        setDirection: setTrack2Direction,
        style: TRACK2_CSS_VARS as CSSProperties,
      },
    ];

    const fontButtons: { label: string; symbol: string; step: number; atLimit: boolean }[] = [
      {
        label: 'Smaller text',
        symbol: '−',
        step: -FONT_STEP,
        atLimit: fontDeltas[fontArea] <= MIN_FONT_DELTA,
      },
      { label: 'Larger text', symbol: '+', step: FONT_STEP, atLimit: fontDeltas[fontArea] >= MAX_FONT_DELTA },
    ];

    return (
      <div
        className="rbg-graph"
        style={
          {
            ...CSS_VARS,
            // The + / - buttons add px to the configured sizes
            '--rbg-top-controls-font-size': `calc(${topControlsFontSize} + ${fontDeltas.top}px)`,
            '--rbg-right-display-font-size': `calc(${rightDisplayFontSize} + ${fontDeltas.right}px)`,
          } as CSSProperties
        }
      >
        <div className="controls">
          {/* Each label stays next to its box when the row wraps */}
          <span className="control-group">
            <label htmlFor={`${uid}-search`}>Node to Display:</label>
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
            <input type="checkbox" checked={showFolders} onChange={(e) => setShowFolders(e.target.checked)} />
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
          {TRACK_CONTROLS.map(({ n, id, setId, direction, setDirection, style }) => (
            <span className="control-group" key={n} style={style}>
              <label htmlFor={`${uid}-track${n}`}>Show Dependency {n}:</label>
              <NodeSearch
                id={`${uid}-track${n}`}
                options={nodeOptions}
                selectedId={id}
                onSelect={setId}
                noneLabel="Show Nothing"
              />
              {/* Nothing to track on "Show Nothing", so the switch is disabled */}
              <span className={id ? 'track-switch' : 'track-switch disabled'}>
                <span className={direction === 'parents' ? 'parents on' : 'parents'}>Parents</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={direction === 'children'}
                  aria-label={`Show Dependency ${n}: track children instead of parents`}
                  className="switch"
                  disabled={!id}
                  onClick={() => setDirection((d) => (d === 'parents' ? 'children' : 'parents'))}
                >
                  <span className="switch-knob" />
                </button>
                <span className={direction === 'children' ? 'children on' : 'children'}>Children</span>
              </span>
            </span>
          ))}
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
          <span className="font-size-buttons">
            <select
              aria-label="Area whose text size the + and - buttons change"
              value={fontArea}
              onChange={(e) => setFontArea(e.target.value as FontArea)}
            >
              {FONT_AREAS.map(([area, label]) => (
                <option key={area} value={area}>
                  {label}
                </option>
              ))}
            </select>
            {fontButtons.map(({ label, symbol, step, atLimit }) => (
              <button
                key={label}
                type="button"
                className="help-icon"
                aria-label={label}
                disabled={atLimit}
                onClick={() => setFontDeltas((d) => ({ ...d, [fontArea]: d[fontArea] + step }))}
              >
                {symbol}
              </button>
            ))}
          </span>
        </div>
        <div className="graph-area">
          <div ref={containerRef} className="cy-container" />
          {nodeInfo && (
            <aside className="node-info-panel">
              <div className="node-info-header">
                <h2>
                  <strong>Node:</strong> {nodeInfo.name}
                </h2>
                <button type="button" onClick={() => setNodeInfo(null)} aria-label="Close">
                  ×
                </button>
              </div>
              {nodeInfo.group && (
                <p>
                  <strong>Group:</strong> {nodeInfo.group}
                </p>
              )}
              <div className="track-switch level-switch">
                <span className={allLevels ? '' : 'parents on'}>One level</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={allLevels}
                  aria-label="Show all levels of parents and children"
                  className="switch"
                  onClick={() => {
                    const next = !allLevels;
                    setAllLevels(next);
                    const node = cyRef.current?.getElementById(nodeInfo.id);
                    if (node && !node.empty()) {
                      setNodeInfo(getNodeInfo(node, next));
                    }
                  }}
                >
                  <span className="switch-knob" />
                </button>
                <span className={allLevels ? 'children on' : ''}>All levels</span>
              </div>
              {infoSections(nodeInfo).map(([title, list]) => (
                <section key={title}>
                  <h3>
                    {title} ({list.length}):
                  </h3>
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
