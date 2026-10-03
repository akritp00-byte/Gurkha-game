# EXTINCT.io: build prompt for Claude Code

A third-person 3D browser .io game: eat smaller dinosaurs, evolve, and survive until the meteor hits. "EXTINCT.io" is a working title.

## Part A: setup (for you, before you start)

### 1. Create the repo

- Create an empty GitHub repository (for example `extinct-io`) and clone it.
- Save this file in the repo root as `BUILD_PROMPT.md`.
- Add the `.mcp.json` below to the repo root, so every Claude Code session on this project gets the same tools.

### 2. Tools (MCP servers): what's needed and why

| MCP server     | Needed?         | Why                                                                                                                                                   |
| -------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright MCP | Yes             | Lets Claude open the game in a real browser, play it, take screenshots and read console errors. Without it, Claude is building a 3D game blind.        |
| Context7       | Recommended     | Pulls current documentation for Three.js and Colyseus, which change between versions. Stops Claude writing code against outdated APIs.                |
| GitHub MCP     | Optional        | Claude Code can already use git and the `gh` command line. Only add it if you want Claude to manage issues and pull requests for you.                 |
| Blender MCP    | Later, optional | Only if dinosaur models need cleaning up or re-rigging in Blender. Needs Blender installed on your machine. Skip until milestone 5.                    |

Not needed: database MCPs (there are no accounts in this build) and Figma (the UI is simple).

