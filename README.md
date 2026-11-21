# LASTMAGAZINE — Night City Bodycam

A **GTA-style open-world crime sandbox** rendered like a police bodycam.
Runs entirely in the browser. Built with **npm + Vite + TypeScript +
three.js** — all textures, sounds and effects are generated procedurally at
runtime, on top of **real GLTF 3D models** for the weapons, pedestrians and
vehicles (see [public/models/CREDITS.md](public/models/CREDITS.md)).

One camera. One city. Steal cars off the curb, switch who you are with a
keypress, and try not to earn all five stars — every crime brings more
sirens. The night is black: your weapon-mounted light, the burning barrels
and car headlights are the only lights left.

![Night city](docs/screenshot-night-yard.png)

---

## Running it

```bash
npm install
npm run dev        # → http://localhost:5173
```

Production build:

```bash
npm run build      # typechecks (tsc --noEmit) + bundles to dist/
npm run preview    # serves dist/
```

Desktop browser + mouse + sound required. Click to hit the streets (pointer
lock), Esc pauses, click to resume.

## Controls

| Input | Action |
| --- | --- |
| `WASD` | Move on foot / throttle + steer while driving |
| Mouse | Look / orbit the chase camera in a car |
| `LMB` | Fire (works on foot **and** while driving) |
| `R` | Reload (hand-driven mag swap) |
| `E` | Enter / exit the nearest car (steal any parked car) |
| `F5` | Cycle character: Civilian → Gangster → Officer |
| `F` | Toggle the weapon light (on foot) |
| `Shift` | Sprint |
| `C` / `Ctrl` | Crouch |
| `Space` | Jump on foot / handbrake while driving |
| `Esc` | Pause |

## What's inside

### NPC variety & customization

Every pedestrian is the same cheap base model diversified procedurally at
spawn — no extra downloads:

- **Body types** — average / fat / thin / muscular via non-uniform XYZ
  scaling of the height-normalized model, plus per-NPC height jitter. The
  scale pivots at the feet, so walk/run cycles keep ground contact and the
  animations read correctly on fat and thin bodies alike.
- **Outfits** — per-instance material clones recolored by palette: three
  styles (full outfits, summer tanks + shorts, beach/swimwear with
  skin-tone tops and loud shorts), six skin tones, seven hair colors and
  the occasional bald head (hidden hair mesh).
- **Cops** — the same body-type variation, but the duty uniform stays
  police navy on every officer.

### Street life: hunger, food & robbery

- **Hunger** drains steadily (orange FOOD bar next to HP). Below 25% you
  start starving: health drains until you eat or you die.
- **Hot-dog carts** ($5, `E`) restore 55 hunger — cash matters.
- **Robbery** — three glowing market kiosks (24/7 MARKET / LIQUOR / PAWN).
  `E` at the register robs it for $140-320 and instantly raises the wanted
  level; each register empties for 75 s.
- **Streetlights** line every road — emissive heads that read as sodium
  lamps without casting a single real light, keeping the
  flashlight/muzzle-flash look.

### Open-world night city

A 3×3-block grid (~170 m square) of dark high-rise blocks with sidewalks, a
road network with lane markings, alley fires, dumpsters and perimeter walls.
Building windows are emissive paint (a few warm lit windows, a few cold TV
glows) — they never cast light. Building collisions are plain AABBs, as are
every actor's movement bounds.

### Vehicles

Four real low-poly car models (sedan, SUV, taxi, police cruiser — Quaternius
*Cars* pack, CC0, converted FBX→GLB). Arcade physics: throttle/brake/reverse,
speed-scaled steering, handbrake slides, AABB probe collisions against
buildings with crash feedback (screen trauma + synthesized thud). Press `E`
near any parked car to steal it; headlights (two shared spotlights + a hood
bounce glow) attach to whatever you drive. Shooting from the driver's seat
works — muzzle flash and tracers spawn at the window.

### Character switching

`F5` instantly cycles three personas — Civilian, Gangster, Officer — each a
recolored copy of the rigged *Animated Men* model. You see the swap when
driving (the current persona sits in the driver's seat under the chase cam)
and feel it on foot through the viewmodel glove tint + HUD label.

### Wanted level (5 stars)

Crimes feed a heat meter: firing near pedestrians, wounding or killing them,
running them over, shooting up patrol cars. Heat decays when you stay quiet.
Stars appear top-right (five ★ slots with a live heat bar) and each level
deploys more **police cruisers** that pure-pursuit chase you, steer around
walls, back out when wedged, and open window fire in bursts with
distance-based accuracy. Shoot a cruiser to destruction and it burns; kill
cops and the response only grows.

### Pedestrians

Real animated pedestrians (Idle / Walk / Run / Death clips) wander the
sidewalks, flee from gunfire and fast cars, and die with the real Death
animation when shot or run over. Head/body hit zones resolve bullets for
2.2× headshot damage.

### The bodycam look

Same rig as ever: walk-cycle head bob, idle breathing, recoil viewpunch
springs, trauma shake, landing dips, death slump — plus a roof-mounted chase
camera while driving with engine vibration scaled by speed. PostFX adds
grain, chromatic aberration, vignette and random telecom dropouts. The HUD
is bodycam chrome: REC dot, timestamp, battery drain, plus the
LASTMAGAZINE watermark, wanted stars, HP bar and interaction hints
(`E — ENTER VEHICLE`, `F5` persona flashes).

### The P9C viewmodel

A Quaternius *Ultimate Guns* pistol (CC0, converted FBX→GLB), normalized
barrel-forward at 0.33 m and gripped by two posed WebXR glove models.
**Hip fire only — there is no aim-down-sights mode.** Recoil springs, walk
bob, mouse-lag sway, sprint pose, and a hand-driven magazine reload: the
off hand dips off-screen, seats a fresh mag and the spent one drops as a
world prop. A weapon light rides the gun; its spill lights the hands, gun
body and the ground ahead (the spill is a scene-level light that tracks the
muzzle — camera-child lights never illuminate the viewmodel).

### Procedural audio

Every sound is synthesized live: gunshots (near + distant variants),
fire crackle, footsteps, hurt/heartbeat, torch clicks, car engine hum whose
pitch and volume follow the rpm, a two-tone siren wail that swells with
wanted level and proximity to the nearest cruiser, crash thuds, door slams
and the wanted-star sting. Generated convolution reverb + HRTF panners,
routed through a compressor.

## Verification

`node scripts/verify_gta.mjs` (from the repo root) serves the production
build headless and simulates a full loop: spawn, F5 persona switch, E enter
car, acceleration, crimes → stars → police deployment, E exit, reload —
with pixel statistics and console-error checks on each stage.
