# EXTINCT.io

A multiplayer third-person 3D browser game in the style of slither.io and agar.io, with dinosaurs. Eat smaller dinosaurs, evolve through five species and survive until the meteor hits. "EXTINCT.io" is a working title.

The brief, game rules and milestone plan are in [BUILD_PROMPT.md](BUILD_PROMPT.md).

## Status

| Milestone                     | Status  |
| ----------------------------- | ------- |
| M0 Project setup              | Done    |
| M1 Single-player sandbox      | Done    |
| M2 Core rules offline         | Done    |
| M3 Multiplayer                | Done    |
| M4 Round loop                 | Done    |
| M5 Art pass                   | Done    |
| M6 Abilities, audio and juice | Done    |
| M7 Interface polish           | Next    |
| M8 Deployment                 | Planned |

## Quick start

You need Node.js 22.18 or newer (24 LTS recommended, see `.nvmrc`) and pnpm.

```bash
corepack enable        # once per machine: provides the pnpm version pinned in package.json
pnpm install
pnpm dev               # client and game server together
```

Open http://localhost:5173 and you join a game on the local server as a tiny Compsognathus. Bots keep every room at 16 dinosaurs and make way as players join. Open a second tab, or a phone on the same Wi-Fi (see below), to play against yourself. If the server can't be reached, the game tells you and you play offline against bots instead.

