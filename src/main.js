import * as THREE from 'three';
import { AssetManager } from './core/assets.js';
import { VEHICLES, LOADOUTS, LIVERIES, MISSIONS } from './data/catalog.js';
import { JetFlightModel, HeliFlightModel, TankPhysicsModel } from './sim/flightPhysics.js';
import { WeaponSystem } from './sim/weapons.js';
import { CombinedArmsAI } from './sim/ai.js';
import { BattlefieldVFX } from './sim/vfx.js';
import { BattlefieldBuilder } from './world/battlefield.js';
import { getTerrainHeight } from './world/terrain.js';
import { SimAudio as TacticalAudio } from './audio/simAudio.js';
import { CombatHUD } from './ui/hud.js';
import { MilitaryHangarStage } from './ui/hangar.js';
import { LoadingScreen } from './ui/loading.js';

// ---------------------------------------------------------------------------
// Renderer / Scene bootstrap
// ---------------------------------------------------------------------------

const canvas = document.getElementById('sim-canvas');
const hudCanvas = document.getElementById('hud-canvas');

const IS_SMALL_SCREEN = Math.min(window.innerWidth, window.innerHeight) < 760;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_SMALL_SCREEN, powerPreference: 'high-performance' });
const basePixelRatio = Math.min(window.devicePixelRatio, IS_SMALL_SCREEN ? 1.5 : 2);
renderer.setPixelRatio(basePixelRatio);
let resScale = 1;
let fpsAvg = 16.7;
let resTimer = 0;
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 24000);
camera.position.set(0, 4, 16);

const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
sun.position.set(-900, 1400, 500);
sun.castShadow = true;
sun.shadow.mapSize.set(IS_SMALL_SCREEN ? 1024 : 2048, IS_SMALL_SCREEN ? 1024 : 2048);
// Rebuilding shadow maps every frame is expensive; every 2nd frame is
// visually identical for a moving sun but halves that cost
sun.shadow.autoUpdate = false;
sun.shadow.camera.left = -600;
sun.shadow.camera.right = 600;
sun.shadow.camera.top = 600;
sun.shadow.camera.bottom = -600;
sun.shadow.camera.far = 5000;
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbdd4f0, 0x5d5646, 0.85));

scene.fog = new THREE.Fog(0xa9bccf, 1800, 11000);

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

const assets = new AssetManager();
const audio = new TacticalAudio();
const loader = new LoadingScreen();
const textures = {};
const vfxTextures = {};
let vfx;
let battlefield;
let weapons;
let ai;
const hud = new CombatHUD(hudCanvas);
let hangar = null;

// Real asset progress (textures / models / HDR) drives the boot bar
assets.onProgress = (url, loaded, total) => {
  const name = url.split('/').filter(Boolean).pop() || url;
  loader.setProgress(5 + (loaded / total) * 90, 'STREAMING MISSION ASSETS');
  loader.logLine(`LOADED ${name} (${loaded}/${total})`);
};

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

const state = {
  phase: 'hangar', // hangar | sortie
  vehicle: VEHICLES[0],
  livery: LIVERIES[0],
  loadout: LOADOUTS[Object.keys(LOADOUTS)[0]][0],
  mission: MISSIONS[0],
  player: null,
  cockpitView: false,
  gunnerOptics: false,
  camMode: '3rd',
  kills: 0,
  selectedWeapon: 'cannon',
  lockedTarget: null,
  lockProgress: 0,
  time: 0,
};

const input = {
  pitch: 0, roll: 0, yaw: 0,
  throttleUp: false, throttleDown: false, airbrake: false,
  drive: 0, steer: 0, brake: false,
  fireCannon: false, fireMissileA: false, fireMissileB: false, flare: false,
};

// ---------------------------------------------------------------------------
// Hangar UI wiring
// ---------------------------------------------------------------------------

