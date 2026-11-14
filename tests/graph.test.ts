import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Connections, GraphElement, NodeGroups, NodeRef, Rect } from '../src/graph.ts';
import {
  applyTracking,
  arrowPath,
  buildGraph,
  centerAfterDrag,
  compareNames,
  edgeAppearance,
  edgeSegment,
  formatNodeInfo,
  getChain,
  getHiddenIds,
  getNodeInfo,
  getNodeSize,
  layoutFromGroups,
  layoutPositions,
  lightTint,
  mergeCenters,
  loopPath,
  placeGraph,
  reportAppearance,
  uniqueId,
  uniquifyLayout,
} from '../src/graph.ts';
import type { TrackColors } from '../src/graph.ts';
import { DEFAULT_TRACK_COMMON_COLOR } from '../src/default_setting.ts';

/** The elements of a graph, as the component builds them */
const graphOf = (
  node_groups: NodeGroups,
  direct_node_connections: Connections = [],
  extraIds: string[] = []
): GraphElement[] => buildGraph(node_groups, direct_node_connections, extraIds);

const nodesOf = (elements: GraphElement[]): GraphElement[] => elements.filter((e) => !e.data.source);
const edgesOf = (elements: GraphElement[]): GraphElement[] => elements.filter((e) => e.data.source);
const byId = (elements: GraphElement[], id: string): GraphElement => {
  const found = elements.find((e) => e.data.id === id);
  if (!found) {
    throw new Error(`no element "${id}"`);
  }
  return found;
};
const ids = (list: NodeRef[]): string[] => list.map((x) => x.id);
const names = (list: NodeRef[]): string[] => list.map((x) => x.name);

const COLORS: TrackColors = {
  parents: '#2e7d32',
  children: '#7b1fa2',
  track2Parents: '#efeb00',
  track2Children: '#8b4513',
  common: DEFAULT_TRACK_COMMON_COLOR,
};

describe('getNodeSize', () => {
  // jsdom has no canvas, so the text width is estimated from the number of characters
  it('is as wide as the label plus the padding, and grows with it', () => {
    const short = getNodeSize('ab');
    const long = getNodeSize('ab'.repeat(10));
    expect(long.width).toBeGreaterThan(short.width);
    expect(long.height).toBe(short.height);
  });

  it('grows with the font size', () => {
    expect(getNodeSize('r001', 20).width).toBeGreaterThan(getNodeSize('r001', 10).width);
    expect(getNodeSize('r001', 20).height).toBeGreaterThan(getNodeSize('r001', 10).height);
  });

  it('keeps only the padding for a missing label', () => {
    expect(getNodeSize(undefined)).toEqual({ width: 8, height: 8 + Math.ceil(16 * 1.2) });
  });
});

describe('compareNames', () => {
  it('sorts case-insensitively and numerically', () => {
    const sample = ['beta', 'Alpha', 'n10', 'N2', 'zeta', 'Zebra'];
    expect(sample.sort(compareNames)).toEqual(['Alpha', 'beta', 'N2', 'n10', 'Zebra', 'zeta']);
  });

  it('treats names differing only by case as equal', () => {
    expect(compareNames('Report', 'report')).toBe(0);
  });
});

describe('uniqueId', () => {
  it('returns the base when free and records it', () => {
    const taken = new Set<string>();
    expect(uniqueId('e1', taken)).toBe('e1');
    expect(taken.has('e1')).toBe(true);
  });

  it('adds a counter when the base is taken', () => {
    const taken = new Set(['e1', 'e1_2']);
    expect(uniqueId('e1', taken)).toBe('e1_3');
  });
});

describe('uniquifyLayout', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('keeps unique ids unchanged', () => {
    expect(uniquifyLayout([['a', 'b'], ['c']])).toEqual([['a', 'b'], ['c']]);
  });

  it('renames repeated ids with (n)', () => {
    expect(
      uniquifyLayout([
        ['a', 'b'],
        ['a', 'a'],
      ])
    ).toEqual([
      ['a', 'b'],
      ['a(1)', 'a(2)'],
    ]);
  });

  it('handles an empty layout', () => {
    expect(uniquifyLayout()).toEqual([]);
  });
});

