import * as THREE from 'three';
import { TacticalAudio } from './audio.js';
import { TacticalWorld } from './world.js';
import { TacticalWeaponRig } from './weapon.js';
import { EnemyManager } from './enemies.js';
import { createBodycamComposer } from './postprocess.js';

const canvas = document.getElementById('game-canvas');
const hudEl = document.getElementById('hud');
const overlayEl = document.getElementById('overlay-screen');
const overlayTitle = document.getElementById('overlay-title');
const overlayDesc = document.getElementById('overlay-desc');
const overlayStats = document.getElementById('overlay-stats');
const startBtn = document.getElementById('start-btn');

const hpBar = document.getElementById('hp-bar');
const hpVal = document.getElementById('hp-val');
const stamBar = document.getElementById('stam-bar');
const stamVal = document.getElementById('stam-val');
const ammoMag = document.getElementById('ammo-mag');
const ammoRes = document.getElementById('ammo-res');
const flagLight = document.getElementById('flag-light');
const reloadPrompt = document.getElementById('reload-prompt');
const hitMarker = document.getElementById('hit-marker');
const damageVignette = document.getElementById('damage-vignette');
const hudKills = document.getElementById('hud-kills');
const hudWave = document.getElementById('hud-wave');
const hudClock = document.getElementById('hud-clock');

// Renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

// Scene & Camera Rig
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(82, window.innerWidth / window.innerHeight, 0.06, 80);

const playerYaw = new THREE.Object3D();
const playerPitch = new THREE.Object3D();
playerYaw.position.set(0, 1.66, 20);
playerYaw.add(playerPitch);
playerPitch.add(camera);
scene.add(playerYaw);

// Subsystems
const audio = new TacticalAudio();
const world = new TacticalWorld(scene);
const weapon = new TacticalWeaponRig(scene, camera);
let enemyMgr = new EnemyManager(scene, world, audio);
const { composer, bodycamPass, bloomPass } = createBodycamComposer(renderer, scene, camera);

// Game & Player State
const keys = new Set();
let isPlaying = false;
let isGameOver = false;
let isADS = false;
let hp = 100;
let stamina = 100;
let crouchBlend = 0;
let leanBlend = 0;
let camShake = 0;
let camRecoilPitch = 0;
let camRecoilYaw = 0;
let footstepDist = 0;
let hitMarkerTimer = 0;
let damageFlash = 0;
let mouseVel = new THREE.Vector2(0, 0);

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();

function resetGame() {
  // Remove old enemies from scene
  for (const e of enemyMgr.enemies) {
    scene.remove(e.root);
  }
  enemyMgr = new EnemyManager(scene, world, audio);
  hp = 100;
  stamina = 100;
  isGameOver = false;
  playerYaw.position.set(0, 1.66, 20);
  playerYaw.rotation.y = 0;
  playerPitch.rotation.x = 0;

  weapon.ammoInMag = weapon.magSize;
  weapon.reserveAmmo = 75;
  weapon.isReloading = false;
  if (!weapon.flashlightOn) weapon.toggleFlashlight();

  enemyMgr.spawnWave(4, playerYaw.position);
  updateHUD();
}

// Initial wave
enemyMgr.spawnWave(4, playerYaw.position);

function updateHUD() {
  hpBar.style.width = `${Math.max(0, hp)}%`;
  hpBar.classList.toggle('low', hp <= 30);
  hpVal.textContent = Math.max(0, Math.round(hp));

  stamBar.style.width = `${Math.round(stamina)}%`;
  stamVal.textContent = Math.round(stamina);

  ammoMag.textContent = weapon.ammoInMag;
  ammoRes.textContent = weapon.reserveAmmo;
  reloadPrompt.classList.toggle('hidden', weapon.ammoInMag > 0 || weapon.isReloading);

  flagLight.textContent = weapon.flashlightOn ? '[F] LIGHT: ON' : '[F] LIGHT: OFF';
  flagLight.classList.toggle('active', weapon.flashlightOn);

  hudKills.textContent = `HOSTILES NEUTRALIZED: ${enemyMgr.kills}`;
  hudWave.textContent = `THREAT LEVEL: HIGH [WAVE ${enemyMgr.wave}]`;
}

function updateBodycamClock() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  hudClock.textContent =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
setInterval(updateBodycamClock, 1000);
updateBodycamClock();

