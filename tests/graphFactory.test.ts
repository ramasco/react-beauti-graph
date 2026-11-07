import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import cytoscape from 'cytoscape';
import type { ElementDefinition, StylesheetJson } from 'cytoscape';
import type { Connections, GraphElement, NodeGroups, NodeRef } from '../src/graphFactory';
import {
  REPORT_NODE,
  applyLayout,
  buildGraph,
  compareNames,
  getNodeSize,
  formatNodeInfo,
  getNodeInfo,
  getHiddenElements,
  getTrackedElements,
  lightTint,
  makeStyles,
  DEFAULT_TRACK_COMMON_COLOR,
  applyTracking,
  getVisibleElements,
  layoutFromFolders,
  uniqueId,
  uniquifyLayout,
} from '../src/graphFactory';

/** Headless Cytoscape instance built the same way the component builds it */
function makeCy(
  node_groups: NodeGroups,
  direct_node_connections: Connections,
  extraIds: string[] = [],
  { showFolders = true, showGroupInLabel = true } = {}
): cytoscape.Core {
  const elements = getVisibleElements(
    buildGraph(node_groups, direct_node_connections, extraIds),
    showFolders,
    showGroupInLabel
  );
  return cytoscape({
    headless: true,
    styleEnabled: true,
    elements: elements as ElementDefinition[],
    style: makeStyles(),
  });
}

const nodesOf = (elements: GraphElement[]): GraphElement[] => elements.filter((e) => !e.data.source);
const edgesOf = (elements: GraphElement[]): GraphElement[] => elements.filter((e) => e.data.source);
const byId = (elements: GraphElement[], id: string): GraphElement => {
  const found = elements.find((e) => e.data.id === id);
  if (!found) {
    throw new Error(`no element "${id}"`);
  }
  return found;
};