const els = {
  hangarUI: document.getElementById('hangar-ui'),
  combatHUD: document.getElementById('combat-hud'),
  vehicleList: document.getElementById('vehicle-list'),
  missionList: document.getElementById('mission-list'),
  liverySelect: document.getElementById('livery-select'),
  loadoutSelect: document.getElementById('loadout-select'),
  specTitle: document.getElementById('spec-title'),
  specSummary: document.getElementById('spec-summary'),
  specMetrics: document.getElementById('spec-metrics'),
  deployBtn: document.getElementById('btn-deploy'),
  controlsBtn: document.getElementById('btn-controls'),
  dialog: document.getElementById('sim-dialog'),
  dialogTitle: document.getElementById('dialog-title'),
  dialogBody: document.getElementById('dialog-body'),
  dialogHangarBtn: document.getElementById('dialog-hangar-btn'),
  dialogCloseBtn: document.getElementById('dialog-close-btn'),
  pauseMenuBtn: document.getElementById('btn-pause-menu'),
  hud: {
    name: document.getElementById('hud-vehicle-name'),
    mission: document.getElementById('hud-mission-name'),
    kills: document.getElementById('hud-kills'),
    hostiles: document.getElementById('hud-hostiles'),
    hpFill: document.getElementById('hp-fill'),
    hpText: document.getElementById('hp-text'),
    thrFill: document.getElementById('thr-fill'),
    thrText: document.getElementById('thr-text'),
    throttleRow: document.getElementById('throttle-row'),
    throttleLabel: document.getElementById('throttle-label'),
    pillCam: document.getElementById('pill-cam'),
    pillGear: document.getElementById('pill-gear'),
    pillBrake: document.getElementById('pill-brake'),
    ammo: {
      cannon: document.getElementById('ammo-cannon'),
      sec1: document.getElementById('ammo-sec1'),
      sec2: document.getElementById('ammo-sec2'),
      flare: document.getElementById('ammo-flare'),
    },
    slots: [...document.querySelectorAll('.wep-slot')],
  },
  eventFeed: document.getElementById('event-feed'),
};

function vehicleLoadouts() {
  return LOADOUTS[state.vehicle.category] || [];
}

function refreshLoadoutOptions() {
  els.loadoutSelect.innerHTML = '';
  for (const lo of vehicleLoadouts()) {
    const opt = document.createElement('option');
    opt.value = lo.id;
    opt.textContent = lo.name;
    els.loadoutSelect.appendChild(opt);
  }
  const keep = vehicleLoadouts().find((l) => l.id === state.loadout?.id);
  state.loadout = keep || vehicleLoadouts()[0];
  els.loadoutSelect.value = state.loadout.id;
}

function renderVehicleList(cat) {
  els.vehicleList.innerHTML = '';
  for (const v of VEHICLES.filter((v) => v.category === cat)) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card' + (v.id === state.vehicle.id ? ' active' : '');
    card.innerHTML = `<strong>${v.name}</strong><span>${v.role}</span>`;
    card.onclick = async () => {
      state.vehicle = v;
      refreshLoadoutOptions();
      renderVehicleList(cat);
      updateSpecCard();
      await hangar.showVehicle(v, state.livery);
    };
    els.vehicleList.appendChild(card);
  }
}

function renderMissionList() {
  els.missionList.innerHTML = '';
  for (const m of MISSIONS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card' + (m.id === state.mission.id ? ' active' : '');
    card.innerHTML = `<strong>${m.title}</strong><span>Hostiles: ${m.enemyJets + m.enemyHelis + m.enemyTanks + m.enemyInfantry} · Recommended: ${m.recommendedCategory.toUpperCase()}</span>`;
    card.onclick = () => {
      state.mission = m;
      renderMissionList();
      updateSpecCard();
    };
    els.missionList.appendChild(card);
  }
}

function updateSpecCard() {
  const v = state.vehicle;
  els.specTitle.textContent = v.name;
  els.specSummary.textContent = v.summary;
  const s = v.specs;
  const metrics = v.category === 'tank'
    ? { 'Top Speed': `${Math.round(s.maxSpeedMs * 3.6)} km/h`, 'Hull HP': s.hp, 'Gun': s.cannon, 'Armor Front': `${s.armorFrontMm} mm` }
    : { 'Max Speed': `${Math.round(s.maxSpeedMs * 3.6)} km/h`, 'Thrust/AB': `${Math.round(s.thrustDry / 1000)} / ${Math.round(s.thrustAB / 1000)} kN`, 'Max G': `${s.maxG} g`, 'Armour HP': s.hp };
  els.specMetrics.innerHTML = Object.entries(metrics)
    .map(([k, val]) => `<div class="metric"><span>${k}</span><strong>${val}</strong></div>`)
    .join('');
}

