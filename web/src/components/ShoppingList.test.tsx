import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShoppingItem } from '@/api/client';
import ShoppingList from './ShoppingList';

const { itemsMock, addMock, updateMock, deleteMock, clearMock } = vi.hoisted(() => ({
  itemsMock: vi.fn(),
  addMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  clearMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  useShoppingItems: itemsMock,
  useAddShoppingItem: addMock,
  useUpdateShoppingItem: updateMock,
  useDeleteShoppingItem: deleteMock,
  useClearTicked: clearMock,
}));

function item(over: Partial<ShoppingItem>): ShoppingItem {
  return {
    itemId: 'i',
    listId: 'default',
    raw: '',
    item: 'thing',
    amount: null,
    unit: null,
    aisle: 'other',
    checked: false,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

const addMutate = vi.fn();
const updateMutate = vi.fn();
const deleteMutate = vi.fn();
const clearMutate = vi.fn();

beforeEach(() => {
  addMutate.mockReset();
  updateMutate.mockReset();
  deleteMutate.mockReset();
  clearMutate.mockReset();
  addMock.mockReturnValue({ mutate: addMutate, isPending: false, isError: false });
  updateMock.mockReturnValue({ mutate: updateMutate });
  deleteMock.mockReturnValue({ mutate: deleteMutate });
  clearMock.mockReturnValue({ mutate: clearMutate, isPending: false });
});

describe('ShoppingList', () => {
  it('shows an empty message when there are no items', () => {
    itemsMock.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(<ShoppingList />);
    expect(screen.getByText(/list is empty/i)).toBeInTheDocument();
  });

  it('groups items by aisle and shows the quantity', () => {
    itemsMock.mockReturnValue({
      data: [
        item({ itemId: 'a', aisle: 'produce', item: 'Apples' }),
        item({ itemId: 'b', aisle: 'dairy-eggs', item: 'Cream', amount: '200', unit: 'ml' }),
      ],
      isLoading: false,
      isError: false,
    });
    render(<ShoppingList />);
    expect(screen.getByText('Fruit & Vegetables')).toBeInTheDocument();
    expect(screen.getByText('Dairy & Eggs')).toBeInTheDocument();
    expect(screen.getByText('Cream (200ml)')).toBeInTheDocument();
  });

  it('ticks an item via update', async () => {
    itemsMock.mockReturnValue({
      data: [item({ itemId: 'a', aisle: 'produce', item: 'Apples' })],
      isLoading: false,
      isError: false,
    });
    render(<ShoppingList />);
    await userEvent.click(screen.getByRole('button', { name: /tick apples/i }));
    expect(updateMutate).toHaveBeenCalledWith({ itemId: 'a', patch: { checked: true } });
  });

  it('adds a typed item', async () => {
    itemsMock.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(<ShoppingList />);
    await userEvent.type(screen.getByLabelText(/add a shopping-list item/i), '4 pints of milk');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(addMutate).toHaveBeenCalledWith('4 pints of milk', expect.anything());
  });

  it('shows ticked items in their own section with a clear action', async () => {
    itemsMock.mockReturnValue({
      data: [item({ itemId: 'c', item: 'Beans', checked: true })],
      isLoading: false,
      isError: false,
    });
    render(<ShoppingList />);
    const ticked = screen.getByText(/ticked \(1\)/i).closest('section') as HTMLElement;
    expect(within(ticked).getByText('Beans')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /clear ticked/i }));
    expect(clearMutate).toHaveBeenCalled();
  });
});
