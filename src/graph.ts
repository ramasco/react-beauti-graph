/**
 * graph.ts
 * The graph without any drawing: building the elements from the groups and the connections,
 * the grid layout, the size and place of every box, parents and children, the tracked chains,
 * the colors, and the geometry of the arrows. createGraph.tsx draws it with React Flow.
 */

import {
  DEFAULT_LAYOUT_COLUMNS,
  GROUP_BACKGROUND_COLOR,
  GRAPH_COLOR,
  REPORT_BACKGROUND_COLOR,
} from './default_setting.ts';

// Sizes of the graph text (px) before the + / - buttons change them
export const REPORT_FONT_SIZE = 16;
const GROUP_FONT_SIZE = 14;
// Report box: as big as its label plus this much space (px) around the text on every side
const REPORT_PADDING = 4;
export const LABEL_FONT_FAMILY = 'Helvetica Neue, Helvetica, Arial, sans-serif';
// Height of one line of text, as a share of the font size
const LINE_HEIGHT = 1.2;
// Width of one character as a share of the font size, for when the text cannot be measured
const FALLBACK_CHAR_WIDTH = 0.6;
// Space (px) between a group box and the reports inside it
const GROUP_PADDING = 18;

// Element types, stored in data.class (an arrow has no class: it has a source and a target)
const REPORT_CLASS = 'report';
const GROUP_CLASS = 'group';

/** Group names mapped to the names of the reports inside them */
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
}

/** A graph element as built by buildGraph */
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

/** A box on the canvas: top left corner and size */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** True for a report element (not a group, not an arrow) */
export function isReport(element: GraphElement): boolean {
  return element.data.class === REPORT_CLASS;
}

/** True for a group element */
function isGroup(element: GraphElement): boolean {
  return element.data.class === GROUP_CLASS;
}

