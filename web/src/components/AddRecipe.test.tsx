import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AddRecipe from './AddRecipe';

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
const state = vi.hoisted(() => ({
  current: { mutate, isPending: false, isError: false, isSuccess: false } as Record<
    string,
    unknown
  >,
}));

vi.mock('@/api/client', () => ({ useExtract: () => state.current }));

describe('AddRecipe', () => {
  it('saves the entered URL', async () => {
    state.current = { mutate, isPending: false, isError: false, isSuccess: false };
    render(<AddRecipe />);
    await userEvent.type(screen.getByLabelText('Recipe URL'), 'https://recipe.example/x');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(mutate).toHaveBeenCalledWith('https://recipe.example/x', expect.anything());
  });

  it('shows an error message on failure', () => {
    state.current = {
      mutate,
      isPending: false,
      isError: true,
      isSuccess: false,
      error: new Error('boom'),
    };
    render(<AddRecipe />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  it('confirms success', () => {
    state.current = {
      mutate,
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { title: 'Cake' },
    };
    render(<AddRecipe />);
    expect(screen.getByText(/Saved/)).toBeInTheDocument();
  });
});
