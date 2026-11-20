import * as THREE from 'three';
import './style.css';
import { Input } from './core/Input';
import { CameraRig, type RigState } from './core/CameraRig';

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

// Placeholder ground — replaced by the real map in the next commit.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(220, 220),
  new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.95 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const state: RigState = {
  pos: new THREE.Vector3(0, 0, 8),
  eyeHeight: 1.62,
  groundSpeed: 0,
  grounded: true,
  sprinting: false,
  crouching: false,
  dead: false,
  aim: 0,
};

// ---------------------------------------------------------------------------
// Pointer lock = "click to deploy"
// ---------------------------------------------------------------------------
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
