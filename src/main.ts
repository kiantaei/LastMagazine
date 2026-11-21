import * as THREE from 'three';
import './style.css';
import { Input } from './core/Input';
import { CameraRig, type RigState } from './core/CameraRig';
import { City } from './world/City';
import { SFX } from './audio/SFX';
import { Player } from './player/Player';
import { Personas } from './player/Persona';
import { Viewmodel } from './weapons/Viewmodel';
import { Weapon } from './weapons/Weapon';
import { Vehicles } from './vehicles/Vehicles';
import { Car } from './vehicles/Car';
import { Civilians } from './npcs/Civilians';
import { Police } from './npcs/Police';
import { Wanted } from './systems/Wanted';
import { CityLife } from './systems/CityLife';
import { PostFX } from './fx/PostFX';
import { Hud } from './ui/Hud';
import { loadAssets } from './core/Assets';

type Phase = 'menu' | 'playing' | 'paused' | 'dead';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

// ---------------------------------------------------------------------------
// Renderer + scene + camera rig
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020305);
// dense night fog: matches the bodycam look, hides the map edges of the
// ±178 m open world and culls distant draws
scene.fog = new THREE.FogExp2(0x020305, 0.0115);

const rig = new CameraRig(window.innerWidth / window.innerHeight);
scene.add(rig.camera);

const input = new Input(canvas);
const sfx = new SFX();
const hud = new Hud();

const city = new City();
scene.add(city.group);

// ---------------------------------------------------------------------------
// World actors (model-dependent ones arrive with the asset load)
// ---------------------------------------------------------------------------
const player = new Player();
player.pos.copy(city.playerStart);

let damagePulse = 0;
const playerEvents = {
  onFootstep: (sprinting: boolean) => sfx.footstep(sprinting),
  onLand: (impact: number) => rig.onLand(impact),
  onDamage: () => hud.flashDamage(),
};

// world geometry only (LOS checks) + world + dynamic hit zones (bullets)
const worldHittables = [...city.hittables];
const shootables = [...city.hittables];

const wanted = new Wanted(hud, sfx);
const cityLife = new CityLife(city.storePoints, city.cartPoints);

let vm: Viewmodel | null = null;
let weapon: Weapon | null = null;
let vehicles: Vehicles | null = null;
let civilians: Civilians | null = null;
let police: Police | null = null;
let personas: Personas | null = null;

const postfx = new PostFX(renderer, scene, rig.camera, window.innerWidth, window.innerHeight);

// ---------------------------------------------------------------------------
// Drive state
// ---------------------------------------------------------------------------
let car: Car | null = null; // the car the player currently drives

// one shared headlight pair — attached to whichever car is driven
const headlights: THREE.SpotLight[] = [];
for (const side of [-0.55, 0.55]) {
  const spot = new THREE.SpotLight(0xcfd8e8, 0, 34, 0.5, 0.55, 1.5);
  const target = new THREE.Object3D();
  target.position.set(side, 0.1, 12);
  spot.position.set(side, 0.62, 1.9);
  spot.target = target;
  spot.visible = false;
  scene.add(spot, target);
  headlights.push(spot);
}
// headlight bounce: a dim glow over the hood so the car body reads at night
const bounce = new THREE.PointLight(0xbcc8d8, 0, 9, 2);
bounce.position.set(0, 1.55, 1.0);
bounce.visible = false;
scene.add(bounce);

function attachHeadlights(): void {
  if (!car) return;
  for (const h of headlights) {
    car.group.add(h);
    car.group.add(h.target);
    h.position.set(h.position.x, 0.62, car.kind === 'suv' ? 2.0 : 1.9);
    h.target.position.set(h.position.x, 0.1, 12);
    h.visible = true;
    h.intensity = 300;
  }
  car.group.add(bounce);
  bounce.position.set(0, 1.55, 1.0);
  bounce.visible = true;
  bounce.intensity = 7;
}

