import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import versionData from '@/version.json';
import Footer from './Footer';

describe('Footer', () => {
  it('renders the app version', () => {
    render(<Footer />);
    expect(screen.getByText(new RegExp(`v${versionData.version}`))).toBeInTheDocument();
  });
});