/** The style block of one selector in a stylesheet */
const styleOf = (styles: StylesheetJson, selector: string): Record<string, unknown> => {
  const block = styles.find((s) => s.selector === selector) as unknown as
    { style: Record<string, unknown> } | undefined;
  if (!block) {
    throw new Error(`no style for "${selector}"`);
  }
  return block.style;
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
    const names = ['beta', 'Alpha', 'n10', 'N2', 'zeta', 'Zebra'];
    expect(names.sort(compareNames)).toEqual(['Alpha', 'beta', 'N2', 'n10', 'Zebra', 'zeta']);
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
  it('creates a compartment per folder with a camelCase id', () => {
    const elements = buildGraph({ 'Folder A': ['a'] }, []);
    expect(byId(elements, 'folderA').data).toEqual({
      id: 'folderA',
      class: 'compartment',
      label: 'Folder A',
    });
  });

  it('puts folder members inside their folder with group and display label', () => {
    const elements = buildGraph({ Sales: ['r1'] }, []);
    expect(byId(elements, 'r1').data).toMatchObject({
      class: 'macromolecule',
      rawLabel: 'r1',
      displayLabel: 'r1 (Sales)',
      group: 'Sales',
      parent: 'sales',
    });
  });

  it('creates reports that only appear in connections, without a group', () => {
    const elements = buildGraph({}, [['a', 'b']]);
    const a = byId(elements, 'a').data;
    expect(a).toMatchObject({ class: 'macromolecule', displayLabel: 'a', group: null });
    expect(a.parent).toBeUndefined();
  });

  it('creates reports listed only in extraIds (e.g. the layout)', () => {
    const elements = buildGraph({}, [], ['ralone']);
    expect(byId(elements, 'ralone').data.class).toBe('macromolecule');
  });

  it('creates one copy per folder for a report in several folders', () => {
    const elements = buildGraph({ A: ['x'], B: ['x'] }, [['x', 'y']]);
    expect(byId(elements, 'x').data.group).toBe('A');
    expect(byId(elements, 'x(1)').data).toMatchObject({ rawLabel: 'x', group: 'B' });
    // Edges connect to the first copy
    expect(edgesOf(elements)[0]?.data).toMatchObject({ source: 'x', target: 'y' });
  });

  it('avoids a folder id that clashes with a report id', () => {
    const elements = buildGraph({ sales: ['sales'] }, []);
    expect(byId(elements, 'sales').data.class).toBe('macromolecule');
    expect(byId(elements, 'sales_2').data.class).toBe('compartment');
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
      .filter((e) => e.data.class === 'macromolecule')
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
    const ids = elements.map((e) => e.data.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getVisibleElements', () => {
  const all = buildGraph({ Sales: ['r1'] }, [['r1', 'r2']]);

  it('keeps folders when shown', () => {
    expect(getVisibleElements(all, true, true).some((e) => e.data.id === 'sales')).toBe(true);
  });

  it('drops folders when hidden', () => {
    expect(getVisibleElements(all, false, true).some((e) => e.data.id === 'sales')).toBe(false);
  });

  it('labels reports with the group when asked', () => {
    expect(byId(getVisibleElements(all, true, true), 'r1').data.graphLabel).toBe('r1 (Sales)');
  });

  it('labels reports with the name only otherwise', () => {
    expect(byId(getVisibleElements(all, true, false), 'r1').data.graphLabel).toBe('r1');
  });

  it('returns copies, leaving the original elements untouched', () => {
    const visible = getVisibleElements(all, true, true);
    visible.forEach((e) => (e.data.id = 'changed'));
    expect(all.some((e) => e.data.id === 'changed')).toBe(false);
  });
});

describe('REPORT_NODE selector', () => {
  // Regression: a ".macromolecule" class selector matched nothing, which emptied
  // the search list and disabled double/right click
  it('matches every report and no folder', () => {
    const cy = makeCy({ Sales: ['r1', 'r2'] }, [['r1', 'r3']], ['ralone']);
    expect(
      cy
        .nodes(REPORT_NODE)
        .map((n) => n.id())
        .sort()
    ).toEqual(['r1', 'r2', 'r3', 'ralone']);
  });

  it('receives double click and right click events on reports', () => {
    const cy = makeCy({ Sales: ['r1'] }, [['r1', 'r2']]);
    const dbl = vi.fn();
    const ctx = vi.fn();
    cy.on('dbltap', REPORT_NODE, dbl);
    cy.on('cxttap', REPORT_NODE, ctx);

    cy.getElementById('r1').emit('dbltap');
    cy.getElementById('r1').emit('cxttap');
    cy.getElementById('sales').emit('dbltap');

    expect(dbl).toHaveBeenCalledTimes(1);
    expect(ctx).toHaveBeenCalledTimes(1);
  });
});

describe('getNodeInfo with allLevels', () => {
  // a -> b -> c -> d, and e -> b
  const cy = makeCy({}, [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'd'],
    ['e', 'b'],
  ]);
  const ids = (list: NodeRef[]): string[] => list.map((x) => x.id);

  it('lists only the direct neighbours by default', () => {
    const info = getNodeInfo(cy.getElementById('c'));
    expect(ids(info.parents)).toEqual(['b']);
    expect(ids(info.children)).toEqual(['d']);
  });

  it('lists every ancestor and descendant, without the node itself', () => {
    const info = getNodeInfo(cy.getElementById('c'), true);
    expect(ids(info.parents)).toEqual(['a', 'b', 'e']);
    expect(ids(info.children)).toEqual(['d']);
  });
});

describe('getNodeInfo', () => {
  const cy = makeCy({ Sales: ['a', 'b'] }, [
    ['p1', 'a'],
    ['P2', 'a'],
    ['a', 'c'],
    ['a', 'b'],
    ['b', 'a'],
    ['a', 'a'],
  ]);
  const info = getNodeInfo(cy.getElementById('a'));
  const names = (list: NodeRef[]): string[] => list.map((x) => x.name);

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
    const lonely = getNodeInfo(makeCy({}, [], ['ralone']).getElementById('ralone'));
    expect(lonely).toMatchObject({ name: 'ralone', group: null, parents: [], children: [] });
  });
});

