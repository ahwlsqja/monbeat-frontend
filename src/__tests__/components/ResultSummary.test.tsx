import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ResultSummary from '../../components/ResultSummary';
import type { CompletionStats } from '../../net/types';

const stats: CompletionStats = {
  total_events: 42,
  total_gas: 1_234_567,
  num_transactions: 10,
  num_conflicts: 3,
  num_re_executions: 2,
};

describe('ResultSummary', () => {
  it('renders data-testid="result-summary"', () => {
    render(<ResultSummary stats={stats} onPlayAgain={() => {}} />);
    expect(screen.getByTestId('result-summary')).toBeTruthy();
  });

  it('shows "Simulation Complete" heading', () => {
    render(<ResultSummary stats={stats} onPlayAgain={() => {}} />);
    expect(screen.getByText('Simulation Complete')).toBeTruthy();
  });

  it('displays total events', () => {
    render(<ResultSummary stats={stats} onPlayAgain={() => {}} />);
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('displays total gas with locale formatting', () => {
    render(<ResultSummary stats={stats} onPlayAgain={() => {}} />);
    expect(screen.getByText('1,234,567')).toBeTruthy();
  });

  it('displays transaction count', () => {
    render(<ResultSummary stats={stats} onPlayAgain={() => {}} />);
    expect(screen.getByText('10')).toBeTruthy();
  });

  it('displays conflict count with percentage', () => {
    render(<ResultSummary stats={stats} onPlayAgain={() => {}} />);
    // 3/10 = 30.0%
    expect(screen.getByText('3 (30.0%)')).toBeTruthy();
  });

  it('displays re-execution count', () => {
    render(<ResultSummary stats={stats} onPlayAgain={() => {}} />);
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('shows 0.0% conflict rate when there are zero transactions', () => {
    const zeroTx: CompletionStats = { ...stats, num_transactions: 0, num_conflicts: 0 };
    render(<ResultSummary stats={zeroTx} onPlayAgain={() => {}} />);
    expect(screen.getByText('0 (0.0%)')).toBeTruthy();
  });

  it('renders Play Again button with data-testid', () => {
    render(<ResultSummary stats={stats} onPlayAgain={() => {}} />);
    const btn = screen.getByTestId('btn-play-again');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Play Again');
  });

  it('fires onPlayAgain callback when clicking Play Again', () => {
    const onPlayAgain = vi.fn();
    render(<ResultSummary stats={stats} onPlayAgain={onPlayAgain} />);
    fireEvent.click(screen.getByTestId('btn-play-again'));
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
  });
});