function pushEvent(msg) {
  const row = document.createElement('div');
  row.className = 'event-row';
  row.textContent = msg;
  els.eventFeed.prepend(row);
  while (els.eventFeed.children.length > 5) els.eventFeed.lastChild.remove();
  setTimeout(() => row.remove(), 9000);
}

for (const tab of document.querySelectorAll('.tab-btn')) {
  tab.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    renderVehicleList(tab.dataset.cat);
  };
}

for (const l of LIVERIES) {
  const opt = document.createElement('option');
  opt.value = l.id;
  opt.textContent = l.name;
  els.liverySelect.appendChild(opt);
}
els.liverySelect.onchange = async () => {
  state.livery = LIVERIES.find((l) => l.id === els.liverySelect.value) || LIVERIES[0];
  await hangar.showVehicle(state.vehicle, state.livery);
};
els.loadoutSelect.onchange = () => {
  state.loadout = vehicleLoadouts().find((l) => l.id === els.loadoutSelect.value) || state.loadout;
};

const CONTROLS_HTML = `
  <h3>JET / HELICOPTER</h3>
  <p>W/S pitch · A/D roll · Q/E yaw · Shift throttle up · Ctrl throttle down · Space cannon · F missile · X flare · G gear · C cockpit</p>
  <h3>TANK</h3>
  <p>W/S drive · A/D steer · Space fire main gun · F coax / HEAT · X smoke · O gunner optics</p>
  <h3>GENERAL</h3>
  <p>V camera mode · Esc command menu</p>
`;

function openDialog(title, body, showHangarBtn) {
  els.dialogTitle.textContent = title;
  els.dialogBody.innerHTML = body;
  els.dialogHangarBtn.classList.toggle('hidden', !showHangarBtn);
  els.dialog.showModal();
}

els.controlsBtn.onclick = () => openDialog('FLIGHT & COMBAT CONTROLS', CONTROLS_HTML, false);
els.pauseMenuBtn.onclick = () => openDialog('COMMAND MENU // PAUSED', CONTROLS_HTML, true);
els.dialogCloseBtn.onclick = () => els.dialog.close();
els.dialogHangarBtn.onclick = () => {
  els.dialog.close();
  returnToHangar();
};

els.deployBtn.onclick = () => deploy();

// ---------------------------------------------------------------------------
// Deployment & sortie lifecycle
// ---------------------------------------------------------------------------

function createPlayerModel(def) {
  const model = new THREE.Group();
  assets.instantiate(def.modelUrl, state.livery).then((inst) => {
    model.add(inst.root);
    model.userData.pivots = inst;
  });
  return model;
}

