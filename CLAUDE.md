# CLAUDE.md

Conventions for working on EXTINCT.io. The brief, rules, numbers and milestone plan are in `BUILD_PROMPT.md`: read it before starting a milestone, and do one milestone at a time. Some rules have since changed at the user's request; see "Rule changes since the brief" below, which wins where they differ.

## Commands

```bash
pnpm install
pnpm dev                     # client http://localhost:5173 + game server http://localhost:2567
pnpm check                   # format check, lint, type-check, unit tests: run before every commit
pnpm build                   # production client build (CI runs it too)
pnpm test:e2e                # Playwright smoke tests; starts `pnpm dev` itself (or reuses a running one locally)
pnpm loadtest                # 30 headless players against the running server (`pnpm dev`)
pnpm vitest run --project server        # one test project (shared | server | client)
pnpm vitest run shared/config.test.ts   # one test file
pnpm format                  # fix formatting
```

## Architecture

- **pnpm monorepo** with `client/`, `server/` and `shared/`. Source sits directly in each package folder (no `src/`), so paths match the brief: `shared/config.ts`, `client/render/`, `server/systems/`.
- **`shared/`** is pure TypeScript game logic and constants used by both sides. No DOM, Node, Three.js or Colyseus imports (ESLint enforces this). Keep it deterministic, because the same code runs on the server and in client-side prediction. Import it as `@extinct/shared`; `shared/index.ts` re-exports everything.
  - `config.ts`: gameplay and network tuning.
  - `movement.ts`: `PlayerInput` (turn, throttle, sprint, bite, eat) and `stepLocomotion`, one tick of a dinosaur's movement: stamina (`stepStamina`), then `stepMotion` (sprint, terrain, carrying and eating slowdowns, pushes). Also the speed and turn-rate curves. `sanitizeInput` makes untrusted input safe.
  - `eating.ts`: the eat rule (`outweighs`, bite zones, the wider `attackZone` of an aimed bite, `massGained`), carcass eating (`eatRate`, `canCarry`) and threat colours (`threatBetween`).
  - `visibility.ts`: fern hiding (`isHiddenInFerns`, `canSee`). Bots perceive through it, and the server will filter what clients receive with it.
  - `tiers.ts`: tier lookup and body scale.
  - `sim/world.ts`: `GameWorld`, the whole simulation: dinosaurs and bots, scraps, meat, critters, vents, bites, carcasses (carried or on the ground), eating, death, respawn, spawn protection, world events (`happenings`: huge carcasses and meat drops) and the round loop with its podium. It also keeps each dinosaur's leaderboard `rank`. `step()` returns events (`dinoKilled`, `bite`, `tierChanged`, `happeningStarted`, `meteorImpact`, `roundStarted`, ...) for effects and network messages. Seeded, so the same seed and inputs replay exactly.
  - `sim/round.ts`: round timings and phases (`playing`, `impact`, `podium`), shared by the world, the server and the HUD.
  - `sim/entities.ts`: the entity and event types. `sim/bots.ts`: bot brains (`botInput`), which steer, bite and eat. `sim/vents.ts`: the vent clock. `sim/names.ts`: bot names and event carcass species.
  - `world/layout.ts`: level design, meaning where the volcano, vents, river, tar pits, fern patches and danger zones (the Ashlands and the Tar Pits) are.
  - `world/terrain.ts`: island heights and zones, including `terrainSpeedFactor`, `dangerZoneAt` and `foodMultiplierAt`. `islandHeightfield()` is built once; `heightAt()` matches the rendered triangles exactly.
  - `net.ts`: the network protocol shared by server and client: the room name, join options, wire inputs (`toWireInput` / `fromWireInput`), event messages, test commands, `cleanName`, the codes that kinds and zones travel as, and the shapes of the synced state (`NetDino`, `NetCarcass`, `NetRound`, ...).
- **`server/`** is the authoritative Colyseus 0.18 server. `index.ts` is the entry point. `app.ts` builds the server without binding a port, so tests can start it on port 0, and serves `/health` and `/stats`. `env.ts` loads the repo-root `.env`. Clients only ever send inputs. Never trust a position sent by a client.
  - `rooms/GameRoom.ts`: one game room. It runs `GameWorld` on Colyseus' fixed timestep, takes one input per player per tick from the input buffer (a late packet's repeat never repeats a bite), tops the room up with bots, mirrors the world into the schema, filters each client's `StateView` by distance and fern hiding (a carcass in a hidden dinosaur's mouth stays hidden too), and sends events. The round, the leaderboard and world events go to everyone. `TestGameRoom` adds the test commands.
  - `rooms/schema.ts`: the synced state, built with `schema()`. A compile-time check keeps it in line with the `Net*` shapes in `shared/net.ts`.
  - `testing/`: `harness.ts` (start a server on a free port, `TestClient`, `waitFor`) and `loadTest.ts`. `loadtest.ts` is the `pnpm loadtest` command.
  - `--test-commands` (passed by `pnpm dev`, never by `pnpm start`) makes the server honour test commands and the `seed`, `bots` and `roundSeconds` join options.