/** True for an arrow element */
export function isEdge(element: GraphElement): boolean {
  return element.data.source !== undefined;
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
 * Builds the graph elements from groups, edges and extra node IDs.
 * Every group becomes a group element (GROUP_CLASS); every report becomes a
 * REPORT_CLASS node. A report listed in several groups gets one copy per
 * group ("id", "id(1)", ...); edges connect to the first copy.
 * @param {Object<string, string[]>} node_groups - Mapping of group names to child IDs
 * @param {Array<[string, string]>} direct_node_connections - Array of [source, target] edge pairs
 * @param {string[]} extraIds - Other node IDs to create even without edges (e.g. from the layout)
 * @returns {Object[]} Graph elements array
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

  const makeGroupId = (label: string): string => {
    const cleaned = label.replace(/\s+/g, '');
    if (!cleaned) {
      return 'group';
    }
    return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
  };

  // originalId -> [{ actualId, groupLabel }, ...] (one entry per group the report appears in)
  const instances = new Map<string, { actualId: string; groupLabel: string }[]>();
  const groupIdByLabel = new Map<string, string>();

  for (const [groupLabel, children] of Object.entries(node_groups)) {
    const groupId = uniqueId(makeGroupId(groupLabel), takenIds);
    groupIdByLabel.set(groupLabel, groupId);
    elements.push({ data: { id: groupId, class: GROUP_CLASS, label: groupLabel } });

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
      existing.push({ actualId, groupLabel });
      instances.set(childId, existing);
    }
  }

  const reports: { actualId: string; originalId: string; groupLabel: string | null }[] = [];
  for (const [originalId, copies] of instances) {
    for (const { actualId, groupLabel } of copies) {
      reports.push({ actualId, originalId, groupLabel });
    }
  }
  for (const id of looseIds) {
    if (!instances.has(id)) {
      reports.push({ actualId: id, originalId: id, groupLabel: null });
    }
  }

  for (const { actualId, originalId, groupLabel } of reports) {
    const data: ElementData = {
      id: actualId,
      class: REPORT_CLASS,
      rawLabel: originalId, // report name
      displayLabel: groupLabel ? `${originalId} (${groupLabel})` : originalId,
      group: groupLabel,
    };
    if (groupLabel) {
      data.parent = groupIdByLabel.get(groupLabel);
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
 * Where every report goes on the canvas, as the center of its box.
 * Handles missing/renamed ids with fallbacks, and warns about what it skips.
 * @param {string[][]} rows - 2D layout array with report ids
 * @param {Set<string>} knownIds - Ids of the reports in the graph
 * @param {Object} opts - Layout options (startX, startY, offsetX, offsetY, base)
 * @returns {Map<string, {x: number, y: number}>} Center of every placed report
 */
export function layoutPositions(
  rows: Layout,
  knownIds: Set<string>,
  opts: LayoutOptions = {}
): Map<string, { x: number; y: number }> {
  const { startX = 0, startY = 0, offsetX = 200, offsetY = 200, base = 1 } = opts;
  const positions = new Map<string, { x: number; y: number }>();

  rows.forEach((ids, rowIndex) => {
    ids.forEach((rawId, colIndex) => {
      let id = rawId;

      if (!knownIds.has(id)) {
        const original = /^(.+)\((\d+)\)$/.exec(rawId)?.[1];
        if (original !== undefined && knownIds.has(original)) {
          id = original;
          console.warn(`layout: "${rawId}" not found — using "${id}" instead`);
        }
      }

      if (!knownIds.has(id)) {
        console.warn(`layout: node "${rawId}" not found`);
        return;
      }

      if (positions.has(id)) {
        console.warn(
          `layout: duplicate layout entry for node "${id}" (from "${rawId}") — keeping the first position`
        );
        return;
      }

      positions.set(id, {
        x: startX + (colIndex + base) * offsetX,
        y: startY + (rowIndex + base) * offsetY,
      });
    });
  });

  return positions;
}

/**
 * Builds a layout from the groups, used when no layout is given.
 * Each group starts a new row and fills rows of at most `columns` reports
 * (group order, then report order); reports in no group come last.
 * Copies of a report in several groups ("id(1)", ...) sit in their own group.
 * @param {Object[]} elements - Graph elements from buildGraph
 * @param {number} [columns] - Maximum reports per row
 * @returns {string[][]} Layout rows of node IDs
 */
export function layoutFromGroups(elements: GraphElement[], columns = DEFAULT_LAYOUT_COLUMNS): Layout {
  const perRow = Math.max(1, Math.floor(columns) || 1);
  const reports = elements.filter(isReport);
  const groups = elements
    .filter(isGroup)
    .map((group) => reports.filter((r) => r.data.parent === group.data.id));
  groups.push(reports.filter((r) => !r.data.parent));

  const rows: Layout = [];
  for (const group of groups) {
    for (let i = 0; i < group.length; i += perRow) {
      rows.push(group.slice(i, i + perRow).map((r) => r.data.id));
    }
  }
  return rows;
}

/** The connections of one report, read from the elements. */
interface Links {
  parents: string[];
  children: string[];
}

/** Both directions of every arrow, per report. A two-way arrow counts as parent and child. */
function linksOf(elements: GraphElement[], id: string): Links {
  const links: Links = { parents: [], children: [] };
  for (const element of elements) {
    const { source, target } = element.data;
    if (source === undefined || target === undefined) {
      continue;
    }
    const twoWay = element.classes === 'bidirectional';
    if (target === id) {
      links.parents.push(source);
      if (twoWay) {
        links.children.push(source);
      }
    }
    if (source === id) {
      links.children.push(target);
      if (twoWay) {
        links.parents.push(target);
      }
    }
  }
  return links;
}

function describeReport(elements: GraphElement[], id: string): NodeRef {
  const data = elements.find((e) => e.data.id === id)?.data;
  return { id, name: data?.rawLabel ?? id, group: data?.group ?? null };
}

/** The reports and arrows on one chain of parents or children. */
export interface Chain {
  nodes: Set<string>;
  edges: Set<string>;
}

/**
 * Follows the arrows from a report to collect its whole chain of parents
 * (reports pointing to it, their parents, ...) or children. A two-way arrow
 * counts in both directions, as in getNodeInfo.
 * @param {GraphElement[]} elements - Output of buildGraph
 * @param {string} startId - The tracked report
 * @param {'parents'|'children'} direction - Which way to follow the arrows
 * @returns {Chain} The start report plus every report and arrow on the chain
 */
export function getChain(
  elements: GraphElement[],
  startId: string,
  direction: 'parents' | 'children'
): Chain {
  const upstream = direction === 'parents';
  const chain: Chain = { nodes: new Set([startId]), edges: new Set() };
  const queue = [startId];
  const arrows = elements.filter(isEdge);

  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const arrow of arrows) {
      const { source, target } = arrow.data;
      if (source === undefined || target === undefined) {
        continue;
      }
      const twoWay = arrow.classes === 'bidirectional';
      let next: string | null = null;
      if (target === id && (upstream || twoWay)) {
        next = source;
      }
      if (source === id && (!upstream || twoWay)) {
        next = target;
      }
      if (next === null) {
        continue;
      }
      chain.edges.add(arrow.data.id);
      if (!chain.nodes.has(next)) {
        chain.nodes.add(next);
        queue.push(next);
      }
    }
  }

  return chain;
}