async function deploy() {
  els.deployBtn.disabled = true;
  els.deployBtn.textContent = 'DEPLOYING...';
  els.hangarUI.classList.add('hidden');
  els.combatHUD.classList.add('hidden');
  hudCanvas.classList.add('hidden');
  if (hangar) hangar.setVisible(false);
  loader.show('PREPARING DEPLOYMENT');
  loader.setProgress(2, 'PREPARING DEPLOYMENT');
  loader.logLine(`VEHICLE: ${state.vehicle.name.toUpperCase()}`);
  loader.logLine(`AO: ${state.mission.title.split('//')[0].trim()}`);
  try {
    await assets.init();
    loader.setProgress(8, 'COMPILING EFFECTS SYSTEM');
    if (!vfx) {
      Object.assign(textures, {
        asphaltDiff: await assets.loadTexture('/assets/textures/asphalt_03/asphalt_03_diff.jpg'),
        asphaltNor: await assets.loadTexture('/assets/textures/asphalt_03/asphalt_03_nor_gl.jpg', false),
        asphaltRough: await assets.loadTexture('/assets/textures/asphalt_03/asphalt_03_rough.jpg', false),
        concreteDiff: await assets.loadTexture('/assets/textures/concrete_floor_worn_001/concrete_floor_worn_001_diff.jpg'),
        concreteNor: await assets.loadTexture('/assets/textures/concrete_floor_worn_001/concrete_floor_worn_001_nor_gl.jpg', false),
        concreteRough: await assets.loadTexture('/assets/textures/concrete_floor_worn_001/concrete_floor_worn_001_rough.jpg', false),
      });
      for (const [key, file] of [['fire', 'fire_01.png'], ['smoke', 'smoke_04.png'], ['spark', 'spark_05.png']]) {
        vfxTextures[key] = await assets.loadTexture(`/assets/vfx/${file}`);
      }
      vfx = new BattlefieldVFX(scene, vfxTextures);
      loader.setProgress(18, 'BUILDING BATTLEFIELD');
      battlefield = new BattlefieldBuilder(scene, assets, vfx, audio);
      weapons = new WeaponSystem(scene, assets, vfx, audio, battlefield);
      ai = new CombinedArmsAI(scene, assets, weapons, vfx, audio);
      ai.onEvent = (msg) => pushEvent(msg);
    }
    if (!battlefield.built) {
      await battlefield.buildAll(textures);
      battlefield.built = true;
    }
    loader.setProgress(72, 'STREAMING SKY & LIGHTING');
    scene.environment = await assets.loadHDRI(`/assets/hdri/${state.mission.hdri}_1k.hdr`);
    scene.background = scene.environment;

    const m = state.mission;
    const start = m.playerStart;
    const startPos = new THREE.Vector3(start.x, 0, start.z);
    const def = state.vehicle;
    const cat = def.category;

    if (cat === 'jet') {
      const airborne = m.startMode !== 'airbase_runway';
      if (airborne) startPos.y = getTerrainHeight(start.x, start.z) + 2400;
      else startPos.y = getTerrainHeight(start.x, start.z);
      state.player = new JetFlightModel(def, startPos, start.heading, airborne);
    } else if (cat === 'heli') {
      startPos.y = getTerrainHeight(start.x, start.z) + (m.startMode === 'airborne_low' ? 120 : 0.5);
      state.player = new HeliFlightModel(def, startPos, start.heading, m.startMode === 'airborne_low');
    } else {
      state.player = new TankPhysicsModel(def, startPos, start.heading);
    }

    loader.setProgress(82, 'ARMING VEHICLE');
    const playerRoot = createPlayerModel(def);
    state.player.root = playerRoot;
    state.player.id = 'player';
    state.player.team = 'blue';
    state.player.hitRadius = cat === 'tank' ? 4.0 : cat === 'heli' ? 8 : 9;
    state.player.category = cat;
    scene.add(playerRoot);

    loader.setProgress(90, 'SPAWNING COMBATANTS');
    await ai.spawnBattle(m);

    loader.setProgress(98, 'SORTIE READY');
    state.phase = 'sortie';
    state.kills = 0;
    state.cockpitView = false;
    state.gunnerOptics = false;
    state.camMode = '3rd';
    state.selectedWeapon = 'cannon';

    els.hud.name.textContent = def.name.toUpperCase();
    els.hud.mission.textContent = m.title.split('//')[0].trim();
    els.hud.throttleLabel.textContent = cat === 'tank' ? 'DRIVE' : 'THROTTLE';
    pushEvent(`SORTIE LAUNCHED — ${m.title}`);

    audio.init();
    audio.startVehicleLoop(cat);
    loader.setProgress(100, 'SORTIE LAUNCHED');
    setTimeout(() => loader.hide(), 350);
  } catch (err) {
    console.error('Deployment failed:', err);
    loader.setProgress(100, 'DEPLOYMENT FAILED — CHECK CONSOLE');
    pushEvent('DEPLOYMENT FAILED — CHECK CONSOLE');
    setTimeout(() => {
      loader.hide();
      els.hangarUI.classList.remove('hidden');
    }, 1200);
  } finally {
    els.deployBtn.disabled = false;
    els.deployBtn.textContent = 'LAUNCH SORTIE / DEPLOY';
  }
}

