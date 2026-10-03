# CLAUDE.md

Conventions for working on EXTINCT.io. The brief, rules, numbers and milestone plan are in `BUILD_PROMPT.md`: read it before starting a milestone, and do one milestone at a time.

## Commands

```bash
pnpm install
pnpm dev                     # client http://localhost:5173 + game server http://localhost:2567
pnpm check                   # format check, lint, type-check, unit tests: run before every commit
pnpm build                   # production client build (CI runs it too)
pnpm test:e2e                # Playwright smoke tests; starts `pnpm dev` itself (or reuses a running one locally)
pnpm vitest run --project server        # one test project (shared | server | client)
pnpm vitest run shared/config.test.ts   # one test file
pnpm format                  # fix formatting
```

## Architecture

- **pnpm monorepo** with `client/`, `server/` and `shared/`. Source sits directly in each package folder (no `src/`), so paths match the brief: `shared/config.ts`, `client/render/`, `server/systems/`.
- **`shared/`** is pure TypeScript game logic and constants used by both sides: tier logic, the eat rule, the movement step function. No DOM, Node, Three.js or Colyseus imports (ESLint enforces this). Keep it deterministic, because the same step function runs on the server and in client-side prediction.
- **`server/`** is the authoritative Colyseus 0.18 server. `index.ts` is the entry point. `app.ts` builds the server without binding a port, so tests can start it on port 0. `env.ts` loads the repo-root `.env`. Clients only ever send inputs. Never trust a position sent by a client.
- **`client/`** is Three.js + Vite, with no game engine. Use `render/` for the scene, camera and effects, `net/` for server communication and `ui/` for the HUD and menus. `assets/` and `audio/` come later.
- **Multiplayer (from M3):** the client sends inputs (sequence number, direction, sprint, ability). The server simulates at `NETWORK.tickRate` and sends state patches filtered to `NETWORK.interestRadius`, with fern hiding enforced there. The client predicts its own dino with the shared step function and reconciles against the server. Other dinos are interpolated `NETWORK.interpolationDelayMs` in the past.

## Conventions

- **TypeScript strict everywhere.** No `any`; the type-aware lint rules catch it. Use `import type` for type-only imports.
- **Tuning numbers live in `shared/config.ts`.** That covers every gameplay and network number: grouped `as const` objects with a one-line note each. Purely technical constants, like a fetch timeout, can be named constants next to the code that uses them.
- **Use explicit `.ts` extensions in relative imports** (`import { x } from './y.ts'`). Node runs `server/` and `shared/` directly with its built-in TypeScript support (no build step) and needs them. Do the same in `client/` for consistency.
- **Erasable syntax only** (`erasableSyntaxOnly`). Node strips types but can't compile, so use no enums (use `as const` objects with union types), namespaces, parameter properties or decorators. Define Colyseus state with `@colyseus/schema`'s `schema()` / `t` builders, not `@type()` decorators.
- **Tests:** Vitest unit tests sit next to the code as `*.test.ts`; browser tests go in `e2e/`. New logic in `shared/` and `server/` comes with tests. Never skip or disable a failing test to get green.
- **Dependencies:** as few as possible. Explain why before adding one. Ask before changing the stack, buying assets or signing up for paid services.
- **Secrets:** `.env` is git-ignored. Update `.env.example` whenever you add a variable. Browser-visible variables must start with `VITE_` and must never hold secrets.
- **Assets and sounds:** CC0 or properly licensed only, recorded in `CREDITS.md` before committing.
- **Out of scope for this version:** accounts, payments, ads, chat.
- If you're blocked on art, use procedural placeholders and keep going.

## End of every milestone

1. `pnpm check`, `pnpm build` and `pnpm test:e2e` all pass.
2. Open the game in a browser, play it briefly, take screenshots and check the console for errors. Use Playwright MCP locally. In cloud sessions, use the Playwright test runner or a small script with the pre-installed Chromium.
3. Add an entry to `CHANGELOG.md` and update the status table in `README.md`.
4. Commit.
5. Stop and summarise: what works, screenshots, known issues, what's next.

## Parallel work (after M3 is merged)

Folder ownership: **art and rendering** owns `client/render/` and `client/assets/`. **Abilities and audio** owns `shared/abilities/`, `server/systems/` and `client/audio/`. **Interface** owns `client/ui/`. Keep CI green, and flag any edit outside your own folders.

## Toolchain notes

- **Node ≥ 22.18** (CI uses 24 LTS from `.nvmrc`). pnpm is pinned through `packageManager` (10.x), and corepack or pnpm itself switches to that version automatically. Shared dev-tool versions live in the `catalog` in `pnpm-workspace.yaml`.
- **TypeScript is pinned to 6.0.x** because typescript-eslint doesn't support TypeScript 7 yet.
- **`@playwright/test` is pinned to 1.56.1**, which matches the Chromium build pre-installed in Claude Code cloud sessions (`/opt/pw-browsers`). Elsewhere, run `pnpm exec playwright install chromium` once. If you bump it, make sure cloud sessions can still run e2e tests (for example via `executablePath`).
- **Colyseus 0.18 is newer than most docs and training data.** Check an API in `server/node_modules/@colyseus/*/build/*.d.ts` (or with Context7) before using it. It includes an input buffer, fixed-timestep simulation, `Rewind` (lag compensation) and `StateView` (per-client state filtering); evaluate those in M3 before hand-rolling equivalents.
- **Three.js** is used through `WebGLRenderer` from `three` (r186), and add-ons import from `three/addons/...`.
