import { useNavigate } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { useAuth } from 'react-oidc-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoggedIn from './LoggedIn';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(),
}));
vi.mock('react-oidc-context', () => ({
  useAuth: vi.fn(),
}));

const mockUseNavigate = vi.mocked(useNavigate);
const mockUseAuth = vi.mocked(useAuth);

describe('LoggedIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates home once auth has settled', () => {
    const navigate = vi.fn();
    mockUseNavigate.mockReturnValue(navigate as unknown as ReturnType<typeof useNavigate>);
    mockUseAuth.mockReturnValue({ isLoading: false } as unknown as ReturnType<typeof useAuth>);

    render(<LoggedIn />);

    expect(screen.getByText(/Signing in/)).toBeInTheDocument();
    expect(navigate).toHaveBeenCalledWith({ to: '/' });
  });

  it('waits while auth is still loading', () => {
    const navigate = vi.fn();
    mockUseNavigate.mockReturnValue(navigate as unknown as ReturnType<typeof useNavigate>);
    mockUseAuth.mockReturnValue({ isLoading: true } as unknown as ReturnType<typeof useAuth>);

    render(<LoggedIn />);

    expect(navigate).not.toHaveBeenCalled();
  });
});
