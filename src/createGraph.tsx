'use client';

/**
 * createGraph.tsx
 * Factory for creating the graph component: report boxes grouped in group boxes (React Flow
 * sub flows), placed on a grid layout, with search, a details panel and a "save to clipboard"
 * context menu; reports and group boxes can be dragged. The graph itself is built in graph.ts;
 * this file draws it.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { CSSProperties, FC } from 'react';
import { Handle, Position, ReactFlow, ReactFlowProvider, useInternalNode, useReactFlow } from '@xyflow/react';
import type { Edge, EdgeProps, EdgeTypes, Node, NodeChange, NodeProps, NodeTypes } from '@xyflow/react';
import {
  DEFAULT_LAYOUT_COLUMNS,
  DEFAULT_RIGHT_DISPLAY_FONT_SIZE,
  DEFAULT_SELECTED_COLOR,
  DEFAULT_TOP_CONTROLS_FONT_SIZE,
  DEFAULT_TRACK1_CHILDREN_COLOR,
  DEFAULT_TRACK1_PARENTS_COLOR,
  DEFAULT_TRACK2_CHILDREN_COLOR,
  DEFAULT_TRACK2_PARENTS_COLOR,
  DEFAULT_TRACK_COMMON_COLOR,
  GROUP_BACKGROUND_COLOR,
  GRAPH_COLOR,
} from './default_setting.ts';
import {
  LABEL_FONT_FAMILY,
  REPORT_FONT_SIZE,
  applyTracking,
  arrowPath,
  buildGraph,
  centerAfterDrag,
  compareNames,
  edgeAppearance,
  edgeSegment,
  formatNodeInfo,
  getHiddenIds,
  getNodeInfo,
  infoSections,
  isEdge,
  isReport,
  layoutFromGroups,
  layoutPositions,
  loopPath,
  mergeCenters,
  placeGraph,
  reportAppearance,
  uniquifyLayout,
} from './graph.ts';
import type {
  Appearance,
  Connections,
  Layout,
  LayoutOptions,
  NodeGroups,
  Point,
  Rect,
  Track,
  TrackColors,
} from './graph.ts';
import { NodeSearch } from './NodeSearch.tsx';
import { buildSvg, downloadSvg } from './svg.ts';
import type { SvgEdge, SvgGroup, SvgReport } from './svg.ts';

// Defaults live in default_setting.ts; re-exported so they stay importable from here
export * from './default_setting.ts';

// The + / - buttons change the text size of the chosen area by this many pixels per click,
// within these limits
const FONT_STEP = 2;
const MIN_FONT_DELTA = -8;
const MAX_FONT_DELTA = 16;
// Areas the font dropdown can pick
type FontArea = 'top' | 'right' | 'graph';
const FONT_AREAS: readonly (readonly [FontArea, string])[] = [
  ['top', 'Font Top Panel'],
  ['right', 'Font Right Panel'],
  ['graph', 'Font Graph Panel'],
];

// Zoom to a selected report, and the room (share of the view) around the whole graph
const SELECT_ZOOM = 1.8;
const FIT_PADDING = 0.1;
const ANIMATION_MS = 400;

/** What a report box needs to draw itself */
interface ReportData extends Record<string, unknown> {
  label: string;
  fontSize: number;
  look: Appearance;
  halo: string | null;
}
/** What a group box needs to draw itself */
interface GroupData extends Record<string, unknown> {
  label: string;
  fontSize: number;
}
/** What an arrow needs to draw itself */
interface ArrowData extends Record<string, unknown> {
  twoWay: boolean;
  look: Appearance;
}

type ReportNode = Node<ReportData, 'report'>;
type GroupNode = Node<GroupData, 'group'>;
type ArrowEdge = Edge<ArrowData, 'arrow'>;