describe('formatNodeInfo (clipboard text)', () => {
  it('copies the same information as the side panel', () => {
    const cy = makeCy({ Sales: ['r1', 'r2'] }, [
      ['p', 'r1'],
      ['r1', 'r2'],
      ['r1', 'c'],
    ]);
    expect(formatNodeInfo(getNodeInfo(cy.getElementById('r1')))).toBe(
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
    const cy = makeCy({}, [['a', 'b']], ['ralone']);
    expect(formatNodeInfo(getNodeInfo(cy.getElementById('ralone')))).toBe('Node: ralone');
    expect(formatNodeInfo(getNodeInfo(cy.getElementById('b')))).toBe('Node: b\n\nParent Nodes (1):\na');
  });
});

describe('applyLayout', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('places nodes on a grid using the offsets', () => {
    const cy = makeCy({}, [['a', 'b']], ['c']);
    applyLayout(cy, [['a', 'b'], ['c']], { offsetX: 100, offsetY: 50 });
    expect(cy.getElementById('a').position()).toEqual({ x: 100, y: 50 });
    expect(cy.getElementById('b').position()).toEqual({ x: 200, y: 50 });
    expect(cy.getElementById('c').position()).toEqual({ x: 100, y: 100 });
  });

  it('honours startX, startY and base', () => {
    const cy = makeCy({}, [], ['a']);
    applyLayout(cy, [['a']], { startX: 10, startY: 20, offsetX: 100, offsetY: 100, base: 0 });
    expect(cy.getElementById('a').position()).toEqual({ x: 10, y: 20 });
  });

  it('places a folder copy "x(1)" in its layout cell', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cy = makeCy({ A: ['x'], B: ['x'] }, []);
    applyLayout(cy, uniquifyLayout([['x', 'x']]), { offsetX: 100, offsetY: 100 });
    expect(cy.getElementById('x(1)').position()).toEqual({ x: 200, y: 100 });
    expect(warn).toHaveBeenCalledWith('layout: duplicate id "x" — renamed to "x(1)"');
  });

  it('warns about and skips unknown ids', () => {
    const cy = makeCy({}, [], ['a']);
    applyLayout(cy, [['missing', 'a']], { offsetX: 100, offsetY: 100 });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"missing" not found'));
    expect(cy.getElementById('a').position()).toEqual({ x: 200, y: 100 });
  });
});

describe('layoutFromFolders (no layout given)', () => {
  it('gives each folder its own rows, then the reports in no folder', () => {
    const elements = buildGraph({ Sales: ['a', 'b'], Finance: ['c'] }, [['c', 'loose']]);
    expect(layoutFromFolders(elements)).toEqual([['a', 'b'], ['c'], ['loose']]);
  });

  it('wraps a folder over several rows', () => {
    const elements = buildGraph({ A: ['a', 'b', 'c', 'd', 'e'], B: ['f'] });
    expect(layoutFromFolders(elements, 2)).toEqual([['a', 'b'], ['c', 'd'], ['e'], ['f']]);
  });

  it('places the copy of a report in each of its folders', () => {
    const elements = buildGraph({ A: ['x', 'y'], B: ['x'] });
    expect(layoutFromFolders(elements)).toEqual([['x', 'y'], ['x(1)']]);
  });

  it('places every report without overlaps', () => {
    const cy = makeCy({ A: ['a', 'b', 'c'], B: ['a', 'd'] }, [['d', 'e']]);
    applyLayout(cy, layoutFromFolders(buildGraph({ A: ['a', 'b', 'c'], B: ['a', 'd'] }, [['d', 'e']]), 2));
    const spots = cy.nodes(REPORT_NODE).map((n) => `${n.position('x')},${n.position('y')}`);
    expect(spots).toHaveLength(6);
    expect(new Set(spots).size).toBe(6);
  });
});

describe('makeStyles (default stylesheet)', () => {
  const cy = makeCy({}, [
    ['a', 'b'],
    ['b', 'a'],
    ['a', 'c'],
    ['d', 'd'],
  ]);
  const edge = (s: string, t: string): cytoscape.EdgeCollection =>
    cy.edges().filter((e) => e.source().id() === s && e.target().id() === t);

  it('draws one arrow on one-way edges', () => {
    expect(edge('a', 'c').style('target-arrow-shape')).toBe('vee');
    expect(edge('a', 'c').style('source-arrow-shape')).toBe('none');
  });

  it('draws arrows at both ends of two-way edges', () => {
    expect(edge('a', 'b').style('target-arrow-shape')).toBe('vee');
    expect(edge('a', 'b').style('source-arrow-shape')).toBe('vee');
  });

  it('draws self loops above the box, large enough to be visible', () => {
    const loop = edge('d', 'd');
    expect(loop.style('loop-direction')).toBe('0deg');
    expect(loop.style('control-point-step-size')).toBe('70px');
  });
});