function returnToHangar() {
  state.phase = 'hangar';
  if (state.player?.root) scene.remove(state.player.root);
  state.player = null;
  if (ai) ai.clearAll();
  audio.stopVehicleLoop();
  els.hangarUI.classList.remove('hidden');
  els.combatHUD.classList.add('hidden');
  hudCanvas.classList.add('hidden');
  if (hangar) hangar.setVisible(true);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const keyMap = {
  KeyW: () => { input.pitch = -1; input.drive = 1; },
  KeyS: () => { input.pitch = 1; input.drive = -1; },
  KeyA: () => { input.roll = -1; input.steer = -1; },
  KeyD: () => { input.roll = 1; input.steer = 1; },
  KeyQ: () => { input.yaw = 1; },
  KeyE: () => { input.yaw = -1; },
  ShiftLeft: () => { input.throttleUp = true; },
  ControlLeft: () => { input.throttleDown = true; },
};

window.addEventListener('keydown', (e) => {
  if (state.phase !== 'sortie') return;
  if (keyMap[e.code]) { keyMap[e.code](); e.preventDefault(); return; }
  switch (e.code) {
    case 'Space': input.fireCannon = true; e.preventDefault(); break;
    case 'KeyF': input.fireMissileA = true; break;
    case 'KeyG':
      if (state.player instanceof JetFlightModel) state.player.gearDown = !state.player.gearDown;
      break;
    case 'KeyB': input.brake = true; break;
    case 'KeyX': input.flare = true; break;
    case 'KeyC': state.cockpitView = !state.cockpitView; break;
    case 'KeyO': state.gunnerOptics = !state.gunnerOptics; break;
    case 'KeyV':
      state.camMode = state.camMode === '3rd' ? 'chase' : '3rd';
      break;
    case 'Digit1': state.selectedWeapon = 'cannon'; break;
    case 'Digit2': state.selectedWeapon = 'sec1'; break;
    case 'Digit3': state.selectedWeapon = 'sec2'; break;
    case 'Escape': openDialog('COMMAND MENU // PAUSED', CONTROLS_HTML, true); break;
  }
});

window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'KeyS': input.pitch = 0; input.drive = 0; break;
    case 'KeyA': case 'KeyD': input.roll = 0; input.steer = 0; break;
    case 'KeyQ': case 'KeyE': input.yaw = 0; break;
    case 'ShiftLeft': input.throttleUp = false; break;
    case 'ControlLeft': input.throttleDown = false; break;
    case 'Space': input.fireCannon = false; break;
    case 'KeyB': input.brake = false; break;
  }
});

window.addEventListener('pointerdown', () => audio.init(), { once: true });

// ---------------------------------------------------------------------------
// Combat helpers
// ---------------------------------------------------------------------------

// Scratch objects reused every frame — allocating in the tick loop causes
// garbage-collection pauses (the periodic mid-sortie stutter)
const _fwd = new THREE.Vector3();
const _fwd2 = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _sunOffset = new THREE.Vector3(-900, 1400, 500);
const _playerAsUnit = { id: 'player', team: 'blue' };
const _unitsBuf = [null];
const SUN_OFFSET = new THREE.Vector3(-900, 1400, 500);

function playerForward(out = _fwd) {
  return out.set(0, 0, -1).applyQuaternion(state.player.quat);
}

function playerMuzzle(out = _tmp2) {
  return out.copy(state.player.pos).addScaledVector(playerForward(_fwd2), 8);
}

function acquireTarget() {
  let best = null;
  let bestScore = Infinity;
  const pp = state.player.pos;
  playerForward(_fwd2);
  for (const u of ai.units) {
    if (!u.alive || u.team === 'blue') continue;
    _tmp.copy(u.pos).sub(pp);
    const dist = _tmp.length();
    if (dist > 3500) continue;
    const align = _tmp.divideScalar(dist || 1).dot(_fwd2);
    if (align < 0.93) continue;
    const score = dist * (2 - align);
    if (score < bestScore) { bestScore = score; best = u; }
  }
  return best;
}

function playerAmmo() {
  const lo = state.loadout;
  if (!state.player || !lo) return { cannon: 0, sec1: 0, sec2: 0, flare: 0 };
  if (state.player.category === 'tank') {
    return { cannon: lo.ap + lo.heat, sec1: lo.coax, sec2: lo.heat, flare: lo.smoke };
  }
  return { cannon: lo.cannonAmmo, sec1: lo.aim9, sec2: lo.aim120, flare: lo.flares };
}

const ammoState = { cannon: 0, sec1: 0, sec2: 0, flare: 0 };

function resetAmmo() {
  const a = playerAmmo();
  Object.assign(ammoState, a);
}

