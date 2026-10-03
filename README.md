# EXTINCT.io

A multiplayer third-person 3D browser game in the style of slither.io and agar.io, with dinosaurs. Eat smaller dinosaurs, evolve through five species and survive until the meteor hits. "EXTINCT.io" is a working title.

The brief, game rules and milestone plan are in [BUILD_PROMPT.md](BUILD_PROMPT.md).

## Status

| Milestone                     | Status  |
| ----------------------------- | ------- |
| M0 Project setup              | Done    |
| M1 Single-player sandbox      | Done    |
| M2 Core rules offline         | Next    |
| M3 Multiplayer                | Planned |
| M4 Round loop                 | Planned |
| M5 Art pass                   | Planned |
| M6 Abilities, audio and juice | Planned |
| M7 Interface polish           | Planned |
| M8 Deployment                 | Planned |

## Quick start

You need Node.js 22.18 or newer (24 LTS recommended, see `.nvmrc`) and pnpm.

```bash
corepack enable        # once per machine: provides the pnpm version pinned in package.json
pnpm install
pnpm dev               # client and game server together
```

Open http://localhost:5173 and you're dropped onto the island as a tiny Compsognathus. Run into eggs to eat them and grow; at 40 mass you evolve into a Velociraptor.

| Device  | Controls                                                                                  |
| ------- | ----------------------------------------------------------------------------------------- |
| Desktop | W or ↑ to run, A/D or ←/→ to turn, S or ↓ to stop; or hold the left mouse button to steer |
| Phone   | Drag anywhere on the left half of the screen (a joystick appears under your thumb)        |
| Any     | F3 opens the debug overlay: FPS, draw calls, ping and entity counts                       |

URL options for trying things out: `?seed=42` gives a fixed egg layout and spawn point, `?mass=1600` starts you as a T-Rex, `?debug` opens the overlay, and `?quality=low|medium|high` overrides the graphics preset. While `pnpm dev` runs, http://localhost:5173/dev/dinos.html shows every tier's placeholder dinosaur side by side.

To change ports or point the client at another server, copy `.env.example` to `.env` and edit it.

**Testing on a phone on the same Wi-Fi:** run the two halves separately and expose the client to your network:

```bash
pnpm --filter @extinct/server dev
pnpm --filter @extinct/client dev --host   # open the "Network" URL it prints on your phone
```

## Commands

| Command                             | What it does                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Client (Vite, hot reload) and game server (restarts on change) together                   |
| `pnpm check`                        | Format check, lint, type-check and unit tests. Run it before committing                   |
| `pnpm test`                         | Unit tests (Vitest) for `shared`, `server` and `client`                                   |
| `pnpm test:e2e`                     | Browser smoke tests (Playwright) on desktop and mobile Chromium. Starts `pnpm dev` itself |
| `pnpm lint`                         | ESLint with type-aware rules                                                              |
| `pnpm typecheck`                    | TypeScript in strict mode across every package                                            |
| `pnpm format` / `pnpm format:check` | Prettier                                                                                  |
| `pnpm build`                        | Production build of the client into `client/dist`                                         |
| `pnpm start`                        | Game server without watch mode                                                            |

Before running browser tests for the first time on a new machine, install the test browser with `pnpm exec playwright install chromium`.

CI (GitHub Actions) runs the format check, lint, type-check, unit tests, build and browser smoke tests on every push.

## Project layout

```text
client/          Three.js + Vite browser client
  game/          the offline sandbox: runs the shared simulation and draws it
  input/         keyboard, mouse and touch steering
  render/        terrain, sky, plants, eggs, dinosaurs (dino/) and the camera
  net/           talking to the game server
  ui/            HUD, debug overlay, hints and styles
  dev/           developer pages (not shipped)
server/          Colyseus game server: authoritative simulation
shared/          rules and constants used by both sides
  config.ts      every tuning number
  movement.ts    the movement step function
  tiers.ts       tiers and body scale
  sim/           the game simulation (dinosaurs, eggs, eating)
  world/         the island: layout and terrain heights
e2e/             Playwright browser tests
```

Asset (`client/assets/`) and audio (`client/audio/`) folders arrive with milestones 5 and 6.

## Docs

- [BUILD_PROMPT.md](BUILD_PROMPT.md): the brief, rules, numbers and milestones.
- [CLAUDE.md](CLAUDE.md): conventions for working on the code, for people and Claude Code alike.
- [CHANGELOG.md](CHANGELOG.md): what each milestone added.
- [CREDITS.md](CREDITS.md): third-party assets, libraries and licences.