/** A report box: its label inside a box that is as big as the text. */
function ReportBox({ data }: NodeProps<ReportNode>): React.JSX.Element {
  const { label, fontSize, look, halo } = data;
  const style: CSSProperties = {
    fontSize,
    background: look.fill,
    borderColor: look.color,
    borderWidth: look.width,
    opacity: look.opacity,
  };
  if (halo !== null) {
    style.boxShadow = `0 0 0 8px color-mix(in srgb, ${halo} 35%, transparent)`;
  }
  // React Flow only draws an arrow between boxes that have a handle; these two are invisible
  // (the arrow is drawn from the border of the box, see ArrowLine)
  return (
    <div className="rbg-report" style={style}>
      <Handle type="target" position={Position.Top} className="rbg-handle" isConnectable={false} />
      {label}
      <Handle type="source" position={Position.Bottom} className="rbg-handle" isConnectable={false} />
    </div>
  );
}

/** A group box: a dashed frame around its reports, with the group name on top. */
function GroupBox({ data }: NodeProps<GroupNode>): React.JSX.Element {
  return (
    <div className="rbg-group">
      <span className="rbg-group-label" style={{ fontSize: data.fontSize }}>
        {data.label}
      </span>
    </div>
  );
}

/** The box of a node as the canvas knows it now, in canvas units. */
function useRect(id: string): Rect | null {
  const node = useInternalNode(id);
  if (!node) {
    return null;
  }
  const width = node.measured.width ?? node.width;
  const height = node.measured.height ?? node.height;
  if (width === undefined || height === undefined) {
    return null;
  }
  return { x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y, width, height };
}

/**
 * An arrow that runs from the border of one box to the border of the other, with an arrowhead
 * at the end (and at the start for a two-way arrow). A report pointing at itself gets a loop.
 */
function ArrowLine({ source, target, data }: EdgeProps<ArrowEdge>): React.JSX.Element | null {
  const sourceRect = useRect(source);
  const targetRect = useRect(target);
  if (!sourceRect || !targetRect || !data) {
    return null;
  }
  const { color, width, opacity } = data.look;

  if (source === target) {
    const loop = loopPath(sourceRect);
    return (
      <g opacity={opacity}>
        <path d={loop.d} fill="none" stroke={color} strokeWidth={width} />
        <path d={arrowPath(loop.tip.x, loop.tip.y, loop.angle)} fill={color} />
      </g>
    );
  }

  const { x1, y1, x2, y2 } = edgeSegment(sourceRect, targetRect);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  return (
    <g opacity={opacity}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={width} />
      <path d={arrowPath(x2, y2, angle)} fill={color} />
      {data.twoWay && <path d={arrowPath(x1, y1, angle + Math.PI)} fill={color} />}
    </g>
  );
}