function playerFire(dt) {
  const cat = state.player.category;

  if (input.fireCannon && ammoState.cannon > 0) {
    if (cat === 'tank') {
      if (state.player.reloadTimer <= 0) {
        ammoState.cannon--;
        state.player.reloadTimer = 6.5;
        const vel = playerForward().multiplyScalar(780);
        vel.y += Math.sin(state.player.gunElevation) * 0;
        weapons.spawnBullet(playerMuzzle().add(new THREE.Vector3(0, 2.2, 0)), vel, {
          ownerId: 'player', team: 'blue', dmg: 110, armorPenMm: 480, blastRadius: 7, isHeavyShell: true,
        });
        audio.playTankCannon(state.player.pos);
        state.player.recoilOffset = 0.4;
        vfx.spawnHitImpact(playerMuzzle(), playerForward(), true);
      }
    } else {
      ammoState.cannon--;
      const vel = playerForward().multiplyScalar(880)
        .add(new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12));
      weapons.spawnBullet(playerMuzzle(), vel, { ownerId: 'player', team: 'blue', dmg: 22, armorPenMm: 60 });
    }
  }

  if (input.fireMissileA && ammoState.sec1 > 0) {
    input.fireMissileA = false;
    const target = acquireTarget();
    if (cat === 'tank') {
      ammoState.sec1--;
      weapons.spawnBullet(playerMuzzle().add(new THREE.Vector3(0, 2.2, 0)), playerForward().multiplyScalar(700), {
        ownerId: 'player', team: 'blue', dmg: 130, armorPenMm: 250, blastRadius: 9, isHeavyShell: true,
      });
      audio.playTankCannon(state.player.pos);
    } else {
      ammoState.sec1--;
      weapons.spawnMissile(playerMuzzle(), state.player.quat, state.player.vel, {
        ownerId: 'player', team: 'blue', target, type: 'aim9',
      });
      if (!target) pushEvent('IR MISSILE AWAY — NO LOCK (UNCAGED SHOT)');
    }
  }

  if (input.fireMissileB && ammoState.sec2 > 0) {
    input.fireMissileB = false;
    const target = acquireTarget();
    if (cat !== 'tank') {
      ammoState.sec2--;
      weapons.spawnMissile(playerMuzzle(), state.player.quat, state.player.vel, {
        ownerId: 'player', team: 'blue', target, type: cat === 'heli' ? 'agm' : 'aim120',
      });
      if (!target) pushEvent(cat === 'heli' ? 'AGM AWAY — BALLISTIC RELEASE' : 'RADAR MISSILE AWAY');
    }
  }

  if (input.flare && ammoState.flare > 0) {
    input.flare = false;
    if (cat !== 'tank') {
      weapons.spawnFlare(state.player.pos, state.player.vel);
      ammoState.flare -= 1;
      pushEvent('FLARES DEPLOYED');
    }
  }
  input.flare = cat === 'tank' ? input.flare : false;
}

function onUnitDamage(u, dmg, ownerId) {
  u.hp -= dmg;
  if (u.hp <= 0 && u.alive) {
    u.alive = false;
    vfx.spawnExplosion(u.pos, u.category === 'tank' ? 2.0 : 3.0, true);
    audio.playExplosion(u.pos, true);
    if (ownerId === 'player') {
      state.kills++;
      pushEvent(`TARGET DESTROYED — ${u.name}`);
    }
  } else if (ownerId === 'player') {
    pushEvent(`HIT — ${u.name}`);
  }
}

function onPlayerDamage(dmg, sourcePos) {
  const p = state.player;
  if (!p.alive) return;
  p.hp -= dmg;
  const hit = document.getElementById('hit-vignette');
  if (hit) {
    hit.style.opacity = '0.85';
    setTimeout(() => { hit.style.opacity = '0'; }, 180);
  }
  if (p.hp <= 0) {
    p.alive = false;
    vfx.spawnExplosion(p.pos, 3.4, true);
    audio.playExplosion(p.pos, true);
    scene.remove(p.root);
    audio.stopVehicleLoop();
    openDialog(
      'SORTIE ENDED — AIRFRAME DESTROYED',
      `<p>Confirmed kills: <strong>${state.kills}</strong></p><p>${state.mission.briefing}</p>`,
      true
    );
  }
}

// ---------------------------------------------------------------------------
// Camera & HUD update
// ---------------------------------------------------------------------------

function collectUnits() {
  const out = _unitsBuf;
  out.length = 0;
  if (state.player && state.player.alive) out.push(state.player);
  for (const u of ai.units) if (u && u.alive) out.push(u);
  return out;
}

