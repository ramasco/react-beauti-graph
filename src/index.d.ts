import type { FC } from 'react';

export interface GraphOptions {
  /** Layout: first column / row position and spacing */
  startX?: number;
  startY?: number;
  offsetX?: number;
  offsetY?: number;
  base?: number;
  /** Reports per row when the layout is built from the groups */
  layoutColumns?: number;
  /** Colors: "#rrggbb" (commonColor also accepts "rgb(r, g, b)") */
  selectedColor?: string;
  parentsColor?: string;
  childrenColor?: string;
  track2ParentsColor?: string;
  track2ChildrenColor?: string;
  commonColor?: string;
  /** Text sizes, e.g. '16px' */
  topControlsFontSize?: string;
  rightDisplayFontSize?: string;
}

/** Report names inside each group */
export type NodeGroups = Record<string, string[]>;
/** Arrows: [source, target] */
export type Connections = [string, string][];

export function create_graph(
  node_groups?: NodeGroups,
  direct_node_connections?: Connections,
  layout?: string[][] | GraphOptions | null,
  options?: GraphOptions
): FC;

export interface NodeRef {
  id: string;
  name: string;
  group: string | null;
}

export interface NodeInfo extends NodeRef {
  parents: NodeRef[];
  children: NodeRef[];
}

/** Details of a Cytoscape node; allLevels lists the whole chains of parents and children */
export function getNodeInfo(node: unknown, allLevels?: boolean): NodeInfo;

/** Plain-text version of the details, as copied to the clipboard */
export function formatNodeInfo(info: NodeInfo): string;

export interface NodeSearchProps {
  id?: string;
  options: { id: string; label: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
  noneLabel?: string;
  hiddenIds?: Set<string>;
  onToggleVisible?: (id: string) => void;
}

export const NodeSearch: FC<NodeSearchProps>;