function detachHeadlights(): void {
  for (const h of headlights) {
    h.removeFromParent();
    h.target.removeFromParent();
    h.visible = false;
    h.intensity = 0;
    scene.add(h, h.target); // keep them owned by the scene graph root
    h.target.position.set(0, -50, 0);
  }
  bounce.removeFromParent();
  bounce.visible = false;
  bounce.intensity = 0;
  scene.add(bounce);
  bounce.position.set(0, -50, 0);
}

function enterCar(target: Car): void {
  car = target;
  car.setDriven(true);
  car.speed = 0;
  attachHeadlights();
  sfx.doorSlam();
  vm?.setSuppressed(true);
  hud.setTorch(false);
  // sit the current persona in the driver seat
  if (personas) car.setDriver(personas.currentModel);
  rig.setDrive(car.pos, car.yaw);
  hud.setInteract('E — EXIT VEHICLE');
}

function exitCar(): void {
  if (!car) return;
  car.setDriven(false);
  car.setDriver(null);
  detachHeadlights();
  sfx.doorSlam();
  vm?.setSuppressed(false);
  hud.setTorch(vm?.getTorchOn() ?? true);
  // step out beside the car
  const rightX = Math.cos(car.yaw);
  const rightZ = -Math.sin(car.yaw);
  player.pos.set(
    car.pos.x - rightX * 2.2, // left side (driver door)
    Math.max(0, car.pos.y),
    car.pos.z - rightZ * 2.2,
  );
  player.vel.set(0, 0, 0);
  rig.clearDrive();
  rig.reset(car.yaw + Math.PI, 0);
  car = null;
  hud.setInteract(null);
}

// ---------------------------------------------------------------------------
// Async asset load → construct the model-dependent systems
// ---------------------------------------------------------------------------
loadAssets((ratio) => hud.setMenuLoading(ratio))
  .then((assets) => {
    vm = new Viewmodel(assets);
    vm.attach(rig.camera, scene);

    weapon = new Weapon(rig.camera, rig, vm, sfx, shootables, scene, {
      onAmmoChange: (mag, reserve) => hud.setAmmo(mag, reserve),
      onHit: (killed) => {
        hud.hitmarker(killed);
        if (killed) sfx.killConfirm();
        else sfx.hitmarker();
      },
      onShot: () => {
        const now = performance.now() / 1000;
        wanted.shotNoise(now);
        lastShotAt = now;
        lastShotPos.copy(rig.camera.position);
        civilians?.scareAround(rig.camera.position, 22, player.pos);
      },
      onCivilianHit: (killed) => {
        wanted.crime(killed ? 'civKilled' : 'civShot');
      },
      onPoliceHit: (wrecked) => {
        wanted.crime(wrecked ? 'copKilled' : 'copCarShot');
        if (wrecked) hud.killFeed('▸ PATROL UNIT DESTROYED');
      },
    });

    const carHooks = {
      onCrash: (impact: number, pos: THREE.Vector3) => {
        sfx.crash(impact);
        rig.addTrauma(0.25 + impact * 0.35);
        if (impact > 0.55) player.damage(impact * 14, playerEvents);
        void pos;
      },
      onCivilianHit: (civ: unknown) => {
        const c = civ as { killByCar(speed: number): void };
        c?.killByCar(Math.abs(car?.speed ?? 0));
      },
    };

    vehicles = new Vehicles(scene, assets, city.colliders, city.parkingSpots, carHooks);
    shootables.push(...vehicles.hittables);

    civilians = new Civilians(scene, weapon.fx, city.colliders, city.walkPoints, assets, 18, {
      onCivKilled: (byCar) => wanted.crime(byCar ? 'civRunOver' : 'civKilled'),
      onCivShot: (killed) => {
        if (!killed) wanted.crime('civShot');
      },
    });
    shootables.push(...civilians.hitMeshes);

    police = new Police(scene, assets, weapon.fx, city.colliders, {
      onPlayerHit: (dmg) => {
        player.damage(dmg, playerEvents);
        sfx.hurt();
        rig.addTrauma(0.3);
        damagePulse = Math.min(1, damagePulse + dmg / 30);
      },
      onNearMiss: (pos) => sfx.whiz(pos),
      onCopKilled: () => hud.killFeed('▸ PATROL UNIT DESTROYED'),
    }, carHooks);
    // cop car bodies are bullet targets — tag them with their unit
    for (const unit of police.units) {
      for (const mesh of unit.car.hittableMeshes) mesh.userData.policeUnit = unit;
    }
    shootables.push(...police.hittables);

    personas = new Personas(assets);
    hud.setPersona(personas.current.label);
    vm.setGloveTint(personas.current.glove);

    hud.setMenuReady();
    console.log('[lastmagazine] assets loaded — the streets are open');
  })
  .catch((err) => {
    console.error('[lastmagazine] asset load failed', err);
    hud.setMenuError();
  });

