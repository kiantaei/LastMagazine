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
npm run dev        # → http://localhost:5173 (port pinned + strict)
```

Production build:

```bash
npm run build      # typechecks (tsc --noEmit) + bundles to dist/
npm run preview    # serves dist/
```

Desktop browser + mouse + sound required. Click to hit the streets (pointer
lock), Esc pauses, click to resume.

## Desktop launcher (one command)

`launcher.py` does everything: it starts `npm run dev` in the background,
waits until the server answers on `http://localhost:5173`, opens the game in
a native **1280×720** desktop window (pywebview), and kills the Node server
the moment the window closes — nothing lingers in the background.

### Step-by-step setup

1. **Install Node.js 18+** — https://nodejs.org (`node -v` and `npm -v` must work).
2. **Install Python 3.9+** — https://python.org (Linux/macOS usually have it).
3. **Install the game's npm dependencies** (one-time):
   ```bash
   cd lastmagazine
   npm install
   ```
4. **Install the Python GUI library** (one-time):
   ```bash
   python -m pip install pywebview
   ```
   Optional but tidy — use a virtual environment instead:
   ```bash
   python -m venv .venv
   source .venv/bin/activate        # Windows: .venv\Scripts\activate
   pip install pywebview
   ```
5. **Play:**
   ```bash
   python launcher.py
   ```

### Launcher flags

| flag | what it does |
| --- | --- |
| `python launcher.py` | dev server + native 1280×720 webview window |
| `python launcher.py --browser` | dev server + your default browser (no webview needed) |
| `python launcher.py --check` | verify toolchain + server boot/HTTP/shutdown, no GUI — use this if anything misbehaves |

### Folder structure

```
lastmagazine/
├── index.html          # entry (Vite root)
├── launcher.py         # Python desktop launcher (pywebview)
├── package.json        # scripts: dev / build / preview
├── vite.config.ts      # port 5173 pinned + strict
├── public/
│   └── models/         # GLB assets (characters, cars, weapons)
└── src/                # game code (TypeScript, Three.js)
    ├── main.ts         # bootstrap + frame loop
    ├── core/           # assets, input, audio, personas, HUD
    ├── world/          # city generation
    ├── npcs/           # civilians, police, NpcFactory variety system
    ├── player/         # first-person player + rig
    ├── vehicles/       # car physics + carjacking
    ├── systems/        # wanted level, city life (hunger/robbery)
    ├── weapons/        # P9C viewmodel, FX, recoil
    ├── fx/             # particles, effects
    └── audio/          # procedural audio engine
```

### Troubleshooting

- **"Node.js / npm was not found on PATH"** — install Node from nodejs.org,
  reopen the terminal, run again.
- **"the dev server did not answer"** — something else is using port 5173.
  Close it, or change `PORT` at the top of `launcher.py` (it matches
  `vite.config.ts`).
- **Mouse capture feels off inside the desktop window** — pywebview uses the
  platform's native web engine and pointer-lock support varies; run
  `python launcher.py --browser` for guaranteed capture in a real browser.
- **Linux webview errors** — pywebview needs a GTK/QT backend
  (`sudo apt install python3-gir1.2-webkit2-4.1` on Debian/Ubuntu); the
  `--browser` mode sidesteps it entirely.
- **Sanity check anytime** — `python launcher.py --check`.


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

A large 6×6-block grid spanning ±178 m (7 roads per axis, wide 4 m
sidewalks, alley gaps between buildings) with four distinct zones:

- **Downtown** (centre) — 26–56 m glass towers with cool lit windows.
- **Residential** (everywhere else) — mid-rises on the diagonal with an
  alley down the middle of every block.
- **Slum** (far NW) — four shanties per block, dim warm windows, alleys.
- **Industrial** (far SE) — long corrugated warehouses and container yards.

Map shape lives in `src/world/CityLayout.ts` (pure data: zones, building
plots, sidewalk slabs, walk/parking/prop placements); `src/world/City.ts`
only turns that data into meshes. Everything repetitive is an
`InstancedMesh` — buildings per zone, sidewalk slabs, streetlights, trees,
trash cans, dumpsters — the whole city renders in **under 100 draw calls**.
Dense `FogExp2` matches the bodycam look and hides the map edges.
18 civilians wander 324 sidewalk/alley points; 14 stealable cars sit in the
144-spot parking network; 5 robbable registers, 4 hot-dog carts and 8 alley
fires are spread across all four districts.

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
