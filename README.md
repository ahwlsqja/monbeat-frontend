# MonBeat

Real-time blockchain transaction visualization as a rhythm game. Watch Monad parallel execution come alive through sound and motion.

Built with Next.js 15, Canvas 2D, Tone.js, and WebSocket.

## Quick Start

```bash
npm install
cp .env.example .env.local   # optional — defaults to production backend
npm run dev                   # http://localhost:3000
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_WS_URL` | WebSocket URL for monbeat-server | `wss://monbeat-backend-production.up.railway.app/ws` |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run start` | Serve production build |
| `npm run test` | Run tests (vitest) |
| `npm run test:watch` | Watch mode tests |
| `npm run lint` | ESLint |

## Architecture

```
src/
  app/           # Next.js App Router pages + layout + metadata
  components/    # GameView (canvas), SimulationPanel, ErrorBoundary
  game/          # Game engine — GameState, ObjectPool, renderers
  audio/         # Tone.js audio engine
  types/         # TypeScript type definitions
  __tests__/     # Unit + integration tests (vitest + RTL)
```

**Game loop:** `GameState` runs a 60fps `requestAnimationFrame` loop. WebSocket events from monbeat-server (block simulation results) spawn visual particles and trigger audio cues. Canvas renders transaction orbs, conflict arcs, and block boundaries.

**Audio:** Tone.js synthesizers map transaction types to sounds — commits get melodic tones, conflicts get percussive hits, re-executions get resonant chords.

## Deploy to Vercel

1. Push to GitHub
2. Import project in [Vercel Dashboard](https://vercel.com/new)
3. Set `NEXT_PUBLIC_WS_URL` in Environment Variables (or leave blank for default)
4. Deploy

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Rendering:** Canvas 2D with 60fps game loop
- **Audio:** Tone.js
- **WebSocket:** Native browser WebSocket API
- **Testing:** Vitest + React Testing Library (206+ tests)
- **Types:** TypeScript strict mode

## License

MIT