/**
 * Collects the details shown in the side panel for a report.
 * Parents point to the report, children are pointed to by it;
 * a two-way arrow makes the other report both a parent and a child.
 * With allLevels, the lists hold the whole chains instead: the parents of the parents, ...
 * and the children of the children, ... (the report itself is left out).
 * @param {GraphElement[]} elements - Output of buildGraph
 * @param {string} id - Id of the report
 * @param {boolean} [allLevels] - Every level of parents and children, not just the first
 * @returns {NodeInfo} The details
 */
export function getNodeInfo(elements: GraphElement[], id: string, allLevels = false): NodeInfo {
  const links = linksOf(elements, id);
  const ids = (direction: 'parents' | 'children'): string[] =>
    allLevels
      ? [...getChain(elements, id, direction).nodes].filter((other) => other !== id)
      : [...new Set(links[direction])];
  const byName = (a: NodeRef, b: NodeRef): number => compareNames(a.name, b.name);
  return {
    ...describeReport(elements, id),
    parents: ids('parents')
      .map((other) => describeReport(elements, other))
      .sort(byName),
    children: ids('children')
      .map((other) => describeReport(elements, other))
      .sort(byName),
  };
}

/**
 * The parent/child lists shown in the side panel and copied to the clipboard;
 * empty lists are left out.
 * @param {ReturnType<typeof getNodeInfo>} info - Output of getNodeInfo
 * @returns {Array<[string, Object[]]>} [title, list] pairs
 */
export function infoSections(info: NodeInfo): [string, NodeRef[]][] {
  const sections: [string, NodeRef[]][] = [
    ['Parent Nodes', info.parents],
    ['Child Nodes', info.children],
  ];
  return sections.filter(([, list]) => list.length > 0);
}

/**
 * The elements to hide for the reports unchecked in "Node to Display": those reports
 * and the groups left with no visible report.
 * @param {GraphElement[]} elements - Output of buildGraph
 * @param {Set<string>} hiddenIds - Ids of the reports to hide
 * @returns {Set<string>} Ids of the reports and groups to hide (the arrows follow their reports)
 */
