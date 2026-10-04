# Changelog

One entry per milestone (BUILD_PROMPT.md §9), newest first.

## M2: Core rules offline (2026-10-04)

### Added

- **The eat rule.** A dinosaur at least 1.2× the mass of another eats it as soon as its bite zone touches the other's body, and gains 70% of its mass. Bites and bodies are compared on the ground, so a T-Rex can still eat a Compsognathus. The biggest dinosaurs bite first, so nobody is eaten twice in one tick.
- **Death and respawn.** An eaten dinosaur hatches again as a tier 1 dinosaur after 3 s. It hatches at the safest of a few random spots, at least 30 units from anything that could eat it when possible. Spawn protection then lasts 3 s: it can't eat other dinosaurs or be eaten, shown by a pulsing blue glow.
- **Sprint.** Shift on desktop, or the Sprint button on phones, gives 1.6× speed. It costs 1.5% of mass per second (never below 10). The burnt mass falls behind as meat chunks worth +2 that anyone can eat. Meat rots after 30 s, and the island holds at most 300 chunks.
- **Critters.** 24 small proto-mammals worth +4. They wander, then bolt in a zigzag from any dinosaur that comes close.
- **Terrain effects.** The river slows dinosaurs to 0.7× and tar pits to 0.5×. Five steam vents on the volcano erupt in turn every 10 s. Each one glows, and a warning ring shows its blast radius first, then it throws nearby dinosaurs clear with a steam plume.
- **Fern hiding.** Tier 1–2 dinosaurs in a fern patch are invisible to anyone more than 10 units away. This applies to bots too, and the shared `canSee` rule is ready for the server to filter with in M3.
- **Bots.** 15 bots by default (`?bots=N` changes it) that wander, look for food, hunt smaller dinosaurs and flee bigger ones. Small bots flee into ferns. They're deliberately imperfect:
  - They react only every 200–500 ms, and skilled bots react faster.
  - Every bot has its own skill level, which also sets how sharply it steers and how far ahead it spots tar pits.
  - They misjudge food, steer with a wobble, get distracted, and give up long chases.
- **Readability.**
  - Rings under every other dinosaur show the threat: red can eat you, green you can eat, pale neither.
  - Name tags are tinted to match.
  - A kill feed shows who ate whom.
  - A death card says who ate you and how big you got, while the camera follows the dinosaur that ate you.
  - HUD chips show spawn protection, hiding, sprinting and wading.
- **Game feel.** Bite animations for every dinosaur, plus a camera punch and a short hitstop when you eat a dinosaur. Nearby vent eruptions jolt the camera.
- **Shared simulation.** `GameWorld` now runs every rule above, deterministically from a seed, and reports events (`dinoEaten`, `meatDropped`, `ventErupted`, `tierChanged`, ...) for effects and, later, network messages. New shared modules: `eating.ts`, `visibility.ts`, `sim/bots.ts`, `sim/entities.ts`, `sim/names.ts` and `sim/vents.ts`.
- **Debug hooks.** `window.__extinct` adds `bots()`, `placeDinoAhead()`, `teleport()` and `endProtection()`. `state()` now reports being alive, protection, sprinting, hiding and meat.
- **Tests.**
  - 89 unit tests. They cover the eat rule, tier thresholds, the speed curve, sprinting, meat, critters, vents, fern hiding and bot behaviour.
  - A 5-minute simulation with 16 bots checks that the world stays valid every second and that it replays exactly from the same seed.
  - New Playwright tests for sprinting (keyboard and touch), eating a dinosaur, threat colours, being eaten and respawning, and hiding in ferns.

### Changed

- `tierChanged` replaces the `evolved` event and also reports a drop in tier, which sprinting can cause.
- Browser tests run on an island with no bots unless a test asks for them.

### Fixed

- A production build with no game server configured (no `VITE_SERVER_URL`) no longer checks for one every 5 seconds. The debug overlay shows "Server: none (offline build)" instead, so static previews of the single-player game run without network errors.

### Known issues

- Dinosaurs pass through each other (and through trees and rocks) when neither can eat the other.
- Spawn protection blocks eating other dinosaurs but not food. The brief says protected dinosaurs "can't eat or be eaten"; we read that as being about dinosaurs, so food stays edible.
- The steam plume, vent mounds, meat and critters are placeholders until the art pass (M5).
- The death card has no rank or Play Again button yet. Those arrive with the leaderboard and round loop in M4.

## M1: Single-player sandbox (2026-10-03)

### Added

- **The island.** A deterministic heightmap in `shared/world/`: a beach ring, jungle to the west and north, open plains to the south-east, a central volcano with a lava crater, a river to the east coast, tar pits and fern patches. It's drawn as flat-shaded low-poly terrain with vertex colours, under a gradient sky with fog, with one sea-and-river water plane.
- **Instanced props.** Trees, palms, rocks, ferns and eggs, each drawn in one instanced draw call.
- **Placeholder dinosaurs for all five tiers.** Procedural skinned low-poly bodies with a head, tail and jointed legs, plus a walk cycle, tail sway, idle look-around and a bite animation. Colour and proportions vary by species.
- **Third-person camera.** An over-the-shoulder spring arm that swings in behind the dinosaur and pulls back as it grows. It shortens instead of clipping into hills, widens on portrait screens, and punches on bites and evolutions.
- **Controls.** WASD or the arrow keys, holding the mouse button to steer, and a touch joystick on the left half of the screen.
- **Shared simulation (`GameWorld`), which the server will run in M3:**
  - A deterministic movement step with the brief's speed curve, a matching turn-rate curve, acceleration and island bounds.
  - Eating eggs from a bite zone at the snout. Each egg gives +1 mass and respawns elsewhere after 3 s.
  - Growth with mass^(1/3), plus a size jump at every evolution.
- **Rendering setup.** One sun with shadows limited to the area around the player. Automatic quality presets (high on desktop, medium on touch devices), with `?quality=low|medium|high` to override.
- **UI.**
  - A HUD with species, mass and progress to the next tier.
  - A controls hint that fades out.
  - The F3 debug overlay, showing FPS, CPU time per frame, draw calls, triangles, ping and entity counts.
- **Testing hooks.** URL options `?seed=`, `?mass=` and `?debug`, a `window.__extinct` hook, and the `/dev/dinos.html` viewer showing every tier's placeholder side by side.
- **Tests.**
  - 50 unit tests covering movement, tiers, terrain, the egg simulation, steering and quality presets.
  - Playwright tests for start-up, F3, keyboard, mouse and touch control, eating and evolving.

### Changed

- The M0 boot scene and title card are gone: the page opens straight into the sandbox. The server status moved into the debug overlay.
- Playwright opts in to software WebGL explicitly, because test machines have no GPU.

### Known issues

- Trees and rocks are decoration only: dinosaurs and the camera pass through them.
- On machines without a GPU (CI and cloud sessions), the frame rate is software-rendered and isn't meaningful. Check FPS with F3 on real hardware.

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
