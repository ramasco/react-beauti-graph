'use client';

/**
 * graphFactory.jsx
 * Factory for creating Cytoscape graph components: report nodes grouped in
 * folders, placed on a grid layout, with search, a details panel and a
 * "save to clipboard" context menu.
 */

import { useEffect, useId, useRef, useState } from 'react';
import cytoscape from 'cytoscape';

const BLUE = '#0066cc';
const NODE_MIN_WIDTH = 200;
const NODE_HEIGHT = 60;
const CHAR_WIDTH = 9;
const PADDING_X = 20;

// Report nodes are marked by data.class (not a Cytoscape class), so select them by data
export const REPORT_NODE = 'node[class = "macromolecule"]';

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
 * Builds the Cytoscape elements from folders, edges and extra node IDs.
 * Folders become compound nodes ("compartment"); every report becomes a
 * "macromolecule" node. A report listed in several folders gets one copy per
 * folder ("id", "id(1)", ...); edges connect to the first copy.
 * @param {Object<string, string[]>} folders - Mapping of folder names to child IDs
 * @param {Array<[string, string]>} nodes - Array of [source, target] edge pairs
 * @param {string[]} extraIds - Other node IDs to create even without edges (e.g. from the layout)
 * @returns {Object[]} Cytoscape elements array
 */
export function buildGraph(folders = {}, nodes = [], extraIds = []) {
  const elements = [];
  const takenIds = new Set();

  // IDs of reports that are not necessarily in a folder
  const looseIds = new Set([...nodes.flat(), ...extraIds]);
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
    elements.push({ data: { id: folderId, class: 'compartment', label: folderLabel } });

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
      class: 'macromolecule',
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

  nodes.forEach(([rawSource, rawTarget], index) => {
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
    .filter((elem) => showFolders || elem.data.class !== 'compartment')
    .map((elem) => {
      // Fresh copies each time, so one Cytoscape instance never shares objects with the next
      if (elem.data.class !== 'macromolecule') return { ...elem, data: { ...elem.data } };
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
 * Formats node details as plain text for the clipboard, matching the side panel:
 * the group and the parent/child lists appear only when not empty.
 * @param {ReturnType<typeof getNodeInfo>} info - Output of getNodeInfo
 * @returns {string} Text to copy
 */
export function formatNodeInfo(info) {
  const describe = (item) => (item.group ? `${item.name} (${item.group})` : item.name);
  const lines = [`Node: ${info.name}`];
  if (info.group) lines.push(`Group: ${info.group}`);
  for (const [title, list] of [
    ['Parent Nodes', info.parents],
    ['Child Nodes', info.children],
  ]) {
    if (list.length === 0) continue;
    lines.push('', `${title} (${list.length}):`, ...list.map(describe));
  }
  return lines.join('\n');
}

/** Cytoscape stylesheet; later rules override earlier ones */
export const STYLES = [
  {
    selector: 'node',
    style: {
      'background-color': '#fff',
      label: 'data(graphLabel)',
      shape: 'rectangle',
      color: BLUE,
      'border-width': 2,
      'border-color': BLUE,
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
      'background-color': '#f0f8ff',
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
      'overlay-color': '#e53935',
      'overlay-opacity': 0.35,
      'overlay-padding': 8,
    },
  },
  {
    selector: 'edge',
    style: {
      'line-color': BLUE,
      width: 2,
      'curve-style': 'bezier',
      'target-arrow-shape': 'vee',
      'target-arrow-color': BLUE,
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
      'source-arrow-color': BLUE,
      'source-arrow-fill': 'filled',
    },
  },
];

/**
 * Searchable node picker: typing any part of a name (case-insensitive) filters the list.
 * Arrow keys move through the matches, Enter picks one, Escape closes the list.
 * @param {string} [id] - id for the input (to link a <label>)
 * @param {{id: string, label: string}[]} options - Nodes to choose from
 * @param {string} selectedId - Currently selected node id ('' for none)
 * @param {(id: string) => void} onSelect - Called with the chosen node id
 */
export function NodeSearch({ id, options, selectedId, onSelect }) {
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
  const matches = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle))
    : options;

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
    setQuery(opt.label);
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
                key={opt.id}
                className={i === active ? 'active' : undefined}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the input
                  choose(opt);
                }}
                onMouseEnter={() => setActive(i)}
              >
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
 * @param {Array<[string, string]>} nodes - Edge definitions
 * @param {string[][]} layout - Layout grid specification
 * @param {Object} options - Layout rendering options
 * @returns {React.FC} Graph component
 */
export function create_graph(
  folders = {},
  nodes = [],
  layout = [],
  options = {}
) {
  const UNIQUE_LAYOUT = uniquifyLayout(layout);
  // Nodes listed only in the layout (no folder, no edges) are still shown
  const ALL_ELEMENTS = buildGraph(folders, nodes, layout.flat());

  function Graph() {
    const containerRef = useRef(null);
    const cyRef = useRef(null);
    const uid = useId(); // unique ids, so several graphs can share a page
    const [nodeOptions, setNodeOptions] = useState([]);
    const [selectedId, setSelectedId] = useState('');
    const [showFolders, setShowFolders] = useState(true);
    const [showGroupInLabel, setShowGroupInLabel] = useState(true);
    const [contextMenu, setContextMenu] = useState(null); // { x, y, copyText }
    const [nodeInfo, setNodeInfo] = useState(null); // details panel for a double-clicked node

    // Initialize Cytoscape graph (rebuilt when a toggle changes)
    useEffect(() => {
      const containerEl = containerRef.current;
      if (!containerEl) return;

      const cy = cytoscape({
        container: containerEl,
        elements: getVisibleElements(ALL_ELEMENTS, showFolders, showGroupInLabel),
        style: STYLES,
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

      if (UNIQUE_LAYOUT.length > 0) {
        applyLayout(cy, UNIQUE_LAYOUT, options);
      }

      requestAnimationFrame(() => cy.resize());

      const opts = cy.nodes(REPORT_NODE).map((n) => ({
        id: n.id(),
        label: n.data('displayLabel'),
      }));
      opts.sort((a, b) => compareNames(a.label, b.label));
      setNodeOptions(opts);

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
      navigator.clipboard
        .writeText(copyText)
        .then(() => console.log(`Copied to clipboard: ${copyText}`))
        .catch((err) => console.error('Failed to copy:', err));
    };

    // Selects a node (search box or side panel): jumps to it and shows its details
    const showNode = (id) => {
      const node = cyRef.current?.getElementById(id);
      if (!node || node.empty()) return;
      setSelectedId(id);
      setNodeInfo(getNodeInfo(node));
    };

    // Highlight the selected node and center on it
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
    }, [selectedId]);

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
      <div className="rbg-graph">
        <div className="controls">
          <label htmlFor={`${uid}-search`}>Select a node:</label>
          <NodeSearch
            id={`${uid}-search`}
            options={nodeOptions}
            selectedId={selectedId}
            // Picking a node also opens its details panel, like a double click
            onSelect={(id) => (id ? showNode(id) : setSelectedId(''))}
          />
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
              {[
                ['Parent Nodes', nodeInfo.parents],
                ['Child Nodes', nodeInfo.children],
              ].filter(([, list]) => list.length > 0).map(([title, list]) => (
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
