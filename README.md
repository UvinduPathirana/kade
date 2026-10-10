# Kadé

Food delivery for Colombo: customers, restaurants, riders and an operations console sharing one order.

## Layout

```
apps/customer     Customer web app (Vite + React + TypeScript)
packages/ui       @kade/ui — design system: tokens, base styles, components
prototype/        Original static HTML designs, kept for reference
DESIGN.md         Design system rules and component guide
PAGES.md          Page plan and build order
```

The restaurant, rider and admin apps will be added under `apps/`. The backend will be microservices; until then the customer app serves mock data from `apps/customer/src/api`.

## Commands

Requires Node 22.12+ and pnpm 10.

```bash
pnpm install
pnpm dev            # customer app on http://localhost:5174
pnpm build          # typecheck + production build
pnpm typecheck
pnpm lint
pnpm format
```