const NODE_TYPES: NodeTypes = { report: ReportBox, group: GroupBox };
const EDGE_TYPES: EdgeTypes = { arrow: ArrowLine };

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
 * Factory function that creates the graph component. Call it once, at the top level of a module.
 *
 * The component draws the graph with React Flow and manages its state: the search boxes, showing and
 * hiding reports, the two tracked chains (Show Dependency 1 and 2), the details panel, the text sizes,
 * dragging reports and group boxes, and the SVG export.
 *
 * @param {Object<string, string[]>} node_groups - Group names mapped to the names of their reports
 * @param {Array<[string, string]>} direct_node_connections - Arrows, as [source, target] pairs
 * @param {string[][]|Object} [layoutOrOptions] - Layout grid (one list of report names per row).
 *   Optional: leave it out and pass the options in its place, e.g.
 *   create_graph(node_groups, direct_node_connections, options), to build the layout from the groups
 * @param {Object} [optionsArg] - Options:
 *   - grid: startX, startY, offsetX, offsetY, base, and layoutColumns (reports per row when the layout
 *     is built from the groups)
 *   - colors ("#rrggbb" or "rgb(r, g, b)"): selectedColor (Node to Display), parentsColor and
 *     childrenColor (Show Dependency 1), track2ParentsColor and track2ChildrenColor (Show Dependency 2),
 *     commonColor (reports and arrows on both chains)
 *   - text sizes (CSS lengths, e.g. '16px'): topControlsFontSize (top row) and rightDisplayFontSize
 *     (details panel)
 * @returns {React.FC} The graph component (it takes no props and fills its container)
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
  const COLORS: TrackColors = {
    parents: parentsColor,
    children: childrenColor,
    track2Parents: track2ParentsColor,
    track2Children: track2ChildrenColor,
    common: commonColor,
  };
  // Colors for react-beauti-graph.css, set as CSS variables (the text sizes are added in the component)
  const CSS_VARS = {
    '--rbg-parents-color': parentsColor,
    '--rbg-children-color': childrenColor,
  };
  // The Show Dependency 2 switch reuses the same CSS with its own colors
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
    layout !== null && hasLayout ? uniquifyLayout(layout) : layoutFromGroups(ALL_ELEMENTS, layoutColumns);
  const REPORTS = ALL_ELEMENTS.filter(isReport);
  const CENTERS = layoutPositions(LAYOUT, new Set(REPORTS.map((r) => r.data.id)), options);
  const NODE_OPTIONS = REPORTS.map((r) => ({
    id: r.data.id,
    label: r.data.displayLabel ?? r.data.id,
  })).sort((a, b) => compareNames(a.label, b.label));
  const ARROWS = ALL_ELEMENTS.filter(isEdge);

  function GraphView(): React.JSX.Element {
    const flow = useReactFlow<ReportNode | GroupNode, ArrowEdge>();
    const uid = useId(); // unique ids, so several graphs can share a page
    const [selectedId, setSelectedId] = useState('');
    const [fitRequest, setFitRequest] = useState(0); // bumped to zoom out to the full graph
    const [trackedId, setTrackedId] = useState(''); // '' = Show Nothing
    const [trackDirection, setTrackDirection] = useState<Track['direction']>('parents');
    const [tracked2Id, setTracked2Id] = useState(''); // Show Dependency 2, '' = Show Nothing
    const [track2Direction, setTrack2Direction] = useState<Track['direction']>('parents');
    const [showGroups, setShowGroups] = useState(true);
    const [showGroupInLabel, setShowGroupInLabel] = useState(true);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; copyText: string } | null>(null);
    const [detailsId, setDetailsId] = useState<string | null>(null); // report shown in the details panel
    const [fontArea, setFontArea] = useState<FontArea>('top'); // area the + / - buttons change
    const [fontDeltas, setFontDeltas] = useState<Record<FontArea, number>>({ top: 0, right: 0, graph: 0 }); // px added per area
    const [allLevels, setAllLevels] = useState(false); // panel: one level (default) or all levels
    const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set()); // reports unchecked in "Node to Display"
    // Center of every report the user dragged (alone, or with the group box it is in)
    const [moved, setMoved] = useState<Record<string, Point>>({});

    // Every box at its place on the canvas (and the size of its text). Group boxes are drawn around
    // their reports wherever those are, so they follow a report that is dragged.
    const placed = useMemo(
      () =>
        placeGraph(ALL_ELEMENTS, mergeCenters(CENTERS, moved), {
          showGroups,
          showGroupInLabel,
          fontDelta: fontDeltas.graph,
        }),
      [moved, showGroups, showGroupInLabel, fontDeltas.graph]
    );
    // The classes every element gets from the two tracked chains
    const classes = useMemo(
      () =>
        applyTracking(ALL_ELEMENTS, [
          { id: trackedId, direction: trackDirection },
          { id: tracked2Id, direction: track2Direction },
        ]),
      [trackedId, trackDirection, tracked2Id, track2Direction]
    );
    // Reports unchecked in "Node to Display", and the groups left empty by them
    const hidden = useMemo(() => getHiddenIds(ALL_ELEMENTS, hiddenIds), [hiddenIds]);

    const reportFont = REPORT_FONT_SIZE + fontDeltas.graph;
    const nodes = useMemo((): (ReportNode | GroupNode)[] => {
      const groupRects = new Map(placed.groups.map((g) => [g.id, g.rect]));
      // A group must come before the reports inside it
      const groupNodes: GroupNode[] = placed.groups.map((g) => ({
        id: g.id,
        type: 'group',
        position: { x: g.rect.x, y: g.rect.y },
        width: g.rect.width,
        height: g.rect.height,
        data: { label: g.label, fontSize: g.fontSize },
        hidden: hidden.has(g.id),
        selectable: false,
        focusable: false,
      }));
      const reportNodes: ReportNode[] = placed.reports.map((r) => {
        const parentRect = r.parent === undefined ? undefined : groupRects.get(r.parent);
        const origin = parentRect ?? { x: 0, y: 0 };
        const node: ReportNode = {
          id: r.id,
          type: 'report',
          position: { x: r.rect.x - origin.x, y: r.rect.y - origin.y },
          width: r.rect.width,
          height: r.rect.height,
          data: {
            label: r.label,
            fontSize: reportFont,
            look: reportAppearance(classes.get(r.id) ?? [], COLORS),
            halo: r.id === selectedId ? selectedColor : null,
          },
          hidden: hidden.has(r.id),
          selectable: false,
        };
        if (r.parent !== undefined && parentRect !== undefined) {
          node.parentId = r.parent;
        }
        return node;
      });
      return [...groupNodes, ...reportNodes];
    }, [placed, hidden, classes, selectedId, reportFont]);

    // Every arrow with its look and whether it is hidden (an arrow goes with its reports)
    const arrows = useMemo(
      () =>
        ARROWS.flatMap((arrow) => {
          const { id, source, target } = arrow.data;
          if (source === undefined || target === undefined) {
            return [];
          }
          return [
            {
              id,
              source,
              target,
              twoWay: arrow.classes === 'bidirectional',
              look: edgeAppearance(classes.get(id) ?? [], COLORS),
              hidden: hidden.has(source) || hidden.has(target),
            },
          ];
        }),
      [classes, hidden]
    );
    const edges = useMemo(
      (): ArrowEdge[] =>
        arrows.map(({ id, source, target, twoWay, look, hidden: isHidden }) => ({
          id,
          source,
          target,
          type: 'arrow',
          data: { twoWay, look },
          hidden: isHidden,
          selectable: false,
          focusable: false,
        })),
      [arrows]
    );

    const nodeInfo = useMemo(
      () => (detailsId === null ? null : getNodeInfo(ALL_ELEMENTS, detailsId, allLevels)),
      [detailsId, allLevels]
    );

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

    // Exports the graph as it is on the screen: boxes, colors and what is dimmed or hidden
    const exportSvg = (): void => {
      const rects = new Map<string, Rect>(placed.reports.map((r) => [r.id, r.rect]));
      const groups: SvgGroup[] = placed.groups
        .filter((g) => !hidden.has(g.id))
        .map((g) => ({ rect: g.rect, label: g.label, fontSize: g.fontSize }));
      const reports: SvgReport[] = placed.reports
        .filter((r) => !hidden.has(r.id))
        .map((r) => ({
          rect: r.rect,
          label: r.label,
          fontSize: reportFont,
          look: reportAppearance(classes.get(r.id) ?? [], COLORS),
        }));
      const svgArrows: SvgEdge[] = arrows
        .filter((arrow) => !arrow.hidden)
        .flatMap(({ source, target, twoWay, look }) => {
          const from = rects.get(source);
          const to = rects.get(target);
          return from && to ? [{ source: from, target: to, twoWay, look }] : [];
        });
      downloadSvg(buildSvg(groups, reports, svgArrows));
    };

    // Dragging a report moves it; dragging a group box moves all the reports in it
    const onNodesChange = (changes: NodeChange<ReportNode | GroupNode>[]): void => {
      const next: Record<string, Point> = {};
      for (const change of changes) {
        if (change.type !== 'position' || change.position === undefined) {
          continue;
        }
        const group = placed.groups.find((g) => g.id === change.id);
        if (group) {
          const dx = change.position.x - group.rect.x;
          const dy = change.position.y - group.rect.y;
          for (const member of placed.reports.filter((r) => r.parent === group.id)) {
            next[member.id] = {
              x: member.rect.x + member.rect.width / 2 + dx,
              y: member.rect.y + member.rect.height / 2 + dy,
            };
          }
          continue;
        }
        const report = placed.reports.find((r) => r.id === change.id);
        if (report) {
          const groupRect = placed.groups.find((g) => g.id === report.parent)?.rect;
          next[report.id] = centerAfterDrag(change.position, report.rect, groupRect);
        }
      }
      if (Object.keys(next).length > 0) {
        setMoved((previous) => ({ ...previous, ...next }));
      }
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
      if (!REPORTS.some((r) => r.data.id === id)) {
        return;
      }
      if (hiddenIds.has(id)) {
        toggleVisible(id);
      }
      setSelectedId(id);
      setDetailsId(id);
    };

    // ALL (or clearing the search): no selection, no details panel, whole graph in view
    const showAll = (): void => {
      setSelectedId('');
      setDetailsId(null);
      setFitRequest((n) => n + 1);
    };

    // Zoom out to the full graph. Runs after the re-render, so the closed details panel has
    // already given its width back to the graph.
    useEffect(() => {
      if (fitRequest === 0) {
        return undefined;
      }
      const frame = requestAnimationFrame(() => {
        void flow.fitView({ padding: FIT_PADDING, duration: ANIMATION_MS });
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }, [fitRequest, flow]);

    // Center on the selected node. Runs after the render that shows a hidden node again.
    useEffect(() => {
      const box = placed.reports.find((r) => r.id === selectedId)?.rect;
      if (!box) {
        return;
      }
      void flow.setCenter(box.x + box.width / 2, box.y + box.height / 2, {
        zoom: SELECT_ZOOM,
        duration: ANIMATION_MS,
      });
    }, [selectedId, placed, flow]);

    // The graph fills the window when it first appears
    const onInit = useCallback((): void => {
      void flow.fitView({ padding: FIT_PADDING });
    }, [flow]);

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
            '--rbg-label-font-family': LABEL_FONT_FAMILY,
            '--rbg-graph-color': GRAPH_COLOR,
            '--rbg-group-fill': GROUP_BACKGROUND_COLOR,
          } as CSSProperties
        }
      >
        <div className="controls">
          {/* Each label stays next to its box when the row wraps */}
          <span className="control-group">
            <label htmlFor={`${uid}-search`}>Node to Display:</label>
            <NodeSearch
              id={`${uid}-search`}
              options={NODE_OPTIONS}
              selectedId={selectedId}
              // Picking a node also opens its details panel, like a double click
              onSelect={(id) => {
                if (id) {
                  showNode(id);
                } else {
                  showAll();
                }
              }}
              // Checkbox next to each node: show it in the graph or not
              hiddenIds={hiddenIds}
              onToggleVisible={toggleVisible}
            />
          </span>
          <label>
            <input type="checkbox" checked={showGroups} onChange={(e) => setShowGroups(e.target.checked)} />
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
                options={NODE_OPTIONS}
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
          {Object.keys(moved).length > 0 && (
            <button type="button" className="reset-layout" onClick={() => setMoved({})}>
              Reset layout
            </button>
          )}
          <button type="button" className="export-svg" onClick={exportSvg}>
            Export SVG
          </button>
        </div>
        <div className="graph-area">
          <div className="rbg-flow">
            <ReactFlow<ReportNode | GroupNode, ArrowEdge>
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onInit={onInit}
              onNodesChange={onNodesChange}
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable={false}
              minZoom={0.05}
              maxZoom={4}
              zoomOnDoubleClick={false}
              // Double click on a report shows its details in the side panel
              onNodeDoubleClick={(_event, node) => {
                if (node.type === 'report') {
                  setDetailsId(node.id);
                }
              }}
              // Right click on a report opens the "Save to clipboard" menu
              // (copies the same information the side panel shows)
              onNodeContextMenu={(event, node) => {
                event.preventDefault();
                if (node.type === 'report') {
                  setContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    copyText: formatNodeInfo(getNodeInfo(ALL_ELEMENTS, node.id, allLevels)),
                  });
                }
              }}
              // Close the menu on any other interaction with the graph
              onNodeClick={() => setContextMenu(null)}
              onPaneClick={() => setContextMenu(null)}
              onPaneContextMenu={(event) => {
                event.preventDefault();
                setContextMenu(null);
              }}
              onMoveStart={() => setContextMenu(null)}
            />
          </div>
          {nodeInfo && (
            <aside className="node-info-panel">
              <div className="node-info-header">
                <h2>
                  <strong>Node:</strong> {nodeInfo.name}
                </h2>
                <button type="button" onClick={() => setDetailsId(null)} aria-label="Close">
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
                  onClick={() => setAllLevels((on) => !on)}
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

  function Graph(): React.JSX.Element {
    return (
      <ReactFlowProvider>
        <GraphView />
      </ReactFlowProvider>
    );
  }

  return Graph;
}
