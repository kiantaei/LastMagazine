import * as THREE from 'three';
import './style.css';
import { Input } from './core/Input';
import { CameraRig, type RigState } from './core/CameraRig';
import { MapBuilder } from './world/MapBuilder';
import { SFX } from './audio/SFX';
import { Player } from './player/Player';
import { Viewmodel } from './weapons/Viewmodel';
import { Weapon } from './weapons/Weapon';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const boot = document.getElementById('boot');

// ---------------------------------------------------------------------------
// Renderer
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

// ---------------------------------------------------------------------------
// Scene + camera rig
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);
scene.fog = new THREE.FogExp2(0x05070a, 0.03);

const rig = new CameraRig(window.innerWidth / window.innerHeight);
scene.add(rig.camera);

const input = new Input(canvas);

const sfx = new SFX();

const map = new MapBuilder();
scene.add(map.group);

const state: RigState = {
  pos: map.playerStart.clone(),
  eyeHeight: 1.62,
  groundSpeed: 0,
  grounded: true,
  sprinting: false,
  crouching: false,
  dead: false,
  aim: 0,
};

const player = new Player();
player.pos.copy(map.playerStart);
const playerEvents = {
  onFootstep: (sprinting: boolean) => sfx.footstep(sprinting),
  onLand: (impact: number) => rig.onLand(impact),
  onDamage: () => {
    /* HUD hook arrives with the UI commit */
  },
};

const vm = new Viewmodel();
vm.attach(rig.camera);

const weapon = new Weapon(rig.camera, rig, vm, sfx, map.hittables, scene, {
  onAmmoChange: () => {
    /* HUD hook arrives with the UI commit */
  },
});

// ---------------------------------------------------------------------------
// Pointer lock = "click to deploy" (also unlocks the AudioContext)
// ---------------------------------------------------------------------------
input.onLockChanged = (locked) => {
  if (locked) sfx.start();
};
canvas.addEventListener('click', () => {
  input.requestLock();
});

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const [lx, ly] = input.consumeLook();
  const jump = input.wasPressed('Space');
  const groundSpeed = Math.hypot(player.vel.x, player.vel.z);

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

  state.pos.copy(player.pos);
  state.eyeHeight = player.eyeHeight;
  state.groundSpeed = groundSpeed;
  state.grounded = player.grounded;
  state.sprinting = player.sprinting;
  state.crouching = player.crouching;
  state.dead = player.dead;
  state.aim = weapon.aimBlend;

  rig.update(dt, state, lx, ly);
  sfx.updateListener(rig.camera);
  input.endFrame();
  renderer.render(scene, rig.camera);
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  rig.camera.aspect = window.innerWidth / window.innerHeight;
  rig.camera.updateProjectionMatrix();
});

if (boot) boot.remove();
console.log('[lastmagazine] bodycam rig online');
