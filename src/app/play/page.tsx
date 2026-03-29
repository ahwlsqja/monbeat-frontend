'use client';

import dynamic from 'next/dynamic';

const SimulationPanel = dynamic(() => import('../../components/SimulationPanel'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        color: 'var(--text-secondary)',
        fontSize: '1.2rem',
      }}
    >
      Loading MonBeat…
    </div>
  ),
});

export default function PlayPage() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <SimulationPanel />
    </div>
  );
}
