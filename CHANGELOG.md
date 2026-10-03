# Changelog

One entry per milestone (BUILD_PROMPT.md §9), newest first.

## Unreleased

### Fixed

- A production build with no game server configured (no `VITE_SERVER_URL`) no longer checks for one every 5 seconds. The debug overlay shows "Server: none (offline build)" instead, so static previews of the single-player game run without network errors.

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