describe('buildGraph', () => {
  it('creates a group element per group with a camelCase id', () => {
    const elements = buildGraph({ 'Group A': ['a'] }, []);
    expect(byId(elements, 'groupA').data).toEqual({
      id: 'groupA',
      class: 'group',
      label: 'Group A',
    });
  });

  it('puts the members of a group inside it, with group and display label', () => {
    const elements = buildGraph({ Sales: ['r1'] }, []);
    expect(byId(elements, 'r1').data).toMatchObject({
      class: 'report',
      rawLabel: 'r1',
      displayLabel: 'r1 (Sales)',
      group: 'Sales',
      parent: 'sales',
    });
  });

  it('creates reports that only appear in connections, without a group', () => {
    const elements = buildGraph({}, [['a', 'b']]);
    const a = byId(elements, 'a').data;
    expect(a).toMatchObject({ class: 'report', displayLabel: 'a', group: null });
    expect(a.parent).toBeUndefined();
  });

  it('creates reports listed only in extraIds (e.g. the layout)', () => {
    const elements = buildGraph({}, [], ['ralone']);
    expect(byId(elements, 'ralone').data.class).toBe('report');
  });

  it('creates one copy per group for a report in several groups', () => {
    const elements = buildGraph({ A: ['x'], B: ['x'] }, [['x', 'y']]);
    expect(byId(elements, 'x').data.group).toBe('A');
    expect(byId(elements, 'x(1)').data).toMatchObject({ rawLabel: 'x', group: 'B' });
    // Edges connect to the first copy
    expect(edgesOf(elements)[0]?.data).toMatchObject({ source: 'x', target: 'y' });
  });

  it('avoids a group id that clashes with a report id', () => {
    const elements = buildGraph({ sales: ['sales'] }, []);
    expect(byId(elements, 'sales').data.class).toBe('report');
    expect(byId(elements, 'sales_2').data.class).toBe('group');
  });

  it('creates each report once', () => {
    const elements = buildGraph(
      { A: ['a'] },
      [
        ['a', 'b'],
        ['b', 'a'],
        ['a', 'c'],
      ],
      ['a', 'c']
    );
    const reportIds = nodesOf(elements)
      .filter((e) => e.data.class === 'report')
      .map((e) => e.data.id);
    expect(reportIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('merges [a,b] and [b,a] into one two-way edge', () => {
    const edges = edgesOf(
      buildGraph({}, [
        ['a', 'b'],
        ['b', 'a'],
      ])
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]?.classes).toBe('bidirectional');
  });

  it('keeps a one-way edge without the two-way class', () => {
    const edges = edgesOf(buildGraph({}, [['a', 'b']]));
    expect(edges[0]?.classes).toBeUndefined();
  });

  it('skips an edge listed twice', () => {
    expect(
      edgesOf(
        buildGraph({}, [
          ['a', 'b'],
          ['a', 'b'],
        ])
      )
    ).toHaveLength(1);
  });

  it('keeps a self connection', () => {
    const edges = edgesOf(buildGraph({}, [['a', 'a']]));
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data).toMatchObject({ source: 'a', target: 'a' });
  });

  it('gives edges ids that do not clash with report names', () => {
    const elements = buildGraph({}, [['e1', 'b']]);
    const elementIds = elements.map((e) => e.data.id);
    expect(new Set(elementIds).size).toBe(elementIds.length);
  });
});

describe('placeGraph', () => {
  const elements = graphOf({ Sales: ['r1', 'r2'], Finance: ['r3'] }, [['r1', 'r3']]);
  const centers = layoutPositions(layoutFromGroups(elements), new Set(['r1', 'r2', 'r3']), {
    offsetX: 200,
    offsetY: 100,
  });
  const place = (showGroups = true, showGroupInLabel = true, fontDelta = 0) =>
    placeGraph(elements, centers, { showGroups, showGroupInLabel, fontDelta });

  it('centers every report box on its layout position', () => {
    for (const report of place().reports) {
      const center = centers.get(report.id);
      expect(report.rect.x + report.rect.width / 2).toBeCloseTo(center?.x ?? NaN);
      expect(report.rect.y + report.rect.height / 2).toBeCloseTo(center?.y ?? NaN);
    }
  });

  it('draws a group box around its reports, with room for the name', () => {
    const placed = place();
    const sales = placed.groups.find((g) => g.label === 'Sales');
    const members = placed.reports.filter((r) => r.parent === sales?.id);
    expect(members.map((m) => m.id)).toEqual(['r1', 'r2']);
    for (const m of members) {
      expect(m.rect.x).toBeGreaterThan(sales?.rect.x ?? Infinity);
      expect(m.rect.x + m.rect.width).toBeLessThan((sales?.rect.x ?? 0) + (sales?.rect.width ?? 0));
      expect(m.rect.y).toBeGreaterThan((sales?.rect.y ?? Infinity) + 14);
      expect(m.rect.y + m.rect.height).toBeLessThan((sales?.rect.y ?? 0) + (sales?.rect.height ?? 0));
    }
  });

  it('drops the groups, and the reports are inside nothing, when groups are hidden', () => {
    const placed = place(false);
    expect(placed.groups).toEqual([]);
    expect(placed.reports.every((r) => r.parent === undefined)).toBe(true);
  });

  it('labels reports with the group when asked, with the name only otherwise', () => {
    expect(place(true, true).reports.find((r) => r.id === 'r1')?.label).toBe('r1 (Sales)');
    expect(place(true, false).reports.find((r) => r.id === 'r1')?.label).toBe('r1');
  });

  it('makes boxes bigger with the graph text size', () => {
    const small = place(true, true, 0).reports[0];
    const large = place(true, true, 8).reports[0];
    expect(large?.rect.width).toBeGreaterThan(small?.rect.width ?? Infinity);
    expect(large?.rect.height).toBeGreaterThan(small?.rect.height ?? Infinity);
  });

  it('leaves out a report that has no layout position', () => {
    const placed = placeGraph(elements, new Map(), {
      showGroups: true,
      showGroupInLabel: true,
      fontDelta: 0,
    });
    expect(placed.reports).toEqual([]);
    expect(placed.groups).toEqual([]);
  });
});

describe('getNodeInfo with allLevels', () => {
  // a -> b -> c -> d, and e -> b
  const elements = graphOf({}, [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'd'],
    ['e', 'b'],
  ]);

  it('lists only the direct neighbours by default', () => {
    const info = getNodeInfo(elements, 'c');
    expect(ids(info.parents)).toEqual(['b']);
    expect(ids(info.children)).toEqual(['d']);
  });

  it('lists every ancestor and descendant, without the node itself', () => {
    const info = getNodeInfo(elements, 'c', true);
    expect(ids(info.parents)).toEqual(['a', 'b', 'e']);
    expect(ids(info.children)).toEqual(['d']);
  });
});