// ---------------------------------------------------------------------------
// Game state machine: menu → playing ⇄ paused, playing → dead → playing
// ---------------------------------------------------------------------------
let phase: Phase = 'menu';
let lastShotAt = -99;
const lastShotPos = new THREE.Vector3();

function startRun(): void {
  const w = weapon;
  const v = vehicles;
  const c = civilians;
  const p = police;
  if (!w || !v || !c || !p) return;
  // leave any car
  if (car) exitCar();
  player.reset(city.playerStart);
  w.reset();
  wanted.reset();
  cityLife.reset();
  c.start();
  p.reset();
  // re-park everything
  for (const parked of v.cars) parked.placeAt(parked.pos, parked.yaw);
  rig.reset(0, 0);
  damagePulse = 0;
  ambienceT = 6;
  glitchSpike = 0.6;
  sfx.recStart();
  hud.recGlitch();
  hud.setTorch(vm?.getTorchOn() ?? true);
  hud.setAmmo(w.mag, w.reserve);
  hud.setStars(0);
  hud.setHeat(0);
  if (personas) hud.setPersona(personas.current.label);
  hud.setInteract(null);
}

input.onLockChanged = (locked) => {
  if (locked) {
    sfx.start(); // AudioContext unlocks on the click gesture
    sfx.startFireLoops(city.firePositions);
    sfx.startCarAudio();
    if (phase === 'menu' || phase === 'dead') startRun();
    phase = 'playing';
    hud.hideAll();
  } else if (phase === 'playing') {
    phase = 'paused';
    hud.showPause();
  }
};

// any click on the page (menu, pause, death overlays included) re-engages
// pointer lock — the overlays sit above the canvas and would eat the event
document.addEventListener('click', () => {
  if (weapon && !input.locked) input.requestLock();
});

// touch devices get a warning instead of a broken game
if ('ontouchstart' in window && window.innerWidth < 900) {
  const warn = document.createElement('div');
  warn.className = 'overlay';
  warn.style.zIndex = '99';
  warn.innerHTML =
    '<div class="panel"><div class="menu-sub">KEYBOARD + MOUSE REQUIRED</div>' +
    '<div class="menu-copy">This bodycam simulation needs a desktop browser.</div></div>';
  document.getElementById('app')?.appendChild(warn);
}

// ---------------------------------------------------------------------------
// Frame loop (manual timing — THREE.Clock is deprecated in r187)
// ---------------------------------------------------------------------------
let lastT = performance.now();
const playerEye = new THREE.Vector3();
let ambienceT = 6;
let glitchSpike = 0;
let dropoutT = 5 + Math.random() * 9;

