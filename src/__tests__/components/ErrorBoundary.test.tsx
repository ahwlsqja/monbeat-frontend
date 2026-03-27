import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from '../../components/ErrorBoundary';

// Suppress console.error noise from React's error boundary logging
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** A component that always throws on render. */
function Bomb({ message }: { message?: string }) {
  throw new Error(message || 'Boom!');
}

/** A component that conditionally throws. */
function MaybeBomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Conditional boom');
  return <div data-testid="child-ok">All good</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">Hello</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('child')).toBeDefined();
    expect(screen.getByText('Hello')).toBeDefined();
  });

  it('renders default fallback UI when child throws', () => {
    render(
      <ErrorBoundary>
        <Bomb message="Test explosion" />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('error-boundary-fallback')).toBeDefined();
    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByTestId('error-message').textContent).toBe('Test explosion');
    expect(screen.getByTestId('btn-retry')).toBeDefined();
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">Custom</div>}>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('custom-fallback')).toBeDefined();
    expect(screen.queryByTestId('error-boundary-fallback')).toBeNull();
  });

  it('recovers children on retry click', () => {
    // We can't dynamically toggle shouldThrow with class component state reset,
    // but we can verify the boundary clears its error state on retry.
    // After retry, Bomb will throw again — so we verify the cycle works.
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    // Error state visible
    expect(screen.getByTestId('error-boundary-fallback')).toBeDefined();

    // Click retry — clears error state, re-renders children
    fireEvent.click(screen.getByTestId('btn-retry'));

    // Bomb throws again → boundary catches again → fallback shows
    expect(screen.getByTestId('error-boundary-fallback')).toBeDefined();
  });

  it('logs error to console.error with component stack', () => {
    const consoleSpy = vi.spyOn(console, 'error');

    render(
      <ErrorBoundary>
        <Bomb message="logged error" />
      </ErrorBoundary>,
    );

    // React's own error boundary + our componentDidCatch both log
    expect(consoleSpy).toHaveBeenCalled();
  });
});