describe('getNodeInfo', () => {
  const elements = graphOf({ Sales: ['a', 'b'] }, [
    ['p1', 'a'],
    ['P2', 'a'],
    ['a', 'c'],
    ['a', 'b'],
    ['b', 'a'],
    ['a', 'a'],
  ]);
  const info = getNodeInfo(elements, 'a');

  it('describes the node itself', () => {
    expect(info).toMatchObject({ id: 'a', name: 'a', group: 'Sales' });
  });

  it('lists parents (incoming) and children (outgoing), sorted', () => {
    expect(names(info.parents)).toEqual(['a', 'b', 'p1', 'P2']);
    expect(names(info.children)).toEqual(['a', 'b', 'c']);
  });

  it('lists a two-way neighbour as both parent and child', () => {
    expect(names(info.parents)).toContain('b');
    expect(names(info.children)).toContain('b');
  });

  it('includes each neighbour group', () => {
    expect(info.children.find((x) => x.name === 'b')?.group).toBe('Sales');
    expect(info.children.find((x) => x.name === 'c')?.group).toBeNull();
  });

  it('returns empty lists for an unconnected node', () => {
    const lonely = getNodeInfo(graphOf({}, [], ['ralone']), 'ralone');
    expect(lonely).toMatchObject({ name: 'ralone', group: null, parents: [], children: [] });
  });
});

