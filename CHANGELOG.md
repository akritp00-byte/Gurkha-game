# Changelog

One entry per milestone (BUILD_PROMPT.md §9), newest first.

## M5: Art pass, plus weaker bots, meat, 20-minute rounds and sound (2026-10-04)

M5 is the art pass, and also takes in the changes asked for after M4: the bots were far too strong, bigger dinosaurs were too slow to snowball a lead, eggs looked out of place, rounds were too short, and there was no sound.

### Added

- **A dinosaur for every tier**, built in code as smooth low-poly creatures on a 17-bone skeleton, one draw call each:
  - Compsognathus (green, striped, with a fuzz of proto-feathers), Velociraptor (feathered arms and tail fan, sickle claws), Dilophosaurus (twin red crests, spotted), Allosaurus (red brow horns, a ridge of scutes, banded) and T-Rex (huge skull, tiny arms, mottled).
  - Animated in code: breathing and looking around when idle, a walk that becomes a run (body tipped forward, tail held out, bigger strides), jaws that open and snap on a bite, chewing, a half-open grip while carrying, and a roar.
  - **Evolving** is an event: a roar, a fountain of golden sparks and a ring of light, on top of the camera punch.
- **Kills are bodies.** A carcass in your jaws is the victim itself, hanging limp across your mouth, and a dropped one lies on its side. It shrinks and reddens as it's eaten.
- **World-event carcasses are dead plant-eaters**: a Brachiosaurus, Triceratops, Stegosaurus, Ankylosaurus, Parasaurolophus or Diplodocus lying on its side with its ribs showing.
- **A prehistoric island.**
  - Tree ferns, conifers and monkey-puzzle trees in the jungle; cycads on the plains; giant horsetails by the river and the shore; ferns; mossy boulders.
  - The Ashlands: lava streams running down the volcano, basalt columns, charred trees, old skeletons and a smoking crater that spits embers. Skeletons and dead trees by the tar pits too.
  - A pterosaur flock wheeling over the island, drifting clouds, a sun with a glow, warmer light and a humid haze.
  - Water that's turquoise in the shallows and deep blue further out, with surf along the shore and waves.
  - Plants between the camera and your dinosaur dissolve, so they never hide it.
- **Meat instead of eggs**, in three sizes: scraps (1), cuts (3) and haunches (8).
- **Particles**: gore when something is caught or eaten, dust behind sprinters, steam and embers from the vents, and fire and ash at the meteor's impact, with a ring of light racing across the island.
- **Bloom** on the high preset (with multisampling), so lava, sparks, the sun and the meteor glow.
- **Sound**, all synthesised in the browser:
  - A meaty chomp for every bite of food (a thump, crunchy bone and a wet squelch, deeper for bigger mouthfuls), teeth snapping, a heavy crunch for a kill, footsteps that get heavier as you grow, roars from a Compy's screech to a T-Rex's bellow, a horn for world events, vents blasting, the meteor's rumble and impact, and wind and birdsong.
  - M turns it off and on (remembered).
