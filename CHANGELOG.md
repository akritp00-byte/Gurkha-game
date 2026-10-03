# Changelog

One entry per milestone (BUILD_PROMPT.md §9), newest first.

## M0: Project setup (2026-10-03)

### Added

- pnpm workspace monorepo: `client/` (Three.js + Vite), `server/` (Node + Colyseus 0.18) and `shared/` (game constants), with TypeScript in strict mode everywhere.
- `pnpm dev` runs the client (http://localhost:5173) and the game server (port 2567) together. The client shows a placeholder low-poly island and a live server status badge.
- `shared/config.ts` holds every tuning number from the brief: tiers, eating, movement, sprint, world, ferns, round loop, rooms, bots, abilities, networking and the performance budget.
- Game server with a JSON `/health` route (Colyseus also serves `/__healthcheck`). Node runs its TypeScript directly, so there is no server build step.
- ESLint with type-aware rules and import boundaries between packages, plus Prettier.
- Vitest unit tests for `shared`, `server` and `client`.
- Playwright smoke test on desktop and mobile Chromium: boots `pnpm dev`, checks WebGL rendering, server reachability and console errors, and saves screenshots.
- GitHub Actions CI on every push: format check, lint, type-check, unit tests, client build and browser smoke tests.
- `README.md`, `CLAUDE.md`, `CREDITS.md`, `.env.example`, `BUILD_PROMPT.md` and `.mcp.json` (Playwright and Context7 MCP servers).