- Eat meat lying about just by running into it: scraps (+1), cuts (+3) and haunches (+8). Critters (+4) run away, but tire quickly.
- Bite (left click) any dinosaur with a green ring: its carcass ends up in your mouth, worth 70% of its mass. Hold E to eat it. Bite a dinosaur your own size and you shove it, knocking its food loose.
- Run from red rings: they can bite you.
- Watch for world events: huge carcasses and meat drops, announced at the top of the screen and marked on the minimap. Everyone goes for them.
- Danger zones (the volcano's slopes and the ground round the tar pits, red on the minimap) are piled with meat worth 4–5× more, glowing gold, mostly big cuts and haunches: a haunch on the volcano is worth 40 scraps. Events there are bigger too. The bots mostly stay away.
- Bigger dinosaurs are a little faster, so a lead keeps growing. Small ones turn tighter and can hide.
- Small dinosaurs can hide in ferns. At 40 mass you evolve into a Velociraptor.
- From the Velociraptor on, Q uses your species' ability:
  - Velociraptor: **Pounce**, a leap forward (6 s cooldown).
  - Dilophosaurus: **Spit** at whatever is in front of you: it blurs their view for 2 s (8 s).
  - Allosaurus: **Charge**, fast and hard to steer, barging smaller dinosaurs aside and knocking their food loose (10 s).
  - T-Rex: **Roar**, stunning every smaller dinosaur nearby for 1.5 s and making them drop their food (12 s).
  - The bots use them too.
- If you're caught, you hatch again 3 seconds later.
- Each round lasts 20 minutes. For the last two the meteor is coming, and whoever is biggest when it hits wins. Then everyone starts again.
- M turns the sound off and on.

| Device  | Controls                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop | W or ↑ to run, A/D or ←/→ to turn, S or ↓ to stop, Shift to sprint; or hold the right mouse button to steer. Left click (or Space) to bite, hold E to eat, Q for your ability, M for sound |
| Phone   | Drag anywhere on the left half of the screen (a joystick appears under your thumb); Sprint, Bite and Eat buttons on the right                                                              |
| Any     | F3 opens the debug overlay: FPS, draw calls, ping and entity counts                                                                                                                        |

Sprinting is 1.6× faster and runs on stamina (the yellow bar): about 4 seconds of it, refilling once you ease off.

URL options for trying things out:

- `?name=Rex` picks your name.
- `?room=friends` puts everyone who uses the same word in the same room.
- `?offline` plays the single-player sandbox in the browser, with no server.
- `?seed=42` gives a fixed island layout and spawn point.
- `?bots=0` empties the island (up to 29).
- `?mass=1600` starts you as a T-Rex (offline only).
- `?round=30` plays 30-second rounds, to see the meteor and podium quickly.
- `?debug` opens the overlay.
- `?quality=low|medium|high` overrides the graphics preset.

Online, `?seed=`, `?bots=` and `?round=` only work against the test server that `pnpm dev` runs (they're ignored by `pnpm start`), and only for the player who creates the room.

While `pnpm dev` runs, http://localhost:5173/dev/dinos.html shows every tier's dinosaur side by side (`?pose=run|bite|roar|dead|carry` tries the animations).

To change ports or point the client at another server, copy `.env.example` to `.env` and edit it.

**Testing on a phone on the same Wi-Fi:** run the two halves separately and expose the client to your network:

```bash
pnpm --filter @extinct/server dev
pnpm --filter @extinct/client dev --host   # open the "Network" URL it prints on your phone
```

## Commands

| Command                             | What it does                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Client (Vite, hot reload) and game server (restarts on change) together                     |
| `pnpm check`                        | Format check, lint, type-check and unit tests. Run it before committing                     |
| `pnpm test`                         | Unit tests (Vitest) for `shared`, `server` and `client`                                     |
| `pnpm test:e2e`                     | Browser smoke tests (Playwright) on desktop and mobile Chromium. Starts `pnpm dev` itself   |
| `pnpm lint`                         | ESLint with type-aware rules                                                                |
| `pnpm typecheck`                    | TypeScript in strict mode across every package                                              |
| `pnpm format` / `pnpm format:check` | Prettier                                                                                    |
| `pnpm build`                        | Production build of the client into `client/dist`                                           |
| `pnpm start`                        | Game server without watch mode (and without test commands)                                  |
| `pnpm loadtest`                     | Joins 30 headless players to the running game server and reports whether it held 20 ticks/s |

Before running browser tests for the first time on a new machine, install the test browser with `pnpm exec playwright install chromium`.

CI (GitHub Actions) runs the format check, lint, type-check, unit tests, build and browser smoke tests on every push.

## Project layout

```text
client/          Three.js + Vite browser client
  game/          the game loop, drawing a session: offline (the shared simulation
                 in the browser) or online
  input/         keyboard, mouse and touch steering, and sprint
  render/        terrain, water, sky and clouds, plants and props, meat, critters,
                 carcasses, vents, threat rings, event beacons, the meteor, particles,
                 pterosaurs, bloom, dinosaurs (dino/) and the camera
  audio/         synthesised sound effects and ambience (Web Audio)
  net/           the online session: joining, prediction and interpolation
  ui/            HUD, round clock, leaderboard, minimap, podium, banners, kill feed,
                 death card, name tags, debug overlay, hints and styles
  dev/           developer pages (not shipped)
server/          Colyseus game server: authoritative simulation
  rooms/         the game room: inputs, ticks, bots, interest filtering, events
  testing/       a headless test client and the load test
shared/          rules and constants used by both sides
  config.ts      every tuning number
  net.ts         the network protocol: room name, inputs, events, synced shapes
  movement.ts    the movement step, with stamina sprinting, carrying and pushes
  eating.ts      the eat rule, bites, carcass eating and threat colours
  visibility.ts  fern hiding
  tiers.ts       tiers and body scale
  sim/           the game simulation: world, bots, rounds, vents and entity types
  world/         the island: layout, danger zones, terrain heights and effects
e2e/             Playwright browser tests
```

Everything you see and hear is made in code: low-poly models built at load time and sounds synthesised in the browser, so there are no art or audio files to download or license.

## Docs

- [BUILD_PROMPT.md](BUILD_PROMPT.md): the brief, rules, numbers and milestones.
- [CLAUDE.md](CLAUDE.md): conventions for working on the code, for people and Claude Code alike.
- [CHANGELOG.md](CHANGELOG.md): what each milestone added.
- [CREDITS.md](CREDITS.md): third-party assets, libraries and licences.