Project-level config. Save as `.mcp.json` in the repo root:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    },
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```

Or add them from the terminal:

```bash
claude mcp add playwright npx @playwright/mcp@latest
claude mcp add --transport http context7 https://mcp.context7.com/mcp
```

Run `/mcp` inside Claude Code to check both show as connected. Check the Context7 address against its own setup page before using it.

### 3. Where to run it

- **Locally** (`claude` in the repo folder): best for milestones 1, 3 and 5, where Claude needs to see the game in a browser.
- **Cloud sessions** (your bonus credit): good for parallel work once the multiplayer foundation exists (see "Parallel work" below). Push to GitHub before starting a cloud session, because it works from your GitHub branch. If browser testing isn't available in a cloud session, do the visual checks locally.

### 4. Kick-off message

Start Claude Code in the repo and send:

> Read BUILD_PROMPT.md fully. Then do Milestone 0 only, and stop with a summary when its acceptance checks pass.

Then go one milestone at a time: "Do Milestone 1", and so on.

## Part B: the build prompt (for Claude)

You are the lead engineer on EXTINCT.io, a multiplayer third-person 3D browser game in the style of slither.io and agar.io, with dinosaurs. Build it milestone by milestone, following this document. Optimise for game feel, clarity and performance: it must look great and run smoothly on a mid-range phone.

### 1. The game in one paragraph

Every player starts as a tiny dinosaur on a prehistoric island. You grow by eating eggs, critters and any dinosaur smaller than you, and you evolve through five species as you grow. Bigger dinosaurs are stronger but slower and easier to spot, so small players survive by hiding in ferns and outmanoeuvring. Each round lasts five minutes and ends with a meteor strike. Whoever is biggest at impact wins the round.

### 2. Design pillars

- **Readable in 5 seconds.** Eat smaller, avoid bigger. The size difference must be obvious at a glance, so colour enemies by threat: red if they can eat you, green if you can eat them, neutral otherwise.
- **Growth feels amazing.** Every evolution is an event: a visual effect, a sound, a camera pull-back, a new model.
- **Small players always have a chance.** Speed, ferns, tight turns and cave terrain favour the small.
- **Every round has a climax.** The meteor finale.

### 3. Rules and numbers

All tuning values live in `shared/config.ts`. Never hard-code them elsewhere.

**Mass and tiers** (starting mass 10):

| Tier | Species       | Mass range | Ability (milestone 6)                                                |
| ---- | ------------- | ---------- | -------------------------------------------------------------------- |
| 1    | Compsognathus | 10–39      | none (fastest, tightest turning)                                     |
| 2    | Velociraptor  | 40–149     | Pounce: short dash, 6s cooldown                                      |
| 3    | Dilophosaurus | 150–499    | Spit: blurs the target's screen for 2s, 8s cooldown                  |
| 4    | Allosaurus    | 500–1,499  | Charge: knocks smaller dinos aside, 10s cooldown                     |
| 5    | T-Rex         | 1,500+     | Roar: stuns smaller dinos within a radius for 1.5s, 12s cooldown     |

**Eating**

- You can eat a dinosaur if your mass is at least 1.2× theirs and their body overlaps your bite zone (a sphere at your snout).
- Eating is automatic on contact, with no bite button. Play a bite animation and a short hitstop (a brief freeze for impact).
- The eater gains 70% of the victim's mass.
- Food: eggs (+1), meat chunks (+2, dropped by sprinting players) and small fleeing critter NPCs (+4).

**Movement**

- Speed = 9 × (10 / mass)^0.18, never lower than 4.5. Turn rate falls with mass on a similar curve.
- Sprint: 1.6× speed, but costs 1.5% of your mass per second (never below 10), dropping meat chunks behind you that anyone can eat.
- Scale grows with mass^(1/3) within a tier, with a visible jump on each evolution.

**World**

- A circular island about 300 units across: jungle with fern patches, open plains, a river, tar pits and a central volcano.
- Ferns: tier 1–2 dinos inside a fern patch are hidden from players more than 10 units away. The server simply doesn't send them, so this can't be bypassed by cheating.
- River: 0.7× speed. Tar pits: 0.5× speed. Volcano vents: periodically knock players back.

**Round loop**

- Rounds last 5:00. At 4:00 the meteor warning starts: the sky turns red, the ground rumbles, small debris falls.
- At 5:00 the meteor hits: a 3-second impact sequence, then the winner is whoever has the most mass, shown on a podium screen. The next round starts after 10 seconds, with everyone reset.
- If you're eaten mid-round, you respawn as a tier 1 dino after 3 seconds, with 3 seconds of spawn protection (you can't eat or be eaten).

**Rooms and bots**

- Up to 30 players per room. Bots keep every room at 16 or more dinosaurs and leave as real players join.
- Bot behaviour: wander, look for food, hunt smaller dinos, flee bigger ones. Give them human-like flaws, such as a 200–500ms reaction delay and imperfect steering, plus a spread of skill levels. Bots must never feel perfect.

### 4. Tech stack (use unless there's a strong reason not to, and explain any change)

- Monorepo with pnpm workspaces: `client/`, `server/`, `shared/`. TypeScript in strict mode everywhere.
- **Client:** Three.js and Vite. No game engine.
- **Server:** Node with Colyseus for rooms and state sync.
- **Shared:** game constants, the movement step function (used by both client and server), the eat rule and tier logic.
- **Tests:** Vitest for shared and server logic; Playwright for browser smoke tests and screenshots.
- **Audio:** Howler.js.
- **CI:** GitHub Actions running lint, type-check and tests on every push.

Use Context7 to check current Three.js and Colyseus APIs before writing code against them.

### 5. Multiplayer architecture

- **The server is in charge:** it simulates at 20 ticks per second and decides all movement, eating and mass. Clients only send inputs (sequence number, direction, sprint, ability). Never trust positions sent by a client.
- **Your own dino:** the client predicts movement using the shared step function, then corrects itself against the server's state.
- **Other dinos:** interpolate with about a 100ms buffer so they move smoothly.
- **Only send what's nearby:** each client receives entities within about 120 units, plus the top-10 leaderboard and coarse minimap dots. Fern hiding is enforced here.
- **Basic anti-cheat:** the server caps speed and rate-limits inputs.
- **Load target:** 30 clients plus bots per room at 20 ticks per second, without the server falling behind.

### 6. Visual direction ("good graphics" on a phone budget)

- **Style:** bright, stylised low-poly. Think a premium mobile game, not realism. Gradient or toon lighting, soft shadows, atmospheric fog and a gradient sky that turns apocalyptic red during the meteor phase.
- **Rendering:** one directional light with limited shadow distance; plants, eggs and rocks drawn with instancing (one draw call for many copies); a heightmap terrain with vertex colours; a simple stylised water shader; subtle bloom and colour grading; FXAA anti-aliasing.
- **Camera:** third-person over-the-shoulder on a spring arm, pulling back as you grow and never clipping into terrain. Add a camera punch on bites and evolutions.
- **Juice:** dust trails when sprinting, bite particles, an evolution burst, screen shake scaled by size, footstep thumps that get heavier with size.
- **Performance budget:**
  - 60fps on desktop and at least 45fps on a mid-range phone.
  - Under 150 draw calls and under 500k triangles on screen.
  - Initial download under 15MB, using compressed GLB models (meshopt) and KTX2 textures.
  - Automatic quality presets, plus a manual setting.
  - Add a debug overlay, toggled with F3, showing FPS, draw calls, ping and entity count.

### 7. Assets

- **Placeholder dinos from milestone 1.** Build each one procedurally (capsule body, head, tail, legs with a walk bob, colour per tier) so nothing is blocked waiting for art.
- **Final dinos (milestone 5):** rigged, animated, low-poly GLB models per tier, with at least idle, walk, run, bite, roar and death animations. Sources: free CC0 packs, or paid packs. Ask me before buying anything. Record every asset, its source and its licence in `CREDITS.md`.
- **Sound:** CC0 or properly licensed only, also recorded in `CREDITS.md`.

### 8. Interface

- **Landing screen:** game logo, name field, colour picker, Play button.
- **In-game HUD:** mass and progress to the next tier, ability cooldown, round timer, top-10 leaderboard, minimap, kill feed.
- **When you're eaten:** who ate you, your rank, mass reached, and a Play Again button.
- **End of round:** a podium for the top 3 and a countdown to the next round.
- **Controls:**
  - Desktop: WASD or mouse-steer (player's choice), Shift to sprint, E for the ability.
  - Mobile: virtual joystick on the left; sprint and ability buttons on the right.
- **Settings:** graphics quality, volume, camera sensitivity, control scheme.

### 9. Milestones

Do one milestone at a time. At the end of each:

1. Run all tests.
2. Use Playwright MCP to open the game, play it briefly, take screenshots and check the browser console for errors.
3. Add an entry to `CHANGELOG.md`.
4. Commit.
5. Stop and give me a short summary: what works, screenshots, known issues, what's next.

| #   | Milestone                                                                                                                                                                  | Done when                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0  | Project setup: monorepo, TypeScript strict, lint and format, Vitest, Playwright, CI, `README.md`, `CLAUDE.md` (project conventions), `CREDITS.md`, `.env.example`          | `pnpm dev` runs client and server together; CI passes                                                                                                   |
| M1  | Single-player sandbox: island terrain, third-person camera, placeholder dino moving with keyboard, mouse and touch, eggs to eat, growing on eating                          | Screenshot shows a dino on the island; no console errors; 60fps in the debug overlay                                                                    |
| M2  | Core rules offline: mass, tiers, eat rule, sprint and meat drops, fern hiding, terrain effects, bots running in the browser                                                | Unit tests cover the eat rule, tier thresholds and speed curve; a 5-minute bots-only simulation runs without errors                                     |
| M3  | Multiplayer: Colyseus room, server in charge, prediction and smoothing, nearby-only updates, bots on the server, joining, leaving, respawning                              | Playwright with two browser tabs: each sees the other move, and one eats the other; a load test with 30 headless clients holds 20 ticks per second      |
| M4  | Round loop: timer, meteor warning and impact sequence, leaderboard, podium, reset                                                                                          | A full round completes and the correct winner is shown                                                                                                  |
| M5  | Art pass: animated dino models per tier, evolution effect, props, lighting, sky, water, meteor effects                                                                     | Screenshots of every tier; performance budget met in Playwright mobile emulation                                                                        |
| M6  | Abilities, audio and juice                                                                                                                                                 | Each ability works in multiplayer; sound for every key event                                                                                            |
| M7  | Interface polish: mobile controls, settings, first-time tips                                                                                                               | Fully playable on a phone-sized screen; settings persist                                                                                                |
| M8  | Deployment: Dockerfile, hosting config (static client plus WebSocket server, EU region first), health check, basic monitoring                                              | A public URL that friends can join                                                                                                                      |

### 10. Parallel work (after M3 is merged)

The client and server foundations are now stable, so these can run as separate branches or cloud sessions at the same time:

- **Art and rendering (M5):** `client/render/`, `client/assets/`
- **Abilities and audio (M6):** `shared/abilities/`, `server/systems/`, `client/audio/`
- **Interface (M7):** `client/ui/`

Each must keep CI passing and avoid editing the others' folders without flagging it.

### 11. Rules for you

- Keep it simple: as few dependencies as possible, and explain why before adding any new one.
- Every tuning number goes in `shared/config.ts`.
- Never commit secrets. Use `.env` locally and keep `.env.example` up to date.
- Ask me before: buying assets, signing up for paid services, or changing the stack.
- If you're blocked on art, keep going with placeholders. Never stall.
- Don't build accounts, payments, ads or chat. They're out of scope for this version.
- Prefer working, tested features over half-built extras.

### 12. Later (not now)

Cosmetic skins, friend parties, ranked seasons, and the CrazyGames and Poki web game portal SDKs (check their requirements first), plus a short replay clip of the meteor finale for sharing.