describe('getHiddenElements (unchecked in Node to Display)', () => {
  const ids = (eles: cytoscape.Collection): string[] => eles.map((e) => e.id()).sort();

  it('hides nothing when every report is checked', () => {
    const cy = makeCy({ A: ['a', 'b'] }, [['a', 'b']]);
    expect(getHiddenElements(cy, new Set()).length).toBe(0);
  });

  it('hides the unchecked reports, and Cytoscape then hides their edges', () => {
    const cy = makeCy({ A: ['a', 'b'] }, [['a', 'b']]);
    const hidden = getHiddenElements(cy, new Set(['a']));
    expect(ids(hidden)).toEqual(['a']);
    hidden.addClass('hidden');
    expect(cy.getElementById('a').visible()).toBe(false);
    expect(cy.getElementById('b').visible()).toBe(true);
    expect(cy.edges()[0]?.visible()).toBe(false);
  });

  it('hides a folder once all its reports are unchecked', () => {
    const cy = makeCy({ A: ['a', 'b'], B: ['c'] }, []);
    const folderA = cy
      .nodes(':parent')
      .filter((f) => f.data('label') === 'A')
      .id();
    expect(ids(getHiddenElements(cy, new Set(['a'])))).toEqual(['a']);
    expect(ids(getHiddenElements(cy, new Set(['a', 'b'])))).toEqual(['a', 'b', folderA].sort());
  });

  it('only hides reports, never a folder by its own id', () => {
    const cy = makeCy({ A: ['a'] }, []);
    const folderA = cy.nodes(':parent').first().id();
    expect(getHiddenElements(cy, new Set([folderA])).length).toBe(0);
  });
});

describe('getTrackedElements', () => {
  // a -> b -> c -> d, x -> c, and a two-way edge c <-> y
  const EDGES: Connections = [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'd'],
    ['x', 'c'],
    ['c', 'y'],
    ['y', 'c'],
  ];
  const ids = (coll: cytoscape.Collection, sel: string): string[] =>
    coll
      .filter(sel)
      .map((e) => e.id())
      .sort();

  it('collects every parent up the chain, with their edges', () => {
    const cy = makeCy({}, EDGES);
    const trail = getTrackedElements(cy.getElementById('c'), 'parents');
    expect(ids(trail, 'node')).toEqual(['a', 'b', 'c', 'x', 'y']);
    expect(trail.edges().length).toBe(4); // a-b, b-c, x-c, c<->y
  });

  it('collects every child down the chain', () => {
    const cy = makeCy({}, EDGES);
    const trail = getTrackedElements(cy.getElementById('b'), 'children');
    expect(ids(trail, 'node')).toEqual(['b', 'c', 'd', 'y']);
  });

  it('returns only the node itself when it has no parents', () => {
    const cy = makeCy({}, EDGES);
    const trail = getTrackedElements(cy.getElementById('a'), 'parents');
    expect(trail.map((e) => e.id())).toEqual(['a']);
  });

  it('stops on cycles', () => {
    const cy = makeCy({}, [
      ['p', 'q'],
      ['q', 'r'],
      ['r', 'p'],
    ]);
    const trail = getTrackedElements(cy.getElementById('p'), 'children');
    expect(ids(trail, 'node')).toEqual(['p', 'q', 'r']);
    expect(trail.edges().length).toBe(3);
  });
});

describe('track colors', () => {
  it('uses green for parents and purple for children by default', () => {
    const styles = makeStyles();
    expect(styleOf(styles, 'edge.track-parents')['line-color']).toBe('#2e7d32');
    expect(styleOf(styles, 'edge.track-children')['line-color']).toBe('#7b1fa2');
  });

  it('takes the colors as parameters', () => {
    const styles = makeStyles({ parentsColor: '#ff0000', childrenColor: '#0000ff' });
    expect(styleOf(styles, 'edge.track-parents')['line-color']).toBe('#ff0000');
    expect(styleOf(styles, 'node.track-children')['border-color']).toBe('#0000ff');
    expect(styleOf(styles, 'node.track-parents.track-root')['background-color']).toBe(lightTint('#ff0000'));
  });

  it('lightTint mixes a color with white', () => {
    expect(lightTint('#000000', 0.5)).toBe('#808080');
    expect(lightTint('#ffffff')).toBe('#ffffff');
    expect(lightTint('rgb(239, 108, 0)')).toBe(lightTint('#ef6c00'));
    expect(lightTint('red')).toBe('#ffffff'); // other formats fall back to white
  });

  it('has yellow/brown defaults for Track node 2, overridable', () => {
    expect(styleOf(makeStyles(), 'edge.track2-parents')['line-color']).toBe('#efeb00');
    expect(styleOf(makeStyles(), 'edge.track2-children')['line-color']).toBe('#8b4513');
    const styles = makeStyles({ track2ParentsColor: '#123456' });
    expect(styleOf(styles, 'node.track2-parents.track2-root')['background-color']).toBe(lightTint('#123456'));
  });

  it('applyTracking takes the common color as a parameter', () => {
    const cy = makeCy({}, [
      ['a', 'b'],
      ['b', 'c'],
    ]);
    applyTracking(
      cy,
      [
        { id: 'c', direction: 'parents' },
        { id: 'a', direction: 'children' },
      ],
      '#123456'
    );
    expect(cy.getElementById('b').data('trackMixColor')).toBe('#123456');
  });
});