- **`client/`** is Three.js + Vite, with no game engine. `assets/` and `audio/` come later.
  - `game/Game.ts`: the game loop. It samples input, advances a `Session` (`game/session.ts`), turns its events into effects and renders it. A session is either `game/OfflineSession.ts`, which steps `GameWorld` (with bots) in the browser at `NETWORK.tickRate` and interpolates between ticks (`poseHistory.ts`), or `net/OnlineSession.ts`.
  - `input/`: keyboard, held-mouse and touch-joystick steering, plus sprint (Shift or the touch button). The pure mappings live in `steering.ts`, so they can be unit tested.
  - `render/`:
    - `loft.ts`: `MeshBuilder`, which lofts low-poly organic shapes (bodies, tails, fronds) from rings along a path, with flat colours and optional skinning. Every model is built with it at load time.
    - `dino/`: `species.ts` (each tier's anatomy, colours and features), `dinoModel.ts` (a 17-bone skinned model per species, one draw call each), `DinoView.ts` (procedural idle, walk, run, bite, chew, carry and roar), `corpse.ts` (a kill's limp body, on the ground or in a killer's jaws) and `crowd.ts`.
    - `terrain.ts` (ground, lava streams, tar and lava pools), `water.ts` (depth-coloured sea with surf), `vegetation.ts` (plants, rocks, dead trees and skeletons, instanced and split into patches so the GPU can skip those out of view; plants dissolve near the camera so they never hide the player), `food.ts` (meat in three sizes, gold-ringed in the danger zones), `carcasses.ts` and `herbivores.ts` (event carcasses), `critters.ts`, `threatRings.ts`, `beacons.ts`, `vents.ts`, `meteor.ts`, `effects.ts` (sparks, gore, dust, smoke and rings), `pterosaurs.ts`, `environment.ts` (sky with sun glow, clouds, fog, sun shadows that follow the player, and `setDoom` for the red meteor sky), `post.ts` (bloom on the high preset), `cameraRig.ts` (with punch, shake and rumble) and `quality.ts`.
  - `audio/audio.ts`: `SoundBoard`, every sound synthesised with Web Audio (chomps, bites, kills, footsteps, roars, events, vents, the meteor, wind and birds). It starts on the first click or key press; M mutes it.
  - `ui/`: HUD with status chips and the stamina bar, round clock, leaderboard, minimap, podium, banners, name tags, kill feed, death card, F3 debug overlay, controls hint and CSS.
  - `net/`: `connect.ts` joins a room (or times out, and `main.ts` falls back to offline play). `OnlineSession.ts` sends inputs, predicts your own dinosaur with Colyseus' `Predict` reconciler and the shared step function, and interpolates everything else.
  - `dev/`: developer pages that aren't part of the build, e.g. `/dev/dinos.html`.
- **Multiplayer:** the client sends one input per tick (turn, throttle, sprint; abilities come in M6), as small integers. The server simulates at `NETWORK.tickRate`, consumes one input per player per tick, and sends a patch after every tick, filtered to `NETWORK.interestRadius` with fern hiding enforced there. The client predicts its own dino with the shared step function and reconciles against the server. Other dinos are interpolated `NETWORK.interpolationDelayMs` in the past.
  - The server and the client's prediction both move dinosaurs with `stepLocomotion`, so they agree. Anything it reads (stamina, carrying, mass) must be in `PREDICTED_FIELDS` in `OnlineSession.ts`. Prediction also stands still while the round is frozen.
  - Headings are continuous (never wrapped), so interpolation and reconciliation don't see 2π jumps.
  - Colyseus pitfall: set `patchRate = null` after `setFixedTimestep`, never before, or a second clock starves the fixed timestep.

## Rule changes since the brief

Asked for after M3 and M4, because progression felt slow and the bots too strong. These override `BUILD_PROMPT.md` §1, §3, §7 and §8:

- **Eating dinosaurs takes a bite**, not contact: left click (or Space, or the Bite button) kills anything 1.2× smaller in reach. Its carcass (70% of its mass) goes in your mouth; hold E (or the Eat button) to eat it. Biting a dinosaur too close in size to kill shoves it and knocks its food loose.
- **Sprinting runs on stamina**, not mass, and drops no meat. Meat now comes from world events.
- **Mouse steering uses the right button**, since the left one bites. E eats, so the M6 ability needs another key.
- **World events and danger zones** were added: huge carcasses and meat drops on a timer, and zones where food is worth 3–4× more.
- **Critters and fleeing bots are easier to catch** than the brief's numbers made them.
- **Rounds last 20 minutes**, with the meteor warning for the last two.
- **Bigger dinosaurs are a little faster** (speed grows with mass ^ 0.06, up to 13), so a lead snowballs. Small ones keep tighter turning and the ferns.
- **Meat replaces eggs.** Food lying about is meat in three sizes, scraps (1), cuts (3) and haunches (8). A share of it always lies in the danger zones, mostly big pieces, worth 4–5× and slower to come back. Food is eaten on contact even with a carcass in your mouth.
- **Bots are much weaker**: slow to react, lazy hunters that never sprint after prey and soon give up, wary of the danger zones, and once past `BOTS.maxHuntingMass` they stop hunting altogether. The top of the leaderboard is for players.
- **A kill is drawn as the victim's limp body** in the killer's jaws (or lying on its side), not a slab of meat. World-event carcasses are dead plant-eaters with their ribs showing.
- **Everything is made in code.** The dinosaurs, plants and props are procedural low-poly models with procedural animation, and every sound is synthesised with Web Audio, instead of the brief's GLB models and Howler.js samples: the asset sites are unreachable from cloud sessions, and this keeps the download tiny and the licensing simple.

## Conventions

- **TypeScript strict everywhere.** No `any`; the type-aware lint rules catch it. Use `import type` for type-only imports.
- **Tuning numbers live in `shared/config.ts`.** That covers every gameplay, network, camera and control-feel number: grouped `as const` objects with a one-line note each. Level design (positions and sizes of landmarks) lives in `shared/world/layout.ts`. Art (colours, shapes) stays next to the rendering code. Purely technical constants, like a fetch timeout, can be named constants next to the code that uses them.
- **Units and directions:**
  - The island is centred on the origin, with +y up.
  - A heading of 0 faces +z, and increasing heading turns left (counter-clockwise seen from above); `object.rotation.y = heading` lines a model up.
  - `turn` input runs from -1 (full right) to 1 (full left).
  - Sizes such as the bite zone, camera distances and models are in body scales (1 = a newly spawned dinosaur); `scaleForMass` turns mass into scale.
- **Use explicit `.ts` extensions in relative imports** (`import { x } from './y.ts'`). Node runs `server/` and `shared/` directly with its built-in TypeScript support (no build step) and needs them. Do the same in `client/` for consistency.
- **Erasable syntax only** (`erasableSyntaxOnly`). Node strips types but can't compile, so use no enums (use `as const` objects with union types), namespaces, parameter properties or decorators. Define Colyseus state with `@colyseus/schema`'s `schema()` / `t` builders, not `@type()` decorators.
- **Tests:** Vitest unit tests sit next to the code as `*.test.ts`; browser tests go in `e2e/`. New logic in `shared/` and `server/` comes with tests. Never skip or disable a failing test to get green.
- **Browser tests run without a GPU** (in CI and cloud sessions), so Chromium renders in software at roughly 4–12 FPS.
  - Never make an e2e test depend on wall-clock durations. Hold an input until the game state changes, with `holdUntil` and `waitForState` from `e2e/game.ts`. Tests open an island without bots unless they ask for some (`openGame(page, '&bots=1')`).
  - One round trip to a software-rendered page can take seconds, so short-lived interface (the 3-second death card, kill feed lines) can come and go between two polls. Read it inside the page on the frame it appears with `captureFrames`, started before you trigger the event.
  - Frame rates measured there mean nothing. Judge performance by the overlay's CPU time, draw calls and triangles, and check FPS on real hardware.
  - Anything integrated over frame time must stay stable at long frames: frames are clamped to 0.25 s, and springs are sub-stepped (see `cameraRig.ts`).
- **Debug hooks:**
  - URL options: `?offline` (the sandbox, no server), `?name=`, `?room=` (a room of its own), `?seed=` (repeatable island and spawn), `?bots=` (offline default 15), `?mass=` (offline only), `?round=` (round length in seconds), `?debug` (open the F3 overlay) and `?quality=low|medium|high`. Online, only a test server honours `?seed=`, `?bots=` and `?round=`, when they come with the join that creates the room.
  - Most browser tests play offline (`openGame` adds `?offline`), on the medium preset (`openGame(page, query, { quality: 'auto' })` lets the game choose, as the smoke and performance tests do). `openOnlineGame(page, { room, name })` joins the dev server instead, in a room of its own.
  - `window.__extinct` provides `state()`, `others()`, `stats()`, `triangleBreakdown()`, `bots()`, `leaderboard()`, `podium()`, `carcasses()`, `setMass()`, `placeScrapAhead()`, `placeDinoAhead()`, `teleport()`, `endProtection()` and `startEvent()` for tests and the console. Online, `setMass()`, `teleport()`, `endProtection()` and `startEvent()` become test commands, which only a server started with `--test-commands` (`pnpm dev`) obeys. Production servers ignore them. `placeScrapAhead()`, `placeDinoAhead()` and `bots()` are offline only.
  - To bite something in a browser test, place a bot that stands still (`placeDinoAhead(page, mass, distance, facing, side, true)`) and `clickToBite(page)`: a live bot runs off before a slow page's click lands.
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