function updateCamera(dt) {
  const p = state.player;
  if (!p) return;
  const cat = p.category;

  if (cat === 'tank' && state.gunnerOptics) {
    playerMuzzle(_tmp2);
    camera.position.copy(p.pos).add(_tmp.set(0, 3.1, 0));
    camera.lookAt(_tmp2.copy(p.pos).addScaledVector(playerForward(_fwd), 300));
    camera.fov = 18;
  } else if (cat !== 'tank' && state.cockpitView) {
    camera.position.copy(p.pos).addScaledVector(playerForward(_fwd), 3.2).add(_tmp.set(0, 0.9, 0));
    camera.up.set(0, 1, 0).applyQuaternion(p.quat);
    camera.lookAt(_tmp2.copy(p.pos).addScaledVector(playerForward(_fwd2), 60));
    camera.fov = 70;
  } else {
    const back = playerForward(_fwd).multiplyScalar(cat === 'tank' ? 14 : 22);
    _tmp2.copy(p.pos).sub(back).add(_tmp.set(0, cat === 'tank' ? 6 : 7, 0));
    const gY = getTerrainHeight(_tmp2.x, _tmp2.z) + 2.5;
    if (_tmp2.y < gY) _tmp2.y = gY;
    camera.position.lerp(_tmp2, 1 - Math.exp(-7 * dt));
    camera.up.set(0, 1, 0);
    camera.lookAt(_tmp.copy(p.pos).addScaledVector(playerForward(_fwd2), 25));
    camera.fov = cat === 'tank' ? 58 : 66;
  }
  // Ease zoom between camera modes instead of snapping
  _targetFov += (camera.fov - _targetFov) * (1 - Math.exp(-8 * dt));
  camera.fov = _targetFov;
  camera.updateProjectionMatrix();
}