const state: RigState = {
  pos: player.pos,
  eyeHeight: player.eyeHeight,
  groundSpeed: 0,
  grounded: true,
  sprinting: false,
  crouching: false,
  dead: false,
};

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  const [lx, ly] = input.consumeLook();
  const jump = input.wasPressed('Space');
  const groundSpeed = Math.hypot(player.vel.x, player.vel.z);
  const t = now / 1000;

  if (phase === 'playing' && weapon && vehicles && civilians && police && personas) {
    // --- E: enter / exit ---------------------------------------------------
    if (input.wasPressed('KeyE')) {
      if (car) {
        exitCar();
      } else {
        const fwdX = -Math.sin(rig.yaw);
        const fwdZ = -Math.cos(rig.yaw);
        const target = vehicles.aheadOf(player.pos, TMP_FWD.set(fwdX, 0, fwdZ)) ?? vehicles.nearest(player.pos);
        if (target) {
          enterCar(target);
        } else {
          // street life: buy food or rob a register
          const cart = cityLife.nearestCart(player.pos);
          if (cart && cityLife.cash >= 5) {
            cityLife.eat(player);
            sfx.blip();
          } else {
            const store = cityLife.nearestStore(player.pos);
            if (store && store.available) cityLife.rob(store.index, player, wanted, hud);
          }
        }
      }
    }

    // --- F5: persona switch ------------------------------------------------
    if (input.wasPressed('F5')) {
      const p = personas.next();
      vm?.setGloveTint(p.glove);
      hud.setPersona(p.label);
      sfx.blip();
      if (car) car.setDriver(personas.currentModel);
    }

    if (car) {
      // --- driving -----------------------------------------------------------
      const throttle = input.down('KeyW') ? 1 : 0;
      const brake = input.down('KeyS') ? 1 : 0;
      const steer = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
      const handbrake = input.down('Space');
      car.update(dt, throttle, brake, steer, handbrake);
      vehicles.separate(car);

      // run over pedestrians
      for (const civ of civilians.pool) {
        if (civ.alive) car.checkCivilianImpact(civ);
      }

      // player rides with the car; the rig owns the chase camera
      player.pos.set(car.pos.x, car.pos.y, car.pos.z);
      player.vel.set(car.speed * Math.sin(car.yaw), 0, car.speed * Math.cos(car.yaw));
      rig.syncDrive(car.pos, car.yaw, car.speed);

      // engine audio follows the rpm; the torch rides on the (hidden) viewmodel
      sfx.setEngine(true, Math.min(1, Math.abs(car.speed) / car.maxSpeed));

      weapon.update(dt, {
        firing: input.firing,
        reloadPressed: input.wasPressed('KeyR'),
        sprinting: false,
        moving: false,
        grounded: true,
        speed: 0,
        lookDX: lx,
        lookDY: ly,
        muzzleOverride: car.windowPos(TMP_MUZZ),
      });
    } else {
      // --- on foot -----------------------------------------------------------
      player.update(dt, input.keys, jump, rig.yaw, city.colliders, playerEvents);
      weapon.update(dt, {
        firing: input.firing,
        reloadPressed: input.wasPressed('KeyR'),
        sprinting: player.sprinting,
        moving: groundSpeed > 0.6,
        grounded: player.grounded,
        speed: groundSpeed,
        lookDX: lx,
        lookDY: ly,
      });
      sfx.setEngine(false, 0);

      // interact hint: car > food cart > register
      const fwdX = -Math.sin(rig.yaw);
      const fwdZ = -Math.cos(rig.yaw);
      const near = vehicles.aheadOf(player.pos, TMP_FWD.set(fwdX, 0, fwdZ)) ?? vehicles.nearest(player.pos);
      let hint: string | null = null;
      if (near) {
        hint = 'E — ENTER VEHICLE';
      } else {
        const cart = cityLife.nearestCart(player.pos);
        if (cart) {
          hint = cityLife.cash >= 5 ? 'E — HOT DOG ($5)' : 'HOT DOG $5 — NO CASH';
        } else {
          const store = cityLife.nearestStore(player.pos);
          if (store) {
            hint = store.available ? `E — ROB ${store.name} REGISTER` : `${store.name} — REGISTER EMPTY`;
          }
        }
      }
      hud.setInteract(hint);
    }

    // F toggles the weapon light (on foot only)
    if (input.wasPressed('KeyF') && vm && !car) {
      const on = vm.toggleTorch();
      sfx.torchClick();
      hud.setTorch(on);
    }

    // burning barrels flicker
    for (const fire of city.fires) fire.update(dt);

    if (!player.dead) {
      playerEye.set(player.pos.x, player.pos.y + (car ? 1.2 : player.eyeHeight), player.pos.z);
      civilians.update(dt, {
        playerPos: player.pos,
        playerDriving: !!car,
        playerCarSpeed: car?.speed ?? 0,
        lastShotAt,
        lastShotPos,
      });

      wanted.update(dt, !!car);
      cityLife.update(dt, player, wanted, hud);
      police.updateCount(wanted.stars, city.roadSpawnPoints, player.pos);
      wanted.setCopsAlive(police.aliveCount);
      police.update(dt, {
        playerPos: player.pos,
        playerEye,
        playerDriving: !!car,
        playerCarSpeed: car?.speed ?? 0,
        playerCar: car,
        hittables: worldHittables,
      });

      // siren volume: wanted level × proximity of the closest unit
      const nd = police.nearestDist(player.pos);
      const prox = wanted.stars > 0 ? Math.max(0.12, 1 - nd / 70) : 0;
      sfx.setSiren(wanted.stars > 0 ? prox : 0);

      // lightbar flashing on every active patrol
      for (const u of police.units) u.car.updateLights(dt, u.activeState && !u.car.wrecked);
    } else {
      phase = 'dead';
      input.releaseLock();
      sfx.staticBurst();
      sfx.setEngine(false, 0);
      sfx.setSiren(0);
      glitchSpike = 1;
      hud.showDeath(wanted.kills, wanted.stars);
    }

    ambienceT -= dt;
    if (ambienceT <= 0) {
      sfx.rumble();
      ambienceT = 9 + Math.random() * 14;
    }
  }

  // camera rig always animates (death slump, pause idle)
  state.pos = car ? car.pos : player.pos;
  state.eyeHeight = car ? 1.2 : player.eyeHeight;
  state.groundSpeed = phase === 'playing' ? (car ? 0 : groundSpeed) : 0;
  state.grounded = car ? true : player.grounded;
  state.sprinting = car ? false : player.sprinting;
  state.crouching = car ? false : player.crouching;
  state.dead = player.dead;
  rig.setTargetFov(102 + (player.sprinting && !car ? 4 : 0));
  rig.update(dt, state, phase === 'playing' ? lx : 0, phase === 'playing' ? ly : 0);

  // HUD + grade
  damagePulse = Math.max(0, damagePulse - dt * 2.1);
  const lowHp = player.health < 35 ? 1 - player.health / 35 : 0;
  hud.frame(dt, {
    mag: weapon?.mag ?? 0,
    reserve: weapon?.reserve ?? 0,
    reloadProgress: weapon?.reloadProgress ?? 0,
    health: player.health,
    stars: wanted.stars,
    driving: !!car,
    speed: car?.speed ?? 0,
    hunger: cityLife.hunger,
    cash: cityLife.cash,
  });

  // bodycam glitch budget: damage, random telecom dropouts, death
  dropoutT -= dt;
  if (dropoutT <= 0 && phase === 'playing') {
    glitchSpike = Math.max(glitchSpike, 0.4 + Math.random() * 0.3);
    dropoutT = 6 + Math.random() * 10;
  }
  glitchSpike = Math.max(0, glitchSpike - dt * 2.4);
  const glitch = Math.min(1, glitchSpike + damagePulse * 0.5);
  postfx.update(dt, damagePulse, lowHp, glitch);

  sfx.updateListener(rig.camera);
  input.endFrame();
  postfx.render();
});

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  rig.camera.aspect = w / h;
  rig.camera.updateProjectionMatrix();
  postfx.setSize(w, h);
});

console.log('[lastmagazine] open world ready');

// scratch vectors for the frame loop
const TMP_FWD = new THREE.Vector3();
const TMP_MUZZ = new THREE.Vector3();

// minimal debug/testing hook (harmless in production)
(window as unknown as Record<string, unknown>).__lm = {
  get vehicles() {
    return vehicles;
  },
  get police() {
    return police;
  },
  get civilians() {
    return civilians;
  },
  get wanted() {
    return wanted;
  },
  get car() {
    return car;
  },
  get cityLife() {
    return cityLife;
  },
  get vm() {
    return vm;
  },
  get city() {
    return city;
  },
  get renderer() {
    return renderer;
  },
  get scene() {
    return scene;
  },
  player,
  rig,
};
