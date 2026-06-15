import { useNavigate } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Logout from './Logout';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(),
}));

const mockUseNavigate = vi.mocked(useNavigate);

describe('Logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates home on mount', () => {
    const navigate = vi.fn();
    mockUseNavigate.mockReturnValue(navigate as unknown as ReturnType<typeof useNavigate>);

    render(<Logout />);

    expect(screen.getByText(/Signing out/)).toBeInTheDocument();
    expect(navigate).toHaveBeenCalledWith({ to: '/' });
  });
});