describe('formatNodeInfo (clipboard text)', () => {
  it('copies the same information as the side panel', () => {
    const elements = graphOf({ Sales: ['r1', 'r2'] }, [
      ['p', 'r1'],
      ['r1', 'r2'],
      ['r1', 'c'],
    ]);
    expect(formatNodeInfo(getNodeInfo(elements, 'r1'))).toBe(
      [
        'Node: r1',
        'Group: Sales',
        '',
        'Parent Nodes (1):',
        'p',
        '',
        'Child Nodes (2):',
        'c',
        'r2 (Sales)',
      ].join('\n')
    );
  });

  it('leaves out the group and empty lists, like the side panel', () => {
    const elements = graphOf({}, [['a', 'b']], ['ralone']);
    expect(formatNodeInfo(getNodeInfo(elements, 'ralone'))).toBe('Node: ralone');
    expect(formatNodeInfo(getNodeInfo(elements, 'b'))).toBe('Node: b\n\nParent Nodes (1):\na');
  });
});

describe('layoutPositions', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('places nodes on a grid using the offsets (center of each box)', () => {
    const positions = layoutPositions([['a', 'b'], ['c']], new Set(['a', 'b', 'c']), {
      offsetX: 100,
      offsetY: 50,
    });
    expect(positions.get('a')).toEqual({ x: 100, y: 50 });
    expect(positions.get('b')).toEqual({ x: 200, y: 50 });
    expect(positions.get('c')).toEqual({ x: 100, y: 100 });
  });

  it('honours startX, startY and base', () => {
    const positions = layoutPositions([['a']], new Set(['a']), {
      startX: 10,
      startY: 20,
      offsetX: 100,
      offsetY: 100,
      base: 0,
    });
    expect(positions.get('a')).toEqual({ x: 10, y: 20 });
  });

  it('places a group copy "x(1)" in its layout cell', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const positions = layoutPositions(uniquifyLayout([['x', 'x']]), new Set(['x', 'x(1)']), {
      offsetX: 100,
      offsetY: 100,
    });
    expect(positions.get('x(1)')).toEqual({ x: 200, y: 100 });
    expect(warn).toHaveBeenCalledWith('layout: duplicate id "x" — renamed to "x(1)"');
  });

  it('warns about and skips unknown ids', () => {
    const positions = layoutPositions([['missing', 'a']], new Set(['a']), { offsetX: 100, offsetY: 100 });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"missing" not found'));
    expect(positions.get('a')).toEqual({ x: 200, y: 100 });
    expect(positions.has('missing')).toBe(false);
  });

  it('uses the original report for a copy name that is not in the graph', () => {
    const positions = layoutPositions([['a(1)']], new Set(['a']), { offsetX: 100, offsetY: 100 });
    expect(positions.get('a')).toEqual({ x: 100, y: 100 });
  });

  it('keeps the first position of a report listed twice', () => {
    const positions = layoutPositions([['a', 'a']], new Set(['a']), { offsetX: 100, offsetY: 100 });
    expect(positions.get('a')).toEqual({ x: 100, y: 100 });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('duplicate layout entry'));
  });
});

describe('layoutFromGroups (no layout given)', () => {
  it('gives each group its own rows, then the reports in no group', () => {
    const elements = buildGraph({ Sales: ['a', 'b'], Finance: ['c'] }, [['c', 'loose']]);
    expect(layoutFromGroups(elements)).toEqual([['a', 'b'], ['c'], ['loose']]);
  });

  it('wraps a group over several rows', () => {
    const elements = buildGraph({ A: ['a', 'b', 'c', 'd', 'e'], B: ['f'] });
    expect(layoutFromGroups(elements, 2)).toEqual([['a', 'b'], ['c', 'd'], ['e'], ['f']]);
  });

  it('places the copy of a report in each of its groups', () => {
    const elements = buildGraph({ A: ['x', 'y'], B: ['x'] });
    expect(layoutFromGroups(elements)).toEqual([['x', 'y'], ['x(1)']]);
  });

  it('places every report without overlaps', () => {
    const elements = buildGraph({ A: ['a', 'b', 'c'], B: ['a', 'd'] }, [['d', 'e']]);
    const reports = new Set(elements.filter((e) => e.data.class === 'report').map((e) => e.data.id));
    const positions = layoutPositions(layoutFromGroups(elements, 2), reports);
    const spots = [...positions.values()].map((p) => `${p.x},${p.y}`);
    expect(spots).toHaveLength(6);
    expect(new Set(spots).size).toBe(6);
  });
});

