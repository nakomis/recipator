import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AppHeader from './AppHeader';

vi.mock('@tanstack/react-router', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  Link: ({ children }: any) => <a href="#stub">{children}</a>,
}));

describe('AppHeader', () => {
  it('calls onSignOut', async () => {
    const onSignOut = vi.fn();
    render(<AppHeader onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
