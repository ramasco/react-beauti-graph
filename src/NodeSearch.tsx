import { useEffect, useRef, useState } from 'react';

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