describe('getHiddenIds (unchecked in Node to Display)', () => {
  it('hides nothing when every report is checked', () => {
    expect([...getHiddenIds(graphOf({ A: ['a', 'b'] }, [['a', 'b']]), new Set())]).toEqual([]);
  });

  it('hides the unchecked reports', () => {
    const elements = graphOf({ A: ['a', 'b'] }, [['a', 'b']]);
    expect([...getHiddenIds(elements, new Set(['a']))]).toEqual(['a']);
  });

  it('hides a group once all its reports are unchecked', () => {
    const elements = graphOf({ A: ['a', 'b'], B: ['c'] });
    const groupA = elements.find((e) => e.data.label === 'A')?.data.id ?? '';
    expect([...getHiddenIds(elements, new Set(['a']))].sort()).toEqual(['a']);
    expect([...getHiddenIds(elements, new Set(['a', 'b']))].sort()).toEqual(['a', 'b', groupA].sort());
  });

  it('only hides reports, never a group by its own id', () => {
    const elements = graphOf({ A: ['a'] });
    const groupA = elements.find((e) => e.data.label === 'A')?.data.id ?? '';
    expect(getHiddenIds(elements, new Set([groupA])).size).toBe(0);
  });
});

describe('getChain', () => {
  // a -> b -> c -> d, x -> c, and a two-way arrow c <-> y
  const EDGES: Connections = [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'd'],
    ['x', 'c'],
    ['c', 'y'],
    ['y', 'c'],
  ];
  const elements = graphOf({}, EDGES);
  const arrowIds = (chain: { edges: Set<string> }): string[] =>
    [...chain.edges]
      .map((id) => `${byId(elements, id).data.source}>${byId(elements, id).data.target}`)
      .sort();

  it('collects every parent up the chain, with their arrows', () => {
    const chain = getChain(elements, 'c', 'parents');
    expect([...chain.nodes].sort()).toEqual(['a', 'b', 'c', 'x', 'y']);
    expect(arrowIds(chain)).toEqual(['a>b', 'b>c', 'c>y', 'x>c']); // c<->y is one two-way arrow
  });

  it('collects every child down the chain', () => {
    const chain = getChain(elements, 'b', 'children');
    expect([...chain.nodes].sort()).toEqual(['b', 'c', 'd', 'y']);
  });

  it('returns only the node itself when it has no parents', () => {
    const chain = getChain(elements, 'a', 'parents');
    expect([...chain.nodes]).toEqual(['a']);
    expect(chain.edges.size).toBe(0);
  });

  it('stops on cycles', () => {
    const cycle = graphOf({}, [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
    ]);
    expect([...getChain(cycle, 'a', 'parents').nodes].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('colors', () => {
  it('lightTint mixes a color with white', () => {
    expect(lightTint('#000000', 0.5)).toBe('#808080');
    expect(lightTint('#ffffff')).toBe('#ffffff');
    expect(lightTint('rgb(239, 108, 0)')).toBe(lightTint('#ef6c00'));
    expect(lightTint('red')).toBe('#ffffff'); // other formats fall back to white
  });

  it('draws reports with the graph blue by default, and the track colors on a chain', () => {
    expect(reportAppearance([], COLORS)).toMatchObject({
      color: '#0066cc',
      width: 2,
      fill: '#fff',
      opacity: 1,
    });
    expect(reportAppearance(['track-parents'], COLORS)).toMatchObject({ color: '#2e7d32', width: 3 });
    expect(reportAppearance(['track2-children'], COLORS)).toMatchObject({ color: '#8b4513', width: 3 });
  });

  it('fills the tracked report with a light tint of the track color', () => {
    expect(reportAppearance(['track-children', 'track-root'], COLORS)).toMatchObject({
      color: '#7b1fa2',
      width: 5,
      fill: lightTint('#7b1fa2'),
    });
  });

  it('draws reports on both chains in the common color', () => {
    expect(reportAppearance(['track-parents', 'track2-children', 'track-mixed'], COLORS)).toMatchObject({
      color: DEFAULT_TRACK_COMMON_COLOR,
      width: 4,
    });
    expect(
      reportAppearance(['track-parents', 'track-root', 'track2-children', 'track-mixed'], COLORS)
    ).toMatchObject({ width: 6, fill: lightTint(DEFAULT_TRACK_COMMON_COLOR) });
  });

  it('dims what is off every chain', () => {
    expect(reportAppearance(['faded'], COLORS).opacity).toBe(0.15);
    expect(edgeAppearance(['faded'], COLORS).opacity).toBe(0.15);
  });

  it('draws arrows in the track colors, and in the common color on both chains', () => {
    expect(edgeAppearance([], COLORS)).toMatchObject({ color: '#0066cc', width: 2 });
    expect(edgeAppearance(['track-parents'], COLORS)).toMatchObject({ color: '#2e7d32', width: 4 });
    expect(edgeAppearance(['track-parents', 'track-mixed'], COLORS)).toMatchObject({
      color: DEFAULT_TRACK_COMMON_COLOR,
      width: 5,
    });
  });
});

describe('applyTracking (Show Dependency 1 and 2)', () => {
  // a -> b -> c, and d -> b
  const elements = graphOf({}, [
    ['a', 'b'],
    ['b', 'c'],
    ['d', 'b'],
  ]);
  const edgeId = (source: string, target: string): string =>
    edgesOf(elements).find((e) => e.data.source === source && e.data.target === target)?.data.id ?? '';
  const classesOf = (classes: Map<string, string[]>, id: string): string[] => classes.get(id) ?? [];

  it('highlights one track and dims the rest', () => {
    const classes = applyTracking(elements, [
      { id: 'c', direction: 'parents' },
      { id: '', direction: 'parents' },
    ]);
    expect(classesOf(classes, 'c')).toEqual(expect.arrayContaining(['track-parents', 'track-root']));
    expect(classesOf(classes, 'a')).toEqual(['track-parents']);
    expect(classesOf(classes, edgeId('a', 'b'))).toEqual(['track-parents']);
  });

  it('dims the reports and arrows off every chain', () => {
    const classes = applyTracking(elements, [
      { id: 'a', direction: 'children' },
      { id: '', direction: 'parents' },
    ]);
    expect(classesOf(classes, 'd')).toEqual(['faded']);
    expect(classesOf(classes, edgeId('d', 'b'))).toEqual(['faded']);
  });

  it('never dims a group', () => {
    const grouped = graphOf({ G: ['a', 'd'] }, [
      ['a', 'b'],
      ['d', 'b'],
    ]);
    const group = grouped.find((e) => e.data.label === 'G')?.data.id ?? '';
    const classes = applyTracking(grouped, [
      { id: 'b', direction: 'children' },
      { id: '', direction: 'parents' },
    ]);
    expect(classes.has(group)).toBe(false);
    expect(classes.get('a')).toEqual(['faded']);
  });

  it('uses track 2 classes for the second track', () => {
    const classes = applyTracking(elements, [
      { id: '', direction: 'parents' },
      { id: 'a', direction: 'children' },
    ]);
    expect(classesOf(classes, 'a')).toEqual(expect.arrayContaining(['track2-children', 'track2-root']));
    expect(classesOf(classes, 'c')).toContain('track2-children');
    expect(classesOf(classes, 'd')).toEqual(['faded']);
  });

  it('marks the elements both tracks share', () => {
    // Track 1: parents of c = a, b, c, d. Track 2: children of a = a, b, c
    const classes = applyTracking(elements, [
      { id: 'c', direction: 'parents' },
      { id: 'a', direction: 'children' },
    ]);
    const mixed = [...classes.entries()]
      .filter(([, classNames]) => classNames.includes('track-mixed'))
      .map(([id]) => id)
      .filter((id) => !edgesOf(elements).some((e) => e.data.id === id))
      .sort();
    expect(mixed).toEqual(['a', 'b', 'c']);
    expect(classesOf(classes, edgeId('a', 'b'))).toContain('track-mixed');
    expect(classesOf(classes, edgeId('d', 'b'))).not.toContain('track-mixed');
    expect(classesOf(classes, 'd')).not.toContain('track-mixed');
  });

  it('clears everything when both tracks are off, or point at nothing', () => {
    expect(
      applyTracking(elements, [
        { id: '', direction: 'parents' },
        { id: '', direction: 'parents' },
      ]).size
    ).toBe(0);
    expect(
      applyTracking(elements, [
        { id: 'missing', direction: 'parents' },
        { id: '', direction: 'parents' },
      ]).size
    ).toBe(0);
  });
});

describe('arrow geometry', () => {
  const left: Rect = { x: 0, y: 0, width: 100, height: 40 };
  const right: Rect = { x: 300, y: 0, width: 100, height: 40 };

  it('runs from the border of one box to the border of the other', () => {
    expect(edgeSegment(left, right)).toEqual({ x1: 100, y1: 20, x2: 300, y2: 20 });
    expect(edgeSegment(right, left)).toEqual({ x1: 300, y1: 20, x2: 100, y2: 20 });
  });

  it('leaves a box through the side the other box is on, on a slanted line', () => {
    const below: Rect = { x: 0, y: 300, width: 100, height: 40 };
    const { x1, y1, x2, y2 } = edgeSegment(left, below);
    expect(y1).toBe(40);
    expect(x1).toBe(50);
    expect(y2).toBe(300);
    expect(x2).toBe(50);
  });

  it('draws the loop of a self arrow above the box, ending on its top edge', () => {
    const loop = loopPath(left);
    expect(loop.tip.y).toBe(left.y);
    expect(loop.tip.x).toBeGreaterThan(left.x);
    expect(loop.tip.x).toBeLessThan(left.x + left.width);
    expect(loop.d.startsWith('M ')).toBe(true);
    // the loop comes down into the box
    expect(Math.sin(loop.angle)).toBeGreaterThan(0);
  });

  it('draws an arrowhead with its tip at the given point', () => {
    expect(arrowPath(10, 20, 0).startsWith('M 10.00 20.00 L')).toBe(true);
  });
});

describe('moving boxes', () => {
  it('keeps the layout centers, with the moved reports where they were dropped', () => {
    const layoutCenters = new Map([
      ['a', { x: 100, y: 100 }],
      ['b', { x: 300, y: 100 }],
    ]);
    const merged = mergeCenters(layoutCenters, { b: { x: 350, y: 220 } });
    expect(merged.get('a')).toEqual({ x: 100, y: 100 });
    expect(merged.get('b')).toEqual({ x: 350, y: 220 });
    expect(layoutCenters.get('b')).toEqual({ x: 300, y: 100 });
  });

  it('ignores a moved id that is not in the layout', () => {
    const merged = mergeCenters(new Map([['a', { x: 1, y: 2 }]]), { ghost: { x: 9, y: 9 } });
    expect([...merged.keys()]).toEqual(['a']);
  });

  it('turns the drop position (top left corner) into the center of the box', () => {
    expect(centerAfterDrag({ x: 10, y: 20 }, { width: 100, height: 40 })).toEqual({ x: 60, y: 40 });
  });

  it('adds the corner of the group when the drop position is relative to it', () => {
    expect(centerAfterDrag({ x: 10, y: 20 }, { width: 100, height: 40 }, { x: 500, y: 300 })).toEqual({
      x: 560,
      y: 340,
    });
  });

  it('draws the group box around the reports wherever they are moved', () => {
    const elements = graphOf({ G: ['a', 'b'] });
    const moved = mergeCenters(
      new Map([
        ['a', { x: 100, y: 100 }],
        ['b', { x: 300, y: 100 }],
      ]),
      { b: { x: 300, y: 400 } }
    );
    const placed = placeGraph(elements, moved, { showGroups: true, showGroupInLabel: false, fontDelta: 0 });
    const group = placed.groups[0]?.rect;
    const b = placed.reports.find((r) => r.id === 'b')?.rect;
    expect((group?.y ?? 0) + (group?.height ?? 0)).toBeGreaterThan((b?.y ?? Infinity) + (b?.height ?? 0));
  });
});