- **A "Hold E to eat this carcass" prompt** whenever a carcass is in reach.
- **Tests.** 145 unit tests (meat sizes and the danger zones' share, meat eaten with a full mouth, eating a big carcass from on top, a body's mass on its carcass, the new speed curve, 20-minute rounds, bots that won't sprint after prey, stop hunting once big and shy away from the danger zones) and 25 browser tests on desktop and phone.
- **A performance test**: on the preset the game picks itself (desktop and phone), in a full room, looking over the jungle, the volcano and the plains, the scene stays under 150 draw calls and 500k triangles. `window.__extinct.triangleBreakdown()` lists the heaviest parts.

### Changed

- **Bots are much weaker and less lethal.** They react later (0.35–0.75 s), are clumsier, amble after prey at 85% speed and never sprint after it, give up a chase after 4 s, bite less readily, would mostly rather eat than fight, notice threats late, and stay out of the danger zones. Once a bot passes 250 mass it stops hunting altogether, so no bot runs away with the round.
- **Bigger dinosaurs are a little faster** instead of slower: speed grows from 9 at 10 mass to about 12 for a T-Rex (it was 4.5). Small dinosaurs still turn tighter.
- **Rounds last 20 minutes**, with the meteor warning for the last two.
- **Danger zones hold the richest food**: a share of the meat always lies there, mostly cuts and haunches, worth ×5 in the Ashlands and ×4 by the tar pits, with a golden glow. A haunch on the volcano is worth 40 scraps. It's slower to come back, and the rest of the island's meat never lands there.
- **Food is eaten on contact even with a carcass in your mouth.** It used to be ignored, which made meat drops seem uneatable.
- A big carcass can be eaten from on top of it, not only from its edge, and kill carcasses are easier to reach (the body lies stretched out).
- World events come every 35–60 s (up to four at once) and grow up to 3× by the meteor; event meat lasts 60 s.
- Critters flee a little slower and notice you later.
- Browser tests play on the medium preset by default (bloom makes software rendering several times slower); the smoke and performance tests use the preset the game picks.

### Known issues

- Bites still aren't lag-compensated online.
- The models are procedural, not the rigged GLB models the brief imagined; the asset sites are unreachable from cloud sessions. They can be swapped in later behind the same `DinoView` interface.
- The brief's Howler.js isn't used: the sounds are synthesised with the browser's own Web Audio API, so there's nothing to download or license.
- E still eats, so the M6 abilities need another key.

## M4: Round loop, plus bites, carcasses, events and danger zones (2026-10-04)

M4 also changes the core rules, as asked after M3: progression felt slow and stale.

### Added

- **The round loop.**
  - Rounds last 5 minutes, shown by a clock at the top of the screen.
  - At 4:00 the meteor warning starts: the sky turns red, a fireball crosses it towards the volcano, burning debris falls and the ground rumbles.
  - At 5:00 the meteor hits: a white flash, a shockwave and a hard shake, and everything freezes for 3 seconds.
  - Then a podium shows the three biggest dinosaurs alive at impact, and how you did. Ten seconds later everyone hatches again on a fresh island.
- **Leaderboard and minimap.**
  - A top-10 leaderboard, with your own place below it when you're not in it.
  - The minimap shows the danger zones, fern patches, world events, the top three (unless they're hidden in ferns) and you.
  - The server sends these to everyone, alongside the nearby-only state.
- **Bite to kill.** A dinosaur at least 1.2× bigger no longer eats on contact.
  - Left click (or Space, or the Bite button on phones) bites. An aimed bite reaches a little further and wider than the mouth, and has a 0.4 s cooldown.
  - A bite kills anything 1.2× smaller in reach and leaves its carcass in your mouth.
  - Biting a dinosaur too close in size to kill shoves it away and knocks loose whatever it carries, so equals can fight over food. A bite does nothing to anything bigger than you.
- **Carcasses.** A kill's carcass holds 70% of the victim's mass as food.
  - You carry it in your mouth (20% slower) and hold E (or the Eat button) to eat it, gaining mass as you go (half speed while eating). Bigger mouths eat faster.
  - Biting again drops it, and dying drops it too. Anyone can pick up a dropped carcass that fits in their mouth, or eat from it where it lies.
  - Carcasses on the ground rot after 45 s.
- **Random world events**, every 25–45 s, announced to everyone with a banner, a light pillar and a minimap marker.
  - A huge plant-eater carcass (a Triceratops, a Brachiosaurus and so on) worth 50–90 food, too big to carry, so everyone eats it where it lies and fights over it.
  - Or a scatter of meat a pterosaur dropped.
  - Events grow through the round, up to 2.5× by the meteor.
- **Danger zones.** The volcano's slopes (the Ashlands, where the vents erupt) and the burnt ground round the tar pits.
  - Eggs, meat and critters there are worth 4× and 3×, and the eggs there are golden.
  - Half of all world events land in a danger zone, and they're 3–4× bigger there.
  - The ground is tinted, and a HUD chip says what food is worth.
- **Interface.** A stamina bar, HUD chips for carrying, eating and danger zones, and your rank on the death card ("You were #4…"). The kill feed and death card now say "caught".
- **Test hooks.** `?round=N` plays N-second rounds (offline, or on a test server). `window.__extinct` adds `startEvent()`, `leaderboard()`, `podium()` and `carcasses()`, and `placeDinoAhead(..., still)` places a bot that stands still.
- **Tests.**
  - 138 unit tests: bites and carcasses, stamina, danger zones, world events, the round loop and podium, critters a hunter can catch, and bots that bite, eat and crowd round events. A whole round with 16 bots now plays through the meteor, the podium and a reset without errors.
  - Server tests: a whole short round with its podium, world events announced to everyone, and carcasses in a hidden dinosaur's mouth staying hidden.
  - Browser tests: the M4 check (a full round completes and the correct winner is shown), click-bite-carry-eat on desktop and with the touch buttons, eating an event carcass, danger zones, and the two-tab game with bites.
  - The load test still holds 20 ticks per second with 30 players and 16 bots: ticks average about 4 ms, the slowest about 17 ms.

### Changed

- **Sprinting uses stamina instead of mass.** A full bar lasts 4 s and refills over 5 s after a short rest. Run it dry and you're winded until it's back to 30%. Sprinting no longer drops meat, and a fresh hatchling can sprint too. Burning mass undid progress, which already felt slow.
- **Mouse steering moved to the right button**, since a left click bites.
- **Critters are easier to catch.** They're slower (6.2 instead of 7.5), notice you later and zigzag less. They also tire after a 2.5 s bolt and trot for 1.5 s, so even a young Velociraptor can run one down.
- **Fleeing bots are a little clumsier.** Clumsy bots notice threats later, and every bot now runs out of stamina.
- Bots bite (not always at the right moment), carry and eat their kills, head for world-event carcasses and shove rivals off them, and save stamina for when it counts.
- The kill event is now `dinoKilled` (with the victim's rank). Inputs carry `bite` and `eat`, and a late packet's repeated input never repeats a bite.

### Known issues

- Bites aren't lag-compensated: online, you aim at where other dinosaurs were 100 ms ago, plus half your ping. The wider aimed bite covers small pings; rewinding targets on the server could come later.
- E now eats, but the brief puts the tier abilities on E (M6), so the ability key needs choosing then (Q, say).
- The death card has no Play Again button yet: you hatch again automatically after 3 s. That comes with the landing screen in M7.
- The meteor, debris, shockwave, carcasses and light pillars are placeholders until the art pass (M5).

## M3: Multiplayer (2026-10-04)

### Added

- **An authoritative Colyseus server.** Each room runs the shared `GameWorld` at 20 ticks per second, bots included. Clients only send inputs (turn, throttle and sprint), one per tick, and the server decides everything else. A room holds up to 30 players. Bots keep it at 16 dinosaurs and leave as players join, the dead and the small first.
- **Prediction and smoothing.**
  - Your own dinosaur moves the moment you press a key. The client runs the same shared step function, then re-applies the inputs the server hasn't acknowledged yet on top of every server update (Colyseus' built-in reconciler). Corrections over 10 units snap instead of gliding.
  - Everyone else, and the critters, are drawn 100 ms in the past, interpolated between server updates.
- **Nearby-only updates.**
  - Each client is sent only the dinosaurs, critters, eggs and meat within 120 units of its dinosaur. Things leave its view only 8 units further out, so nothing flickers at the edge.
  - Small dinosaurs hidden in ferns are never sent to anyone more than 10 units away, so a modified client can't reveal them.
  - Eggs and meat hardly move, so they're re-checked every 5 ticks.
  - Bites and hatchings are only sent to players who can see them, and evolutions only to the player who evolved.
- **Basic anti-cheat.**
  - The server never takes a position from a client and clamps every input to its range.
  - It applies one input per tick, so speed is capped. At most 6 inputs wait in line and the oldest are dropped, so a burst can't buy extra movement.
  - It disconnects clients that send more than 60 messages a second.
- **Joining and leaving.**
  - `?name=` sets your name (up to 16 characters, otherwise "Player N"). `?room=` puts friends, and each browser test, in a room of their own.
  - A dropped connection keeps its dinosaur, standing still, for 10 s while the client reconnects by itself. Closing the tab leaves at once.
  - If the connection is lost for good, a notice offers to rejoin.
  - If a client stops sending inputs (a hidden tab, a stalled connection), the server repeats its last input for 5 ticks to ride out a late packet, then its dinosaur stops.
- **Offline fallback.** If no game room answers within 6 s, the game says so and starts the offline sandbox against bots instead. `?offline` plays offline on purpose. Builds without a game server configured stay offline, as before.
- **A test mode for the server.** `pnpm dev` starts the server with `--test-commands`. It honours the `?seed=` and `?bots=` join options and the debug hooks that set mass, teleport and end spawn protection, so browser tests can stage a meeting. `pnpm start` ignores all of them.
- **Server numbers.** A `/stats` route reports each room's players, dinosaurs, tick rate and time per tick. `pnpm loadtest` joins 30 headless players to a running server and reports whether it kept up.
- **Tests.**
  - The load test runs on every `pnpm check`. In a cloud container, 30 players plus 16 bots hold 20 ticks per second, and every client gets 20 updates a second. Ticks take 3–4 ms on average and under 16 ms at worst, against a budget of 50 ms.
  - Server tests cover bots topping up a room, inputs moving the dinosaur and being acknowledged, the interest radius, fern hiding on the server, eating and respawning, a silent client stopping, reconnecting, flooding, and a production server ignoring test commands.
  - The brief's two-tab Playwright test: two players in one room see each other move, then one eats the other. It checks the kill feed in both tabs, the death card and the respawn.

### Changed

- The game draws a session: either the offline sandbox (`OfflineSession`, running `GameWorld` in the browser as in M1 and M2) or a server game (`OnlineSession`).
- Headings are no longer wrapped to ±π, so interpolation and corrections never see a 2π jump.
- Inputs travel as small whole numbers (turn −127 to 127, throttle 0 to 255), so "no input" is exactly zero on both sides.
- Browser tests open the offline sandbox (`?offline`) unless they test multiplayer.

### Known issues

- The top-10 leaderboard and the minimap dots aren't sent yet. They arrive with the round loop and its interface in M4.
- Vent blasts aren't predicted, so your own dinosaur is thrown a moment late and corrected, rather than at once.
- When an input arrives late, the server repeats the previous one and your dinosaur is corrected afterwards. On a poor connection that can show as a small nudge.
- Dinosaurs still pass through each other when neither can eat the other.
- Ping reads high in software-rendered browsers (test machines), because each frame takes hundreds of milliseconds there.

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
