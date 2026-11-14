import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NodeSearch } from '../src/NodeSearch.tsx';
import type { NodeSearchProps } from '../src/NodeSearch.tsx';

const OPTIONS = [
  { id: 'r001', label: 'r001 (Sales)' },
  { id: 'r002', label: 'r002 (Sales)' },
  { id: 'r021', label: 'r021 (Finance)' },
  { id: 'ralone', label: 'ralone' },
];

beforeAll(() => {
  // jsdom has no layout engine
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(cleanup);

function setup(props: Partial<NodeSearchProps> = {}) {
  const onSelect = vi.fn();
  const user = userEvent.setup();
  const utils = render(<NodeSearch options={OPTIONS} selectedId="" onSelect={onSelect} {...props} />);
  const input = screen.getByRole<HTMLInputElement>('textbox');
  const listItems = (): (string | null)[] => screen.queryAllByRole('option').map((li) => li.textContent);
  return { ...utils, onSelect, user, input, listItems };
}

describe('NodeSearch', () => {
  it('shows the placeholder and no list at first', () => {
    const { input, listItems } = setup();
    expect(input).toHaveProperty('placeholder', '-- type to search --');
    expect(listItems()).toEqual([]);
  });

  it('opens the full list, with ALL on top, when clicked', async () => {
    const { user, input, listItems } = setup();
    await user.click(input);
    expect(listItems()).toEqual(['ALL', ...OPTIONS.map((o) => o.label)]);
  });

  it('choosing ALL is the same as selecting no node', async () => {
    const { user, input, onSelect, listItems } = setup({ selectedId: 'r001' });
    await user.click(input);
    await user.click(screen.getByText('ALL'));
    expect(onSelect).toHaveBeenCalledWith('');
    expect(input.value).toBe('');
    expect(listItems()).toEqual([]);
  });

  it('ALL stays in the list when typing part of "all"', async () => {
    const { user, input, listItems } = setup();
    await user.type(input, 'al');
    expect(listItems()).toEqual(['ALL', 'r001 (Sales)', 'r002 (Sales)', 'ralone']);
  });

  it('can rename the "no node" entry (e.g. No tracking)', async () => {
    const { user, input, onSelect, listItems } = setup({ selectedId: 'r001', noneLabel: 'No tracking' });
    await user.click(input);
    expect(listItems()[0]).toBe('No tracking');
    expect(listItems()).not.toContain('ALL');
    await user.click(screen.getByText('No tracking'));
    expect(onSelect).toHaveBeenCalledWith('');
  });

  it('filters by any part of the name, ignoring case', async () => {
    const { user, input, listItems } = setup();
    await user.type(input, 'SAL');
    expect(listItems()).toEqual(['r001 (Sales)', 'r002 (Sales)']);

    await user.clear(input);
    await user.type(input, '21 (f');
    expect(listItems()).toEqual(['r021 (Finance)']);
  });

  it('shows "no match" when nothing matches', async () => {
    const { user, input, listItems } = setup();
    await user.type(input, 'zzz');
    expect(listItems()).toEqual(['no match']);
  });

  it('selects a node by clicking it', async () => {
    const { user, input, onSelect, listItems } = setup();
    await user.type(input, 'finance');
    await user.click(screen.getByText('r021 (Finance)'));
    expect(onSelect).toHaveBeenCalledWith('r021');
    expect(input.value).toBe('r021 (Finance)');
    expect(listItems()).toEqual([]);
  });

  it('selects a node with the arrow keys and Enter', async () => {
    const { user, input, onSelect } = setup();
    await user.type(input, 'sales');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('r002');
  });

  it('Escape closes the list and restores the selected name', async () => {
    const { user, input, onSelect, listItems } = setup({ selectedId: 'r001' });
    expect(input.value).toBe('r001 (Sales)');

    await user.clear(input);
    await user.type(input, 'fin');
    await user.keyboard('{Escape}');

    expect(listItems()).toEqual([]);
    expect(input.value).toBe('r001 (Sales)');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows the name of a node selected elsewhere (e.g. the side panel)', () => {
    const { rerender, input } = setup();
    rerender(<NodeSearch options={OPTIONS} selectedId="ralone" onSelect={() => undefined} />);
    expect(input.value).toBe('ralone');
  });

  it('the clear button empties the box and clears the selection', async () => {
    const { user, input, onSelect } = setup({ selectedId: 'r001' });
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onSelect).toHaveBeenCalledWith('');
    expect(input.value).toBe('');
  });

  it('has no checkboxes unless onToggleVisible is given', async () => {
    const { user, input } = setup();
    await user.click(input);
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
  });

  it('shows a checkbox next to each node (not ALL), on unless hidden', async () => {
    const { user, input } = setup({ hiddenIds: new Set(['r002']), onToggleVisible: vi.fn() });
    await user.click(input);
    const boxes = screen.getAllByRole<HTMLInputElement>('checkbox');
    expect(boxes).toHaveLength(OPTIONS.length);
    expect(boxes.map((b) => b.checked)).toEqual([true, false, true, true]);
    expect(screen.getByLabelText('Show r002 (Sales)').closest('li')?.className).toContain('off');
  });

  it('clicking a checkbox toggles the node without picking it, and keeps the list open', async () => {
    const onToggleVisible = vi.fn();
    const { user, input, onSelect, listItems } = setup({ hiddenIds: new Set(), onToggleVisible });
    await user.click(input);
    await user.click(screen.getByLabelText('Show r021 (Finance)'));
    expect(onToggleVisible).toHaveBeenCalledWith('r021');
    expect(onSelect).not.toHaveBeenCalled();
    expect(listItems().length).toBe(OPTIONS.length + 1);
  });

  it('closes the list when clicking outside', async () => {
    const { user, input, listItems } = setup();
    await user.click(input);
    expect(listItems().length).toBeGreaterThan(0);
    await user.click(document.body);
    expect(listItems()).toEqual([]);
  });
});
