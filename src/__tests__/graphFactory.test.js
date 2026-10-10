import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import cytoscape from 'cytoscape';
import {
  REPORT_NODE,
  STYLES,
  applyLayout,
  buildGraph,
  compareNames,
  formatNodeInfo,
  getNodeInfo,
  getNodeSize,
  getVisibleElements,
  uniqueId,
  uniquifyLayout,
} from '../graphFactory';

/** Headless Cytoscape instance built the same way the component builds it */
function makeCy(folders, nodes, extraIds = [], { showFolders = true, showGroupInLabel = true } = {}) {
  const elements = getVisibleElements(buildGraph(folders, nodes, extraIds), showFolders, showGroupInLabel);
  return cytoscape({ headless: true, styleEnabled: true, elements, style: STYLES });
}

const nodesOf = (elements) => elements.filter((e) => !e.data.source);
const edgesOf = (elements) => elements.filter((e) => e.data.source);
const byId = (elements, id) => elements.find((e) => e.data.id === id);

describe('getNodeSize', () => {
  it('uses the minimum width for short labels', () => {
    expect(getNodeSize('a')).toEqual({ width: 200, height: 60 });
  });

  it('grows with long labels', () => {
    const label = 'x'.repeat(40);
    expect(getNodeSize(label).width).toBe(40 * 9 + 20 * 2);
  });

  it('handles missing labels', () => {
    expect(getNodeSize(undefined)).toEqual({ width: 200, height: 60 });
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
    const taken = new Set();
    expect(uniqueId('e1', taken)).toBe('e1');
    expect(taken.has('e1')).toBe(true);
  });

  it('adds a counter when the base is taken', () => {
    const taken = new Set(['e1', 'e1_2']);
    expect(uniqueId('e1', taken)).toBe('e1_3');
  });
});

describe('uniquifyLayout', () => {
  beforeEach(() => vi.spyOn(console, 'info').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('keeps unique ids unchanged', () => {
    expect(uniquifyLayout([['a', 'b'], ['c']])).toEqual([['a', 'b'], ['c']]);
  });

  it('renames repeated ids with (n)', () => {
    expect(uniquifyLayout([['a', 'b'], ['a', 'a']])).toEqual([['a', 'b'], ['a(1)', 'a(2)']]);
  });

  it('handles an empty layout', () => {
    expect(uniquifyLayout()).toEqual([]);
  });
});

describe('buildGraph', () => {
  it('creates a compartment per folder with a camelCase id', () => {
    const elements = buildGraph({ 'Folder A': ['a'] }, []);
    expect(byId(elements, 'folderA').data).toEqual({ id: 'folderA', class: 'compartment', label: 'Folder A' });
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
    expect(edgesOf(elements)[0].data).toMatchObject({ source: 'x', target: 'y' });
  });

  it('avoids a folder id that clashes with a report id', () => {
    const elements = buildGraph({ sales: ['sales'] }, []);
    expect(byId(elements, 'sales').data.class).toBe('macromolecule');
    expect(byId(elements, 'sales_2').data.class).toBe('compartment');
  });

  it('creates each report once', () => {
    const elements = buildGraph({ A: ['a'] }, [['a', 'b'], ['b', 'a'], ['a', 'c']], ['a', 'c']);
    const reportIds = nodesOf(elements)
      .filter((e) => e.data.class === 'macromolecule')
      .map((e) => e.data.id);
    expect(reportIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('merges [a,b] and [b,a] into one two-way edge', () => {
    const edges = edgesOf(buildGraph({}, [['a', 'b'], ['b', 'a']]));
    expect(edges).toHaveLength(1);
    expect(edges[0].classes).toBe('bidirectional');
  });

  it('keeps a one-way edge without the two-way class', () => {
    const edges = edgesOf(buildGraph({}, [['a', 'b']]));
    expect(edges[0].classes).toBeUndefined();
  });

  it('skips an edge listed twice', () => {
    expect(edgesOf(buildGraph({}, [['a', 'b'], ['a', 'b']]))).toHaveLength(1);
  });

  it('keeps a self connection', () => {
    const edges = edgesOf(buildGraph({}, [['a', 'a']]));
    expect(edges).toHaveLength(1);
    expect(edges[0].data).toMatchObject({ source: 'a', target: 'a' });
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
    expect(byId(getVisibleElements(all, true, true), 'sales')).toBeDefined();
  });

  it('drops folders when hidden', () => {
    expect(byId(getVisibleElements(all, false, true), 'sales')).toBeUndefined();
  });

  it('labels reports with the group when asked', () => {
    expect(byId(getVisibleElements(all, true, true), 'r1').data.graphLabel).toBe('r1 (Sales)');
  });

  it('labels reports with the name only otherwise', () => {
    expect(byId(getVisibleElements(all, true, false), 'r1').data.graphLabel).toBe('r1');
  });

  it('sizes report boxes to their label', () => {
    const r1 = byId(getVisibleElements(all, true, true), 'r1').data;
    expect({ width: r1.nodeWidth, height: r1.nodeHeight }).toEqual(getNodeSize('r1 (Sales)'));
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
    expect(cy.nodes(REPORT_NODE).map((n) => n.id()).sort()).toEqual(['r1', 'r2', 'r3', 'ralone']);
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

describe('getNodeInfo', () => {
  const cy = makeCy(
    { Sales: ['a', 'b'] },
    [['p1', 'a'], ['P2', 'a'], ['a', 'c'], ['a', 'b'], ['b', 'a'], ['a', 'a']]
  );
  const info = getNodeInfo(cy.getElementById('a'));
  const names = (list) => list.map((x) => x.name);

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
    expect(info.children.find((x) => x.name === 'b').group).toBe('Sales');
    expect(info.children.find((x) => x.name === 'c').group).toBeNull();
  });

  it('returns empty lists for an unconnected node', () => {
    const lonely = getNodeInfo(makeCy({}, [], ['ralone']).getElementById('ralone'));
    expect(lonely).toMatchObject({ name: 'ralone', group: null, parents: [], children: [] });
  });
});

describe('formatNodeInfo (clipboard text)', () => {
  it('copies the same information as the side panel', () => {
    const cy = makeCy({ Sales: ['r1', 'r2'] }, [['p', 'r1'], ['r1', 'r2'], ['r1', 'c']]);
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
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
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
    const cy = makeCy({ A: ['x'], B: ['x'] }, []);
    applyLayout(cy, uniquifyLayout([['x', 'x']]), { offsetX: 100, offsetY: 100 });
    expect(cy.getElementById('x(1)').position()).toEqual({ x: 200, y: 100 });
  });

  it('warns about and skips unknown ids', () => {
    const cy = makeCy({}, [], ['a']);
    applyLayout(cy, [['missing', 'a']], { offsetX: 100, offsetY: 100 });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"missing" not found'));
    expect(cy.getElementById('a').position()).toEqual({ x: 200, y: 100 });
  });
});

describe('STYLES', () => {
  const cy = makeCy({}, [['a', 'b'], ['b', 'a'], ['a', 'c'], ['d', 'd']]);
  const edge = (s, t) => cy.edges().filter((e) => e.source().id() === s && e.target().id() === t);

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

  it('sizes report boxes from their data', () => {
    expect(cy.getElementById('a').style('width')).toBe(`${getNodeSize('a').width}px`);
  });
});
