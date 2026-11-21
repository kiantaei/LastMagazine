import * as THREE from 'three';

function flameTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(64, 190, 8, 64, 150, 120);
  g.addColorStop(0, 'rgba(255,246,196,1)');
  g.addColorStop(0.35, 'rgba(255,158,58,0.85)');
  g.addColorStop(0.7, 'rgba(210,52,10,0.36)');
  g.addColorStop(1, 'rgba(90,12,0,0)');
  ctx.fillStyle = g;
  // teardrop: wider at the base, tapering up
  ctx.beginPath();
  ctx.moveTo(24, 240);
  ctx.quadraticCurveTo(20, 150, 64, 22);
  ctx.quadraticCurveTo(108, 150, 104, 240);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface Fire {
  /** flame centre (world) — used to place the crackle audio emitter */
  readonly position: THREE.Vector3;
  update(dt: number): void;
}

/**
 * A burning barrel: rusted drum, glowing coals, two crossed additive flame
 * quads and the flickering PointLight. Fires are the only light sources in
 * the arena besides the player's weapon light.
 */
export function createFire(
  barrelGeo: THREE.CylinderGeometry,
  barrelMat: THREE.Material,
  x: number,
  z: number,
  seed = 1,
): { object: THREE.Object3D; light: THREE.PointLight; fire: Fire } {
  const rnd = (() => {
    let a = seed * 1e4 + 0x9e37;
    return () => {
      a = (a * 16807) % 2147483647;
      return a / 2147483647;
    };
  })();

  const group = new THREE.Group();
  group.position.set(x, 0, z);

  // half-buried barrel with the top third cut open
  const drum = new THREE.Mesh(barrelGeo, barrelMat);
  drum.position.y = 0.55;
  drum.castShadow = drum.receiveShadow = true;
  group.add(drum);

  // coals
  const coals = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 12, 8),
    new THREE.MeshStandardMaterial({
      color: 0x1a0b06,
      emissive: 0xff5a14,
      emissiveIntensity: 2.4,
      roughness: 0.9,
    }),
  );
  coals.scale.set(1, 0.45, 1);
  coals.position.y = 0.92;
  group.add(coals);

  // crossed flame quads
  const tex = flameTexture();
  const flames: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      opacity: 0.92,
      fog: false, // fires stay visible beacons through the night fog
    });
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.15), mat);
    f.position.y = 1.42;
    f.rotation.y = (i * Math.PI) / 3;
    group.add(f);
    flames.push(f);
  }

  // the flickering light
  const light = new THREE.PointLight(0xff8a3a, 88, 30, 2);
  light.position.y = 1.5;
  group.add(light);

  const phase = rnd() * Math.PI * 2;
  const speedA = 7 + rnd() * 4;
  const speedB = 13 + rnd() * 6;
  const fire: Fire = {
    position: new THREE.Vector3(x, 1.4, z),
    update(dt: number) {
      const t = performance.now() / 1000;
      const n =
        0.5 +
        0.22 * Math.sin(t * speedA + phase) +
        0.16 * Math.sin(t * speedB + phase * 2.7) +
        0.12 * Math.sin(t * 29.7 + phase * 5.1);
      light.intensity = 88 * (0.72 + 0.55 * n);
      light.position.y = 1.5 + 0.06 * Math.sin(t * 11 + phase);
      coals.material.emissiveIntensity = 1.9 + 0.9 * n;
      const h = 0.98 + 0.3 * n;
      for (const f of flames) {
        f.scale.set(0.95 + 0.2 * n, h, 1);
        f.rotation.z = 0.06 * Math.sin(t * 9 + f.rotation.y * 3);
        (f.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.25 * n;
      }
    },
  };

  return { object: group, light, fire };
}