// Pointer Lock & Input Listeners
startBtn.addEventListener('click', () => {
  audio.init();
  if (isGameOver) resetGame();
  canvas.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  isPlaying = locked;
  if (locked) {
    overlayEl.classList.add('hidden');
    hudEl.classList.remove('hidden');
  } else {
    isADS = false;
    keys.clear();
    hudEl.classList.add('hidden');
    overlayEl.classList.remove('hidden');
    if (!isGameOver) {
      overlayTitle.textContent = 'FEED PAUSED';
      overlayDesc.textContent = 'Bodycam recording suspended. Click below to resume tactical feed.';
      startBtn.textContent = 'RESUME [CLICK TO LOCK CURSOR]';
      overlayStats.classList.add('hidden');
    }
  }
});

window.addEventListener('keydown', (e) => {
  const code = e.code;
  keys.add(code);
  if (!isPlaying) return;

  if (code === 'KeyR') {
    if (weapon.startReload()) {
      audio.playReloadSequence();
    }
  } else if (code === 'KeyF') {
    weapon.toggleFlashlight();
    audio.playFlashlightToggle();
    updateHUD();
  }
});

window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
});

window.addEventListener('mousemove', (e) => {
  if (!isPlaying) return;
  const sens = isADS ? 0.0014 : 0.0021;
  playerYaw.rotation.y -= e.movementX * sens;
  playerPitch.rotation.x = THREE.MathUtils.clamp(
    playerPitch.rotation.x - e.movementY * sens,
    -1.35,
    1.35
  );
  weapon.addLookInput(e.movementX, e.movementY);
  mouseVel.x = THREE.MathUtils.clamp(e.movementX * 0.035, -1.2, 1.2);
  mouseVel.y = THREE.MathUtils.clamp(e.movementY * 0.035, -1.2, 1.2);
});

window.addEventListener('mousedown', (e) => {
  if (!isPlaying) return;
  if (e.button === 2) {
    isADS = true;
  } else if (e.button === 0) {
    firePlayerWeapon();
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 2) isADS = false;
});

window.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.setSize(window.innerWidth, window.innerHeight);
});

function firePlayerWeapon() {
  if (weapon.isReloading) return;
  if (weapon.ammoInMag <= 0) {
    audio.playDryFire();
    return;
  }
  if (!weapon.fire()) return;

  audio.playPlayerGunshot();
  camShake = Math.min(camShake + 0.022, 0.055);
  camRecoilPitch += 0.028 * (1 - weapon.adsBlend * 0.35);
  camRecoilYaw += (Math.random() - 0.5) * 0.014;

  // Alert hostiles in the dark compound
  enemyMgr.alertNearby(playerYaw.position, 24);

  // Ballistic Raycast from center of view
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const worldHits = raycaster.intersectObjects(world.raycastMeshes, false);
  const enemyHits = raycaster.intersectObjects(enemyMgr.getHitMeshes(), true);

  const worldDist = worldHits.length > 0 ? worldHits[0].distance : Infinity;
  const enemyHit = enemyHits.length > 0 ? enemyHits[0] : null;

  if (enemyHit && enemyHit.distance < worldDist) {
    const { enemyId, isHead } = enemyHit.object.userData;
    if (enemyId) {
      const res = enemyMgr.damageEnemy(enemyId, enemyHit.point, isHead);
      if (res) {
        hitMarkerTimer = 0.11;
        hitMarker.classList.remove('hidden');
        // Resupply small reserve ammo on kill to sustain survival waves
        if (res.killed) {
          weapon.reserveAmmo = Math.min(weapon.reserveAmmo + 6, 90);
        }
      }
    }
  } else if (worldHits.length > 0) {
    enemyMgr.spawnImpactSpark(worldHits[0].point);
  }

  updateHUD();
}

function onPlayerHit(dmg) {
  if (isGameOver) return;
  hp = Math.max(0, hp - dmg);
  audio.playPlayerHurt();
  camShake = 0.065;
  damageFlash = 1.0;
  damageVignette.style.opacity = '0.9';
  updateHUD();

  if (hp <= 0) {
    isGameOver = true;
    document.exitPointerLock();
    overlayTitle.textContent = 'OPERATOR KIA // SIGNAL LOST';
    overlayDesc.textContent = 'Bodycam telemetry terminated. Hostile forces overwhelmed your position.';
    overlayStats.textContent = `HOSTILES NEUTRALIZED: ${enemyMgr.kills}  |  WAVE REACHED: ${enemyMgr.wave}`;
    overlayStats.classList.remove('hidden');
    startBtn.textContent = 'REDEPLOY [CLICK TO RESTART]';
  }
}

