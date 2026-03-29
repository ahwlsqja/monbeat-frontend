import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock next/dynamic → renders a simple stub that exposes onComplete
// ---------------------------------------------------------------------------
vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: (loader: () => Promise<{ default: React.ComponentType<any> }>) => {
    // Return a component that renders a stub GameView
    const Stub = (props: any) => (
      <div data-testid="game-view-stub">
        <button
          data-testid="trigger-complete"
          onClick={() =>
            props.onComplete?.({
              total_events: 10,
              total_gas: 999,
              num_transactions: 5,
              num_conflicts: 1,
              num_re_executions: 0,
            })
          }
        >
          Complete
        </button>
      </div>
    );
    Stub.displayName = 'DynamicGameView';
    return Stub;
  },
}));

import SimulationPanel from '../../components/SimulationPanel';

describe('SimulationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -- Input phase --

  it('renders data-testid="simulation-panel"', () => {
    render(<SimulationPanel />);
    expect(screen.getByTestId('simulation-panel')).toBeTruthy();
  });

  it('shows textarea with default Counter source in input phase', () => {
    render(<SimulationPanel />);
    const textarea = screen.getByTestId('source-input') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.value).toContain('contract MultiWallet');
  });

  it('shows Play button in input phase', () => {
    render(<SimulationPanel />);
    const btn = screen.getByTestId('btn-play');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Play');
  });

  it('disables Play button when source is empty', () => {
    render(<SimulationPanel />);
    const textarea = screen.getByTestId('source-input');
    fireEvent.change(textarea, { target: { value: '' } });
    const btn = screen.getByTestId('btn-play') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('enables Play button when source has content', () => {
    render(<SimulationPanel />);
    const btn = screen.getByTestId('btn-play') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  // -- Phase transitions --

  it('clicking Play transitions to playing phase (textarea hidden, game view shown)', () => {
    render(<SimulationPanel />);
    fireEvent.click(screen.getByTestId('btn-play'));
    // textarea should be gone
    expect(screen.queryByTestId('source-input')).toBeNull();
    // game view stub should appear
    expect(screen.getByTestId('game-view-stub')).toBeTruthy();
  });

  it('does NOT transition when source is only whitespace', () => {
    render(<SimulationPanel />);
    const textarea = screen.getByTestId('source-input');
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('btn-play'));
    // should still be in input phase
    expect(screen.getByTestId('source-input')).toBeTruthy();
  });

  it('transitions from playing → results when onComplete fires', () => {
    render(<SimulationPanel />);
    // go to playing
    fireEvent.click(screen.getByTestId('btn-play'));
    // trigger onComplete from stub
    fireEvent.click(screen.getByTestId('trigger-complete'));
    // results phase
    expect(screen.getByTestId('result-summary')).toBeTruthy();
    expect(screen.getByText('Simulation Complete')).toBeTruthy();
  });

  it('Play Again resets back to input phase', () => {
    render(<SimulationPanel />);
    fireEvent.click(screen.getByTestId('btn-play'));
    fireEvent.click(screen.getByTestId('trigger-complete'));
    // now in results — click Play Again
    fireEvent.click(screen.getByTestId('btn-play-again'));
    // back to input
    expect(screen.getByTestId('source-input')).toBeTruthy();
    expect(screen.getByTestId('btn-play')).toBeTruthy();
  });

  it('allows editing source text', () => {
    render(<SimulationPanel />);
    const textarea = screen.getByTestId('source-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'contract NewContract {}' } });
    expect(textarea.value).toBe('contract NewContract {}');
  });
});