export function getHiddenIds(elements: GraphElement[], hiddenIds: Set<string>): Set<string> {
  const reports = elements.filter(isReport);
  const hidden = new Set(reports.filter((r) => hiddenIds.has(r.data.id)).map((r) => r.data.id));
  for (const group of elements.filter(isGroup)) {
    const members = reports.filter((r) => r.data.parent === group.data.id);
    if (members.length > 0 && members.every((r) => hidden.has(r.data.id))) {
      hidden.add(group.data.id);
    }
  }
  return hidden;
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

/** One of the two tracked chains: the report and which way to follow the arrows. */
export interface Track {
  id: string;
  direction: 'parents' | 'children';
}

const TRACK_PREFIXES = ['track', 'track2'] as const;

/**
 * The classes of every element for the tracked chains (Show Dependency 1 and 2):
 * - the elements of one chain get that track's class (track-parents, track2-children, ...),
 *   and the tracked report also gets track-root (or track2-root);
 * - elements on both chains also get track-mixed;
 * - when a chain is shown, every report and arrow off all chains gets faded (groups stay).
 * @param {GraphElement[]} elements - Output of buildGraph
 * @param {Track[]} tracks - Track 1 and Track 2 ('' id = off)
 * @returns {Map<string, string[]>} Classes per element id (elements with no class are left out)
 */
export function applyTracking(elements: GraphElement[], tracks: Track[]): Map<string, string[]> {
  const classes = new Map<string, string[]>();
  const add = (id: string, name: string): void => {
    classes.set(id, [...(classes.get(id) ?? []), name]);
  };

  const reportIds = new Set(elements.filter(isReport).map((e) => e.data.id));
  const chains = tracks.map(({ id, direction }, index): Set<string> | null => {
    if (!id || !reportIds.has(id)) {
      return null;
    }
    const prefix = TRACK_PREFIXES[index] ?? 'track';
    const chain = getChain(elements, id, direction);
    const members = new Set([...chain.nodes, ...chain.edges]);
    for (const member of members) {
      add(member, `${prefix}-${direction}`);
    }
    add(id, `${prefix}-root`);
    return members;
  });

  const active = chains.filter((chain): chain is Set<string> => chain !== null);
  if (active.length === 0) {
    return classes;
  }

  const [first, second] = chains;
  if (first && second) {
    for (const member of first) {
      if (second.has(member)) {
        add(member, 'track-mixed');
      }
    }
  }

  // Groups stay visible; only reports and arrows off every chain are dimmed
  for (const element of elements) {
    if (!isGroup(element) && !active.some((chain) => chain.has(element.data.id))) {
      add(element.data.id, 'faded');
    }
  }
  return classes;
}

/** Colors of the two tracks, of the reports on both, and of the selected report. */
export interface TrackColors {
  parents: string;
  children: string;
  track2Parents: string;
  track2Children: string;
  common: string;
}

/** How one box or arrow looks. */
export interface Appearance {
  color: string;
  width: number;
  fill: string;
  opacity: number;
}

const FADED_OPACITY = 0.15;

/**
 * The look of a report for its classes: border color and width, fill and opacity.
 * Later rules win, as in the track order: track 1, track 2, then the reports on both.
 */
export function reportAppearance(classes: string[], colors: TrackColors): Appearance {
  const look: Appearance = { color: GRAPH_COLOR, width: 2, fill: REPORT_BACKGROUND_COLOR, opacity: 1 };
  const rules: [string, string, string][] = [
    ['track-parents', 'track-root', colors.parents],
    ['track-children', 'track-root', colors.children],
    ['track2-parents', 'track2-root', colors.track2Parents],
    ['track2-children', 'track2-root', colors.track2Children],
  ];
  for (const [name, root, color] of rules) {
    if (classes.includes(name)) {
      look.color = color;
      look.width = 3;
      if (classes.includes(root)) {
        look.width = 5;
        look.fill = lightTint(color);
      }
    }
  }
  if (classes.includes('track-mixed')) {
    look.color = colors.common;
    look.width = 4;
    if (classes.includes('track-root') || classes.includes('track2-root')) {
      look.width = 6;
      look.fill = lightTint(colors.common);
    }
  }
  if (classes.includes('faded')) {
    look.opacity = FADED_OPACITY;
  }
  return look;
}

/** The look of an arrow for its classes: color, width and opacity. */
export function edgeAppearance(classes: string[], colors: TrackColors): Appearance {
  const look: Appearance = { color: GRAPH_COLOR, width: 2, fill: GRAPH_COLOR, opacity: 1 };
  const rules: [string, string][] = [
    ['track-parents', colors.parents],
    ['track-children', colors.children],
    ['track2-parents', colors.track2Parents],
    ['track2-children', colors.track2Children],
  ];
  for (const [name, color] of rules) {
    if (classes.includes(name)) {
      look.color = color;
      look.width = 4;
    }
  }
  if (classes.includes('track-mixed')) {
    look.color = colors.common;
    look.width = 5;
  }
  look.fill = look.color;
  if (classes.includes('faded')) {
    look.opacity = FADED_OPACITY;
  }
  return look;
}

/** Fill of the group boxes */
export const GROUP_FILL = GROUP_BACKGROUND_COLOR;

/** A report placed on the canvas. */
export interface PlacedReport {
  id: string;
  label: string;
  parent: string | undefined;
  rect: Rect;
}

/** A group box placed on the canvas. */
export interface PlacedGroup {
  id: string;
  label: string;
  rect: Rect;
  fontSize: number;
}

/** Every box of the graph, at its place on the canvas. */
export interface PlacedGraph {
  reports: PlacedReport[];
  groups: PlacedGroup[];
}

/** Options of placeGraph. */
export interface PlaceOptions {
  showGroups: boolean;
  showGroupInLabel: boolean;
  /** px added to the graph text size */
  fontDelta: number;
}

/**
 * Gives every report its box (size from its label, centered on its layout position) and every
 * group the box around its reports. Without groups, the reports are not inside anything.
 * @param {GraphElement[]} elements - Output of buildGraph
 * @param {Map<string, {x: number, y: number}>} centers - Output of layoutPositions
 * @param {PlaceOptions} options - What to show and the text size
 * @returns {PlacedGraph} The boxes
 */
export function placeGraph(
  elements: GraphElement[],
  centers: Map<string, { x: number; y: number }>,
  { showGroups, showGroupInLabel, fontDelta }: PlaceOptions
): PlacedGraph {
  const reportFont = REPORT_FONT_SIZE + fontDelta;
  const groupFont = GROUP_FONT_SIZE + fontDelta;
  const reports: PlacedReport[] = [];
  for (const element of elements.filter(isReport)) {
    const center = centers.get(element.data.id);
    if (!center) {
      continue;
    }
    const label = (showGroupInLabel ? element.data.displayLabel : element.data.rawLabel) ?? element.data.id;
    const { width, height } = getNodeSize(label, reportFont);
    reports.push({
      id: element.data.id,
      label,
      parent: showGroups ? element.data.parent : undefined,
      rect: { x: center.x - width / 2, y: center.y - height / 2, width, height },
    });
  }

  const groups: PlacedGroup[] = [];
  if (showGroups) {
    const labelSpace = Math.ceil(groupFont * LINE_HEIGHT);
    for (const element of elements.filter(isGroup)) {
      const members = reports.filter((r) => r.parent === element.data.id);
      if (members.length === 0) {
        continue;
      }
      const left = Math.min(...members.map((m) => m.rect.x)) - GROUP_PADDING;
      const top = Math.min(...members.map((m) => m.rect.y)) - GROUP_PADDING - labelSpace;
      const right = Math.max(...members.map((m) => m.rect.x + m.rect.width)) + GROUP_PADDING;
      const bottom = Math.max(...members.map((m) => m.rect.y + m.rect.height)) + GROUP_PADDING;
      groups.push({
        id: element.data.id,
        label: element.data.label ?? element.data.id,
        rect: { x: left, y: top, width: right - left, height: bottom - top },
        fontSize: groupFont,
      });
    }
  }
  return { reports, groups };
}

/** A straight line between two points. */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Where the ray from the center of `from` towards `to` leaves the box `from`. */
function borderPoint(from: Rect, to: Rect): { x: number; y: number } {
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  const dx = to.x + to.width / 2 - cx;
  const dy = to.y + to.height / 2 - cy;
  if (dx === 0 && dy === 0) {
    return { x: cx, y: cy };
  }
  const scale = Math.min(
    dx === 0 ? Infinity : from.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : from.height / 2 / Math.abs(dy)
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * The line of an arrow: from the border of one box to the border of the other,
 * on the line between their centers.
 */
export function edgeSegment(source: Rect, target: Rect): Segment {
  const start = borderPoint(source, target);
  const end = borderPoint(target, source);
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

/** The curve of an arrow from a report to itself: a loop above the box. */
export function loopPath(box: Rect): { d: string; tip: { x: number; y: number }; angle: number } {
  const cx = box.x + box.width / 2;
  const top = box.y;
  const start = { x: cx - 24, y: top };
  const end = { x: cx + 24, y: top };
  const c1 = { x: cx - 64, y: top - 72 };
  const c2 = { x: cx + 64, y: top - 72 };
  return {
    d: `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`,
    tip: end,
    angle: Math.atan2(end.y - c2.y, end.x - c2.x),
  };
}

/** Size of the arrowheads, as a multiple of the line width */
const ARROW_LENGTH = 14;
const ARROW_HALF_WIDTH = 6;

/**
 * An arrowhead ("vee" shape) with its tip at (x, y), pointing along `angle` (radians).
 * @returns {string} SVG path data
 */
export function arrowPath(x: number, y: number, angle: number): string {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const point = (back: number, side: number): string =>
    `${(x - back * cos - side * sin).toFixed(2)} ${(y - back * sin + side * cos).toFixed(2)}`;
  return `M ${point(0, 0)} L ${point(ARROW_LENGTH, -ARROW_HALF_WIDTH)} L ${point(ARROW_LENGTH * 0.6, 0)} L ${point(ARROW_LENGTH, ARROW_HALF_WIDTH)} Z`;
}

/** A point on the canvas. */
export interface Point {
  x: number;
  y: number;
}

/**
 * The layout centers with the reports the user has moved put where they were dropped.
 * @param {Map<string, Point>} layoutCenters - Output of layoutPositions
 * @param {Record<string, Point>} moved - Center of every report the user moved
 */
export function mergeCenters(
  layoutCenters: Map<string, Point>,
  moved: Record<string, Point>
): Map<string, Point> {
  const merged = new Map(layoutCenters);
  for (const [id, center] of Object.entries(moved)) {
    if (layoutCenters.has(id)) {
      merged.set(id, center);
    }
  }
  return merged;
}

/**
 * The center of a report dragged to `position`, which is its top left corner on the canvas,
 * or relative to its group box when the report is inside one.
 * @param {Point} position - Top left corner where the report was dropped
 * @param {{width: number, height: number}} size - Size of the report box
 * @param {Point|undefined} groupCorner - Top left corner of the group box around the report, if any
 */
export function centerAfterDrag(
  position: Point,
  size: { width: number; height: number },
  groupCorner?: Point
): Point {
  return {
    x: (groupCorner?.x ?? 0) + position.x + size.width / 2,
    y: (groupCorner?.y ?? 0) + position.y + size.height / 2,
  };
}
