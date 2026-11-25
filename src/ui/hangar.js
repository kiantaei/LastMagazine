import * as THREE from 'three';

/**
 * Interactive 3D Military Hangar Preview Stage
 * Places the player's currently selected & customized 3D asset on a concrete airfield pad
 * with rotating inspection camera while configuring liveries, loadouts, and missions.
 */
export class MilitaryHangarStage {
  constructor(scene, assets) {
    this.scene = scene;
    this.assets = assets;
    this.group = new THREE.Group();
    this.group.position.set(0, 2600, 0); // Isolated high-altitude studio pad above clouds
    this.scene.add(this.group);

    this.currentModel = null;
    this.orbitAngle = 0.65;
    this.loadingToken = 0;

    this._buildStage();
  }

  _buildStage() {
    // Circular concrete turntable pad
    const padGeo = new THREE.CylinderGeometry(16, 16.5, 0.4, 48);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x33383f,
      roughness: 0.78,
      metalness: 0.15,
    });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.y = -0.2;
    pad.receiveShadow = true;
    this.group.add(pad);

    // Subtle yellow hazard ring
    const ringGeo = new THREE.RingGeometry(14.8, 15.3, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xd97706, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.02;
    this.group.add(ring);

    // Hangar warm rim spotlight
    const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.2);
    keyLight.position.set(18, 22, 16);
    this.group.add(keyLight);

    const rimLight = new THREE.PointLight(0x60a5fa, 35, 45);
    rimLight.position.set(-14, 7, -12);
    this.group.add(rimLight);
  }

  async showVehicle(vehicleDef, livery) {
    const token = ++this.loadingToken;
    const inst = await this.assets.instantiate(vehicleDef.modelUrl, livery);
    if (token !== this.loadingToken) return;

    if (this.currentModel) {
      this.group.remove(this.currentModel);
    }
    this.currentModel = inst.root;
    // Lift aircraft slightly so wheels/belly rest cleanly on hangar pad
    if (vehicleDef.category === 'jet' || vehicleDef.category === 'heli') {
      const box = new THREE.Box3().setFromObject(this.currentModel);
      this.currentModel.position.y = -box.min.y + 0.05;
    }
    this.group.add(this.currentModel);
  }

  setVisible(v) {
    this.group.visible = v;
  }

  update(dt, camera) {
    if (!this.group.visible) return;
    this.orbitAngle += dt * 0.28;
    const radius = 19.5;
    camera.position.set(
      this.group.position.x + Math.sin(this.orbitAngle) * radius,
      this.group.position.y + 5.2,
      this.group.position.z + Math.cos(this.orbitAngle) * radius
    );
    camera.lookAt(this.group.position.x, this.group.position.y + 1.8, this.group.position.z);
  }
}
