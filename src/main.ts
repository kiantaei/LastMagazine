import * as THREE from 'three';
import './style.css';
import { Input } from './core/Input';
import { CameraRig, type RigState } from './core/CameraRig';
import { MapBuilder } from './world/MapBuilder';
import { SFX } from './audio/SFX';
import { Player } from './player/Player';
import { Viewmodel } from './weapons/Viewmodel';
import { Weapon } from './weapons/Weapon';
import { EnemyManager } from './enemies/EnemyManager';
import { PostFX } from './fx/PostFX';
import { Hud } from './ui/Hud';

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
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);
scene.fog = new THREE.FogExp2(0x05070a, 0.03);

const rig = new CameraRig(window.innerWidth / window.innerHeight);
scene.add(rig.camera);

const input = new Input(canvas);
const sfx = new SFX();
const hud = new Hud();

const map = new MapBuilder();
scene.add(map.group);

// ---------------------------------------------------------------------------
// World actors
// ---------------------------------------------------------------------------
const player = new Player();
player.pos.copy(map.playerStart);

let damagePulse = 0;
const playerEvents = {
  onFootstep: (sprinting: boolean) => sfx.footstep(sprinting),
  onLand: (impact: number) => rig.onLand(impact),
  onDamage: () => hud.flashDamage(),
};

const vm = new Viewmodel();
vm.attach(rig.camera);

// world geometry + enemy hit zones — one array shared by bullets
const shootables = [...map.hittables];

const weapon = new Weapon(rig.camera, rig, vm, sfx, shootables, scene, {
  onAmmoChange: (mag, reserve) => hud.setAmmo(mag, reserve),
  onHit: (killed) => {
    hud.hitmarker(killed);
    if (killed) sfx.killConfirm();
    else sfx.hitmarker();
  },
});

const enemies = new EnemyManager(scene, weapon.fx, map.colliders, map.hittables, shootables, map.spawnPoints, {
  onKill: (kills) => {
    hud.setKills(kills);
    hud.killFeed();
  },
  onWaveStart: (wave, count) => {
    hud.setWave(wave);
    hud.waveBanner(wave, count);
    sfx.blip();
  },
  onWaveClear: () => sfx.blip(),
  onPlayerHit: (dmg) => {
    player.damage(dmg, playerEvents);
    sfx.hurt();
    rig.addTrauma(0.3);
    damagePulse = Math.min(1, damagePulse + dmg / 30);
  },
  onNearMiss: (pos) => sfx.whiz(pos),
});

const postfx = new PostFX(renderer, scene, rig.camera, window.innerWidth, window.innerHeight);

// ---------------------------------------------------------------------------
// Game state machine: menu → playing ⇄ paused, playing → dead → playing
// ---------------------------------------------------------------------------
let phase: Phase = 'menu';

function startRun(): void {
  player.reset(map.playerStart);
  weapon.reset();
  enemies.start();
  rig.reset(0, 0); // playerStart faces the yard center
  damagePulse = 0;
  ambienceT = 6;
  hud.setAmmo(weapon.mag, weapon.reserve);
  hud.setKills(0);
  hud.setWave(1);
}

input.onLockChanged = (locked) => {
  if (locked) {
    sfx.start(); // AudioContext unlocks on the click gesture
    if (phase === 'menu' || phase === 'dead') startRun();
    phase = 'playing';
    hud.hideAll();
  } else if (phase === 'playing') {
    phase = 'paused';
    hud.showPause();
  }
};

canvas.addEventListener('click', () => {
  if (phase !== 'paused' || true) input.requestLock();
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
// Frame loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
const playerEye = new THREE.Vector3();
let ambienceT = 6;

const state: RigState = {
  pos: player.pos,
  eyeHeight: player.eyeHeight,
  groundSpeed: 0,
  grounded: true,
  sprinting: false,
  crouching: false,
  dead: false,
  aim: 0,
};

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const [lx, ly] = input.consumeLook();
  const jump = input.wasPressed('Space');
  const groundSpeed = Math.hypot(player.vel.x, player.vel.z);

  if (phase === 'playing') {
    player.update(dt, input.keys, jump, rig.yaw, weapon.aimBlend, map.colliders, playerEvents);
    weapon.update(dt, {
      firing: input.firing,
      aimHeld: input.aimHeld,
      reloadPressed: input.wasPressed('KeyR'),
      sprinting: player.sprinting,
      moving: groundSpeed > 0.6,
      grounded: player.grounded,
      speed: groundSpeed,
      lookDX: lx,
      lookDY: ly,
    });

    if (!player.dead) {
      playerEye.set(player.pos.x, player.pos.y + player.eyeHeight, player.pos.z);
      enemies.update(dt, {
        feet: player.pos,
        eye: playerEye,
        sprinting: player.sprinting,
        crouching: player.crouching,
      });
    } else {
      phase = 'dead';
      input.releaseLock();
      hud.showDeath(enemies.kills, enemies.wave);
    }

    ambienceT -= dt;
    if (ambienceT <= 0) {
      sfx.rumble();
      ambienceT = 9 + Math.random() * 14;
    }
  }

  // camera rig always animates (death slump, pause idle)
  state.pos = player.pos;
  state.eyeHeight = player.eyeHeight;
  state.groundSpeed = phase === 'playing' ? groundSpeed : 0;
  state.grounded = player.grounded;
  state.sprinting = player.sprinting;
  state.crouching = player.crouching;
  state.dead = player.dead;
  state.aim = weapon.aimBlend;
  rig.setTargetFov(102 + (player.sprinting ? 4 : 0) - weapon.aimBlend * 34);
  rig.update(dt, state, phase === 'playing' ? lx : 0, phase === 'playing' ? ly : 0);

  // HUD + grade
  damagePulse = Math.max(0, damagePulse - dt * 2.1);
  const lowHp = player.health < 35 ? 1 - player.health / 35 : 0;
  hud.frame(dt, {
    mag: weapon.mag,
    reserve: weapon.reserve,
    reloadProgress: weapon.reloadProgress,
    health: player.health,
  });
  postfx.update(dt, damagePulse, lowHp);

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

console.log('[lastmagazine] bodycam ops ready');
