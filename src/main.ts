import * as THREE from 'three';
import './style.css';
import { Input } from './core/Input';
import { CameraRig, type RigState } from './core/CameraRig';
import { MapBuilder } from './world/MapBuilder';
import { SFX } from './audio/SFX';

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
