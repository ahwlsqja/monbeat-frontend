import Link from 'next/link';

export default function Home() {
  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: '1.5rem',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '3rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
        MonBeat
      </h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
        Blockchain Rhythm Visualizer
      </p>
      <p
        data-testid="tagline"
        style={{
          color: 'var(--text-secondary)',
          fontSize: '0.95rem',
          maxWidth: '32rem',
          lineHeight: 1.6,
        }}
      >
        Visualize Solidity smart-contract execution as a rhythm game.
        Watch transactions commit, conflicts spark, and re-executions
        resolve — all driven by a real parallel-execution simulator.
      </p>
      <Link
        href="/play"
        data-testid="cta-play"
        style={{
          marginTop: '0.5rem',
          padding: '1rem 3rem',
          background: 'var(--accent-green)',
          color: '#0a0a0f',
          borderRadius: '0.75rem',
          textDecoration: 'none',
          fontWeight: 700,
          fontSize: '1.15rem',
          letterSpacing: '0.02em',
          transition: 'transform 0.15s, box-shadow 0.15s',
          boxShadow: '0 0 24px rgba(68, 255, 136, 0.25)',
        }}
      >
        ▶ Try It Now
      </Link>
    </main>
  );
}
