import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://monbeat.vercel.app'),
  title: 'MonBeat — Blockchain Rhythm Visualizer',
  description:
    'Real-time blockchain transaction visualization as a rhythm game. Watch parallel execution, conflicts, and re-executions come alive on Monad.',
  keywords: [
    'MonBeat',
    'blockchain',
    'visualization',
    'Monad',
    'parallel execution',
    'rhythm game',
    'smart contracts',
  ],
  authors: [{ name: 'MonBeat Team' }],
  icons: {
    icon: '/icon',
  },
  openGraph: {
    type: 'website',
    siteName: 'MonBeat',
    title: 'MonBeat — Blockchain Rhythm Visualizer',
    description:
      'Real-time blockchain transaction visualization as a rhythm game on Monad.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'MonBeat — Blockchain Rhythm Visualizer',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MonBeat — Blockchain Rhythm Visualizer',
    description:
      'Real-time blockchain transaction visualization as a rhythm game on Monad.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
