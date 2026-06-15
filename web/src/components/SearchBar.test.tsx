import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SearchBar from './SearchBar';

describe('SearchBar', () => {
  it('forwards typed text to onQueryChange', async () => {
    const onQueryChange = vi.fn();
    render(<SearchBar query="" onQueryChange={onQueryChange} />);
    await userEvent.type(screen.getByLabelText('Search recipes'), 'a');
    expect(onQueryChange).toHaveBeenCalledWith('a');
  });

  it('reflects the current query value', () => {
    render(<SearchBar query="pasta" onQueryChange={vi.fn()} />);
    expect(screen.getByLabelText('Search recipes')).toHaveValue('pasta');
  });
});
