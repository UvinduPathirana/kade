# Kadé

Food delivery for Colombo: customers, restaurants, riders and an operations console sharing one order.

## Layout

```
apps/customer     Customer web app (port 5174)
apps/restaurant   Restaurant partner app for kitchen tablets (port 5175)
apps/rider        Rider app for phones (port 5176)
apps/admin        Operations console (port 5177)
packages/ui       @kade/ui — design system: tokens, base styles, components
prototype/        Original static HTML designs, kept for reference
DESIGN.md         Design system rules and component guide
PAGES.md          Page plan and build order
BACKEND.md        Microservices plan and milestones
```

All four apps are Vite + React + TypeScript and share `@kade/ui`. The backend will be microservices (see `BACKEND.md`); until then each app serves mock data from its own `src/api`.

## Commands

Requires Node 22.12+ and pnpm 10.

```bash
pnpm install
pnpm dev            # customer app on http://localhost:5174
pnpm dev:restaurant # http://localhost:5175
pnpm dev:rider      # http://localhost:5176
pnpm dev:admin      # http://localhost:5177
pnpm build          # typecheck + production build
pnpm typecheck
pnpm lint
pnpm format
```
