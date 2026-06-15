import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import OwnerFilter, { EVERYONE } from './OwnerFilter';

const owners = [
  { userId: 'me', label: 'Martin' },
  { userId: 'mum', label: 'Jane' },
];

describe('OwnerFilter', () => {
  it('renders each owner plus an Everyone option', () => {
    render(<OwnerFilter owners={owners} value="me" onChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Martin' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Jane' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Everyone' })).toBeInTheDocument();
  });

  it('marks the selected option', () => {
    render(<OwnerFilter owners={owners} value="me" onChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Martin' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Jane' })).toHaveAttribute('aria-selected', 'false');
  });

  it('emits the chosen userId (and the Everyone sentinel)', async () => {
    const onChange = vi.fn();
    render(<OwnerFilter owners={owners} value="me" onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Jane' }));
    expect(onChange).toHaveBeenCalledWith('mum');
    await userEvent.click(screen.getByRole('tab', { name: 'Everyone' }));
    expect(onChange).toHaveBeenCalledWith(EVERYONE);
  });
});