let _targetFov = 66;
let hudTimer = 0;
function updateHUD(dt) {
  const p = state.player;
  const a = playerAmmo();

  // DOM writes every frame cause layout thrash; 10 Hz is plenty for readouts
  hudTimer += dt;
  if (hudTimer < 0.1) return;
  hudTimer = 0;

  els.hud.hpFill.style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
  els.hud.hpText.textContent = `${Math.max(0, Math.round((p.hp / p.maxHp) * 100))}%`;

  if (p.category === 'tank') {
    els.hud.thrFill.style.width = `${Math.min(100, Math.abs(p.speed) / p.specs.maxSpeedMs * 100)}%`;
    els.hud.thrText.textContent = `${Math.round(Math.abs(p.speed) * 3.6)} KM/H`;
    els.hud.pillGear.classList.add('hidden');
    els.hud.pillBrake.classList.remove('hidden');
  } else {
    els.hud.thrFill.style.width = `${p.throttle * 100}%`;
    els.hud.thrText.textContent = `${Math.round(p.throttle * 100)}%`;
    els.hud.pillGear.classList.remove('hidden');
    els.hud.pillGear.textContent = `[G] GEAR: ${p.gearDown ? 'DOWN' : 'UP'}`;
  }

  els.hud.pillCam.textContent = `[V] CAM: ${state.cockpitView ? 'COCKPIT' : state.camMode.toUpperCase()}`;
  els.hud.kills.textContent = state.kills;
  let hostiles = 0;
  for (const u of ai.units) if (u.alive && u.team === 'red') hostiles++;
  els.hud.hostiles.textContent = hostiles;

  els.hud.ammo.cannon.textContent = ammoState.cannon;
  els.hud.ammo.sec1.textContent = ammoState.sec1;
  els.hud.ammo.sec2.textContent = ammoState.sec2;
  els.hud.ammo.flare.textContent = ammoState.flare;

  const slotFor = (w) => els.hud.slots.find((s) => s.dataset.wep === w);
  for (const s of els.hud.slots) s.classList.toggle('active', s.dataset.wep === state.selectedWeapon);
  void slotFor;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();

async function init() {
  await assets.init();
  hangar = new MilitaryHangarStage(scene, assets);
  await hangar.showVehicle(state.vehicle, state.livery);
  refreshLoadoutOptions();
  renderVehicleList('jet');
  renderMissionList();
  updateSpecCard();
  renderer.setAnimationLoop(tick);
  loader.setProgress(100, 'SYSTEMS ONLINE');
  setTimeout(() => loader.hide(), 300);
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  state.time += dt;

  // Dynamic resolution scaling: hold a stable frame rate by trading render
  // resolution — smooth motion beats a few extra pixels
  fpsAvg += (dt * 1000 - fpsAvg) * 0.05;
  resTimer += dt;
  if (resTimer > 1) {
    resTimer = 0;
    if (fpsAvg > 23 && resScale > 0.62) {
      resScale = Math.max(0.62, resScale - 0.14);
      renderer.setPixelRatio(basePixelRatio * resScale);
    } else if (fpsAvg < 14.5 && resScale < 1) {
      resScale = Math.min(1, resScale + 0.08);
      renderer.setPixelRatio(basePixelRatio * resScale);
    }
  }

  if (state.phase === 'hangar' && hangar) {
    hangar.update(dt, camera);
    renderer.render(scene, camera);
    return;
  }

  const p = state.player;
  if (p && p.alive) {
    const cat = p.category;
    if (cat === 'tank') {
      const aimDir = playerForward();
      const aimYaw = Math.atan2(-aimDir.x, -aimDir.z);
      p.update(dt, input, aimYaw, Math.asin(THREE.MathUtils.clamp(aimDir.y, -1, 1)));
    } else {
      p.update(dt, input);
    }
    p.root.position.copy(p.pos);
    p.root.quaternion.copy(p.quat);

    const inst = p.root.userData.pivots;
    if (inst) {
      if (p.category === 'tank' && inst.turretPivot) {
        inst.turretPivot.rotation.y = p.turretWorldYaw - p.heading;
        if (inst.gunPivot) inst.gunPivot.rotation.x = -p.gunElevation;
      }
      if (p.category === 'heli') {
        if (inst.rotorMain) inst.rotorMain.rotation.y += 30 * dt;
        if (inst.rotorTail) inst.rotorTail.rotation.x += 36 * dt;
      }
    }

    state.lockedTarget = acquireTarget();
    state.lockProgress = state.lockedTarget
      ? Math.min(1, state.lockProgress + dt / 1.1)
      : Math.max(0, state.lockProgress - dt * 2);

    playerFire(dt);
    audio.updateListener(p.pos, playerForward(_fwd), _up.set(0, 1, 0).applyQuaternion(p.quat));
    audio.updateVehicleLoop(dt, {
      throttle: p.throttle ?? Math.abs(p.speed ?? 0),
      afterburner: p.afterburner,
      speed: p.airspeed ?? Math.abs(p.speed ?? 0),
      mach: p.mach ?? 0,
    });
    sun.target.position.copy(p.pos);
    sun.position.copy(p.pos).add(_sunOffset.copy(SUN_OFFSET));
  }

  weapons.update(dt, collectUnits(), onUnitDamage, (msg) => pushEvent(msg));
  if (p && p.alive) {
    _playerAsUnit.pos = p.pos;
    _playerAsUnit.vel = p.vel;
    _playerAsUnit.quat = p.quat;
    _playerAsUnit.alive = true;
    _playerAsUnit.category = p.category;
    _playerAsUnit.hitRadius = p.hitRadius;
    _playerAsUnit.hp = p.hp;
    ai.update(dt, _playerAsUnit);
  } else {
    ai.update(dt, null);
  }
  battlefield.update(dt);
  vfx.update(dt);

  // Player damage passthrough: bullets/missiles owned by 'player' hit AI via
  // onUnitDamage; AI shots hitting the player are resolved here.
  for (const proj of weapons.projectiles) {
    if (p?.alive && proj.team !== 'blue' && proj.pos.distanceTo(p.pos) < (p.hitRadius || 8)) {
      proj.life = 0;
      proj.pos.copy(p.pos);
      onPlayerDamage(proj.dmg, proj.pos);
    }
  }
  for (const m of weapons.missiles) {
    if (p?.alive && m.team !== 'blue' && m.pos.distanceTo(p.pos) < 14) {
      m.life = 0;
      m.pos.copy(p.pos);
      onPlayerDamage(m.dmg * 0.8, m.pos);
    }
  }

  updateCamera(dt);
  // Shadow maps refresh every 2nd frame (autoUpdate is off) — imperceptible
  // for a moving sun, but removes that pass from every other frame
  sun.shadow.needsUpdate = !sun.shadow.needsUpdate;
  if (p) {
    hud.render({
      camera,
      playerUnit: p,
      units: ai.units,
      lockedTarget: state.lockedTarget,
      lockProgress: state.lockProgress,
      cockpitView: state.cockpitView,
      gunnerOptics: state.gunnerOptics,
      selectedWeapon: state.selectedWeapon,
    });
    updateHUD(dt);
  }

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  hud.resize?.();
});

resetAmmo();
init();