// Main Loop
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  if (isPlaying && !isGameOver) {
    // Movement input
    const forwardInput = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafeInput = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const isMoving = forwardInput !== 0 || strafeInput !== 0;
    const isCrouched = keys.has('KeyC') || keys.has('ControlLeft');
    const wantsSprint = keys.has('ShiftLeft') && forwardInput > 0 && !isCrouched && !isADS;
    const isSprinting = wantsSprint && stamina > 4;

    if (isSprinting) {
      stamina = Math.max(0, stamina - 26 * dt);
    } else {
      stamina = Math.min(100, stamina + 16 * dt);
    }

    const speed = isSprinting ? 5.6 : isCrouched ? 2.1 : isADS ? 2.4 : 3.55;
    const moveDir = new THREE.Vector3(strafeInput, 0, -forwardInput);
    if (moveDir.lengthSq() > 0) {
      moveDir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), playerYaw.rotation.y);
      playerYaw.position.addScaledVector(moveDir, speed * dt);
      world.resolveCollision(playerYaw.position, 0.42);

      // Footsteps
      footstepDist += speed * dt;
      const stepStride = isSprinting ? 1.85 : isCrouched ? 1.25 : 1.55;
      if (footstepDist >= stepStride) {
        footstepDist = 0;
        audio.playFootstep(isSprinting, isCrouched);
        camShake = Math.max(camShake, isSprinting ? 0.012 : 0.005);
      }
    }

    // Crouch & Lean
    crouchBlend = THREE.MathUtils.lerp(crouchBlend, isCrouched ? 1 : 0, 1 - Math.exp(-10 * dt));
    const leanTarget = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
    leanBlend = THREE.MathUtils.lerp(leanBlend, leanTarget, 1 - Math.exp(-11 * dt));

    playerYaw.position.y = THREE.MathUtils.lerp(1.66, 1.12, crouchBlend);

    // Bodycam camera motion: recoil, lean, organic sway, and impact shake
    camRecoilPitch *= Math.exp(-12 * dt);
    camRecoilYaw *= Math.exp(-12 * dt);
    camShake *= Math.exp(-11 * dt);

    const shakeX = (Math.random() - 0.5) * camShake;
    const shakeY = (Math.random() - 0.5) * camShake;
    const sprintRoll = isSprinting ? Math.sin(elapsed * 12.5) * 0.025 : 0;
    const breathY = Math.sin(elapsed * 1.9) * 0.004;

    camera.position.set(leanBlend * 0.24 + shakeX, breathY + shakeY, 0);
    camera.rotation.set(camRecoilPitch, camRecoilYaw, -leanBlend * 0.14 + sprintRoll);

    // ADS FOV zoom
    const targetFov = isADS && !weapon.isReloading ? 64 : 82;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.exp(-12 * dt));
      camera.updateProjectionMatrix();
    }

    // Update subsystems
    weapon.update(dt, elapsed, { isMoving, isSprinting, isADS, isCrouched });
    world.update(dt, elapsed);
    enemyMgr.update(dt, playerYaw.position, weapon.flashlightOn, onPlayerHit);
    audio.tick(dt);

    // Update 3D audio listener
    const camPos = new THREE.Vector3();
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    camera.getWorldPosition(camPos);
    audio.updateListener(camPos, camFwd, camUp);

    // Hitmarker & damage vignette decay
    if (hitMarkerTimer > 0) {
      hitMarkerTimer -= dt;
      if (hitMarkerTimer <= 0) hitMarker.classList.add('hidden');
    }
    if (damageFlash > 0) {
      damageFlash = Math.max(0, damageFlash - dt * 2.2);
      damageVignette.style.opacity = String(damageFlash * 0.85);
    }

    // Post-process uniforms (motion blur & film grain)
    mouseVel.multiplyScalar(Math.exp(-14 * dt));
    bodycamPass.uniforms.uTime.value = elapsed;
    bodycamPass.uniforms.uMotion.value.copy(mouseVel);
    bodycamPass.uniforms.uDamage.value = damageFlash;

    updateHUD();
  } else {
    bodycamPass.uniforms.uTime.value = elapsed;
    bodycamPass.uniforms.uMotion.value.set(0, 0);
  }

  composer.render();
}

animate();