describe('applyTracking (Track node 1 and 2)', () => {
  // a -> b -> c, and d -> b
  const setup = () =>
    makeCy({}, [
      ['a', 'b'],
      ['b', 'c'],
      ['d', 'b'],
    ]);
  const classesOf = (cy: cytoscape.Core, id: string): string[] => cy.getElementById(id).classes();

  it('highlights one track and dims the rest', () => {
    const cy = setup();
    applyTracking(cy, [
      { id: 'c', direction: 'parents' },
      { id: '', direction: 'parents' },
    ]);
    expect(classesOf(cy, 'c')).toEqual(expect.arrayContaining(['track-parents', 'track-root']));
    expect(cy.getElementById('a').hasClass('track-parents')).toBe(true);
    expect(cy.getElementById('d').hasClass('track-parents')).toBe(true);
    expect(cy.$('.faded').length).toBe(0); // every node is a parent of c
    expect(cy.$('.track-mixed').length).toBe(0);
  });

  it('uses track 2 classes for the second track', () => {
    const cy = setup();
    applyTracking(cy, [
      { id: '', direction: 'parents' },
      { id: 'a', direction: 'children' },
    ]);
    expect(classesOf(cy, 'a')).toEqual(expect.arrayContaining(['track2-children', 'track2-root']));
    expect(cy.getElementById('c').hasClass('track2-children')).toBe(true);
    expect(cy.getElementById('d').hasClass('faded')).toBe(true);
  });

  it('uses the common color on elements both tracks share', () => {
    const cy = setup();
    // Track 1: parents of c = a, b, c, d. Track 2: children of a = a, b, c
    applyTracking(cy, [
      { id: 'c', direction: 'parents' },
      { id: 'a', direction: 'children' },
    ]);
    const mixed = DEFAULT_TRACK_COMMON_COLOR;
    const shared = cy.$('.track-mixed');
    expect(
      shared
        .nodes()
        .map((n) => n.id())
        .sort()
    ).toEqual(['a', 'b', 'c']);
    expect(shared.edges().length).toBe(2); // a->b, b->c
    expect(cy.getElementById('b').data('trackMixColor')).toBe(mixed);
    expect(cy.getElementById('a').data('trackMixFill')).toBe(lightTint(mixed));
    expect(cy.getElementById('d').hasClass('track-mixed')).toBe(false);
    expect(cy.getElementById('d').hasClass('track-parents')).toBe(true);
  });

  it('clears everything when both tracks are off', () => {
    const cy = setup();
    applyTracking(cy, [
      { id: 'c', direction: 'parents' },
      { id: 'a', direction: 'children' },
    ]);
    applyTracking(cy, [
      { id: '', direction: 'parents' },
      { id: '', direction: 'parents' },
    ]);
    expect(cy.$('.faded, .track-mixed, .track-parents, .track2-children').length).toBe(0);
    expect(cy.getElementById('b').data('trackMixColor')).toBeUndefined();
  });
});

describe('selected node color', () => {
  const overlayOf = (styles: StylesheetJson): unknown => styleOf(styles, '.selected')['overlay-color'];

  it('is pink by default', () => {
    expect(overlayOf(makeStyles())).toBe('#e91e63');
  });

  it('takes the color as a parameter', () => {
    expect(overlayOf(makeStyles({ selectedColor: '#123456' }))).toBe('#123456');
  });
});
