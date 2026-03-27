import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Home from '../../app/page';

// next/link renders an <a> in test environment
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe('Landing Page', () => {
  it('renders MonBeat title', () => {
    render(<Home />);
    expect(screen.getByText('MonBeat')).toBeTruthy();
  });

  it('renders tagline describing the app', () => {
    render(<Home />);
    const tagline = screen.getByTestId('tagline');
    expect(tagline).toBeTruthy();
    expect(tagline.textContent).toContain('rhythm game');
  });

  it('renders CTA link with data-testid="cta-play"', () => {
    render(<Home />);
    const cta = screen.getByTestId('cta-play');
    expect(cta).toBeTruthy();
  });

  it('CTA links to /play', () => {
    render(<Home />);
    const cta = screen.getByTestId('cta-play') as HTMLAnchorElement;
    expect(cta.getAttribute('href')).toBe('/play');
  });

  it('CTA has "Try It Now" text', () => {
    render(<Home />);
    const cta = screen.getByTestId('cta-play');
    expect(cta.textContent).toContain('Try It Now');
  });
});
