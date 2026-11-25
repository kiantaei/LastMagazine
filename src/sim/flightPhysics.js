import * as THREE from 'three';
import { getTerrainHeight, getTerrainNormal } from '../world/terrain.js';

/**
 * Realistic Aerodynamic Jet Flight Physics Model
 * Computes air density vs altitude, Angle of Attack (AoA), lift/induced-drag polars,
 * stall behavior, G-load blackout/redout, afterburner thrust, and runway gear contact.
 */
export class JetFlightModel {
  constructor(vehicleDef, startPos, headingRad, airborne = false) {
    this.def = vehicleDef;
    this.specs = vehicleDef.specs;

    this.pos = startPos.clone();
    this.quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, headingRad, 0, 'YXZ'));

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
    this.vel = airborne ? fwd.multiplyScalar(210) : new THREE.Vector3();

    this.throttle = airborne ? 0.78 : 0.0;
    this.afterburner = false;
    this.gearDown = !airborne;
    this.airbrakes = false;
    this.onGround = !airborne;

    this.airspeed = this.vel.length();
    this.mach = this.airspeed / 340.3;
    this.aoaDeg = 0;
    this.gLoad = 1.0;
    this.agl = 0;
    this.angVel = new THREE.Vector3(); // pitch, yaw, roll rates in body frame

    // Damage states
    this.hp = this.specs.hp;
    this.maxHp = this.specs.hp;
    this.alive = true;
    this.engineFire = false;
  }

  update(dt, input) {
    if (!this.alive) return;

    // Throttle control
    if (input.throttleUp) this.throttle = Math.min(1.0, this.throttle + 0.45 * dt);
    if (input.throttleDown) this.throttle = Math.max(0.0, this.throttle - 0.55 * dt);
    this.afterburner = this.throttle > 0.86;
    this.airbrakes = Boolean(input.airbrake);

    const invQuat = this.quat.clone().invert();
    const velLocal = this.vel.clone().applyQuaternion(invQuat);
    const speed = this.vel.length();
    this.airspeed = speed;

    // Speed of sound drops slightly with altitude
    const sos = Math.max(295, 340.3 - this.pos.y * 0.004);
    this.mach = speed / sos;

    // Air density exponential drop with altitude
    const rho = 1.225 * Math.exp(-Math.max(0, this.pos.y) / 8500);
    const q = 0.5 * rho * speed * speed;

    // Angle of attack (degrees)
    const forwardSpeed = Math.max(1.0, -velLocal.z);
    const aoaRad = speed > 8 ? Math.atan2(-velLocal.y, forwardSpeed) : 0;
    this.aoaDeg = THREE.MathUtils.radToDeg(aoaRad);

    // Control authority scales with dynamic pressure (fly-by-wire damped)
    const authority = THREE.MathUtils.clamp(speed / 55, 0.12, 1.15);
    const targetPitchRate = input.pitch * this.specs.pitchRate * authority;
    const targetRollRate = input.roll * this.specs.rollRate * authority;
    const targetYawRate = input.yaw * this.specs.yawRate * authority;

    // Smooth angular response + weathervane sideslip stability
    const sideSlipRad = speed > 15 ? Math.atan2(velLocal.x, forwardSpeed) : 0;
    this.angVel.x = THREE.MathUtils.lerp(this.angVel.x, targetPitchRate - aoaRad * 0.18, 1 - Math.exp(-8 * dt));
    this.angVel.y = THREE.MathUtils.lerp(this.angVel.y, targetYawRate - sideSlipRad * 0.9, 1 - Math.exp(-7 * dt));
    this.angVel.z = THREE.MathUtils.lerp(this.angVel.z, targetRollRate, 1 - Math.exp(-10 * dt));

    // Apply body angular velocity to quaternion
    const dq = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.angVel.x * dt, this.angVel.y * dt, this.angVel.z * dt, 'YXZ')
    );
    this.quat.multiply(dq).normalize();

    // Aerodynamic forces in world space
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);

    // Lift coefficient CL(alpha) with stall peak around 23 deg
    const stallRad = THREE.MathUtils.degToRad(23);
    let cl = 0;
    if (Math.abs(aoaRad) < stallRad) {
      cl = 0.16 + 4.4 * aoaRad;
    } else {
      cl = 0.16 + 4.4 * Math.sign(aoaRad) * stallRad * Math.max(0.35, 1.0 - (Math.abs(aoaRad) - stallRad) * 1.4);
    }

    const wingArea = this.specs.wingArea;
    const liftMag = q * wingArea * cl;
    const dragCoeff = 0.022 + 0.068 * cl * cl + (this.gearDown ? 0.028 : 0) + (this.airbrakes ? 0.075 : 0);
    const dragMag = q * wingArea * dragCoeff;

    // Thrust
    const dryFrac = Math.min(this.throttle / 0.86, 1.0);
    const abFrac = this.afterburner ? (this.throttle - 0.86) / 0.14 : 0;
    let thrustMag = dryFrac * this.specs.thrustDry + abFrac * (this.specs.thrustAB - this.specs.thrustDry);
    if (this.engineFire) thrustMag *= 0.55;

    // Cap realistic max speed via supersonic wave drag
    const machDrag = this.mach > 0.95 ? Math.pow(this.mach - 0.95, 2) * 190000 : 0;

    const totalForce = new THREE.Vector3();
    totalForce.addScaledVector(fwd, thrustMag);
    totalForce.addScaledVector(up, liftMag);
    if (speed > 0.5) {
      totalForce.addScaledVector(this.vel, -(dragMag + machDrag) / speed);
      // Side force to damp lateral drift cleanly
      totalForce.addScaledVector(right, -velLocal.x * q * 0.14);
    }
    totalForce.y -= 9.81 * this.specs.massKg;

    const accel = totalForce.divideScalar(this.specs.massKg);
    this.vel.addScaledVector(accel, dt);

    // G-Load approximation
    const liftAccelG = liftMag / (this.specs.massKg * 9.81);
    this.gLoad = THREE.MathUtils.lerp(this.gLoad, liftAccelG + up.y * 0.25, 1 - Math.exp(-10 * dt));

    this.pos.addScaledVector(this.vel, dt);

    // Keep inside 12km theatre
    if (Math.abs(this.pos.x) > 5700) {
      this.pos.x = Math.sign(this.pos.x) * 5700;
      this.vel.x *= -0.5;
    }
    if (Math.abs(this.pos.z) > 5700) {
      this.pos.z = Math.sign(this.pos.z) * 5700;
      this.vel.z *= -0.5;
    }
    if (this.pos.y > 4200) {
      this.pos.y = 4200;
      this.vel.y = Math.min(0, this.vel.y);
    }

    // Terrain & Runway Ground Contact
    const groundY = getTerrainHeight(this.pos.x, this.pos.z);
    const gearClearance = this.gearDown ? 2.3 : 1.4;
    this.agl = Math.max(0, this.pos.y - groundY);

    if (this.pos.y <= groundY + gearClearance) {
      // Check hard impact crash
      if (this.vel.y < -14 || (!this.gearDown && speed > 35)) {
        this.hp = 0;
        this.alive = false;
        return;
      }
      this.pos.y = groundY + gearClearance;
      this.vel.y = Math.max(0, this.vel.y);
      this.onGround = true;

      // Ground friction / wheel brakes
      const brakeDrag = input.airbrake || this.throttle < 0.05 ? 1.8 : 0.18;
      this.vel.multiplyScalar(Math.exp(-brakeDrag * dt));

      // Keep aircraft level with runway when rolling slowly
      const euler = new THREE.Euler().setFromQuaternion(this.quat, 'YXZ');
      euler.z = THREE.MathUtils.lerp(euler.z, 0, 1 - Math.exp(-10 * dt));
      if (speed < this.specs.stallSpeedMs * 0.85 && euler.x < 0) {
        euler.x = THREE.MathUtils.lerp(euler.x, 0, 1 - Math.exp(-8 * dt));
      }
      euler.x = THREE.MathUtils.clamp(euler.x, -0.05, 0.35);
      this.quat.setFromEuler(euler);
    } else {
      this.onGround = false;
      if (this.agl > 45 && this.gearDown && !input.manualGear) {
        this.gearDown = false;
      }
    }
  }
}

/**
 * Attack Helicopter Flight Physics Model (Collective, Cyclic, Ground Effect)
 */
export class HeliFlightModel {
  constructor(vehicleDef, startPos, headingRad, airborne = true) {
    this.def = vehicleDef;
    this.specs = vehicleDef.specs;
    this.pos = startPos.clone();
    this.quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, headingRad, 0, 'YXZ'));
    this.vel = new THREE.Vector3();

    this.collective = airborne ? 0.42 : 0.15;
    this.pitch = 0;
    this.roll = 0;
    this.yaw = headingRad;
    this.airspeed = 0;
    this.agl = 0;
    this.gLoad = 1.0;
    this.mach = 0;

    this.hp = this.specs.hp;
    this.maxHp = this.specs.hp;
    this.alive = true;
  }

  update(dt, input) {
    if (!this.alive) return;

    // Collective controls vertical climb/hover
    if (input.throttleUp) this.collective = Math.min(1.0, this.collective + 0.55 * dt);
    if (input.throttleDown) this.collective = Math.max(0.0, this.collective - 0.55 * dt);

    // Cyclic pitch/roll (auto-levels gently when neutral for realistic AFCS stabilization)
    this.pitch = THREE.MathUtils.lerp(this.pitch, input.pitch * 0.48, 1 - Math.exp(-5.5 * dt));
    this.roll = THREE.MathUtils.lerp(this.roll, -input.roll * 0.55, 1 - Math.exp(-6.0 * dt));
    this.yaw += input.yaw * this.specs.yawRate * dt;

    this.quat.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ'));

    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
    const groundY = getTerrainHeight(this.pos.x, this.pos.z);
    this.agl = Math.max(0, this.pos.y - groundY);

    // Ground effect cushion within 14m AGL + translational lift bonus
    const groundEffect = this.agl < 14 ? (1.0 - this.agl / 14) * 3.5 : 0;
    const transLift = Math.min(this.vel.length() / 22, 1.0) * 2.2;
    const liftAccel = this.collective * this.specs.maxLift + groundEffect + transLift;

    const force = up.multiplyScalar(liftAccel);
    force.y -= 9.81;

    // Aerodynamic fuselage drag
    force.addScaledVector(this.vel, -0.45);
    this.vel.addScaledVector(force, dt);
    if (this.vel.length() > this.specs.maxSpeedMs) {
      this.vel.setLength(this.specs.maxSpeedMs);
    }

    this.pos.addScaledVector(this.vel, dt);
    this.airspeed = this.vel.length();
    this.mach = this.airspeed / 340.3;

    // Theatre clamp
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -5600, 5600);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -5600, 5600);
    this.pos.y = Math.min(this.pos.y, 1800);

    const newGroundY = getTerrainHeight(this.pos.x, this.pos.z);
    this.agl = Math.max(0, this.pos.y - newGroundY);
    if (this.pos.y < newGroundY + 2.1) {
      if (this.vel.y < -11) {
        this.hp = 0;
        this.alive = false;
        return;
      }
      this.pos.y = newGroundY + 2.1;
      this.vel.y = Math.max(0, this.vel.y);
      this.vel.x *= Math.exp(-3.5 * dt);
      this.vel.z *= Math.exp(-3.5 * dt);
    }
  }
}

/**
 * Main Battle Tank Tracked Physics, Suspension & Gyro-Stabilized Turret Model
 */
export class TankPhysicsModel {
  constructor(vehicleDef, startPos, headingRad) {
    this.def = vehicleDef;
    this.specs = vehicleDef.specs;
    this.pos = startPos.clone();
    this.pos.y = getTerrainHeight(this.pos.x, this.pos.z);

    this.heading = headingRad;
    this.speed = 0;
    this.throttle = 0;
    this.quat = new THREE.Quaternion();

    // Independent world-yaw turret & barrel elevation
    this.turretWorldYaw = headingRad;
    this.gunElevation = 0.03;
    this.reloadTimer = 0;
    this.recoilOffset = 0;

    this.hp = this.specs.hp;
    this.maxHp = this.specs.hp;
    this.alive = true;
  }

  update(dt, input, aimYawWorld, aimElevRad) {
    if (!this.alive) return;

    if (this.reloadTimer > 0) this.reloadTimer = Math.max(0, this.reloadTimer - dt);
    this.recoilOffset = THREE.MathUtils.lerp(this.recoilOffset, 0, 1 - Math.exp(-8 * dt));

    // Tracked steering & drive
    const drive = input.drive || 0; // -1..1
    const steer = input.steer || 0; // -1..1
    this.throttle = drive;

    const turnScale = Math.abs(this.speed) < 1.5 ? 1.15 : 0.88; // neutral pivot turn
    this.heading += steer * this.specs.turnRate * turnScale * dt;

    const targetSpeed = drive > 0 ? drive * this.specs.maxSpeedMs : drive * this.specs.reverseSpeedMs;
    const accelRate = drive !== 0 ? this.specs.accel : this.specs.accel * 1.45;
    this.speed = THREE.MathUtils.lerp(this.speed, targetSpeed, 1 - Math.exp(-accelRate * 0.45 * dt));

    const fwdX = -Math.sin(this.heading);
    const fwdZ = -Math.cos(this.heading);
    this.pos.x = THREE.MathUtils.clamp(this.pos.x + fwdX * this.speed * dt, -5600, 5600);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z + fwdZ * this.speed * dt, -5600, 5600);

    // Terrain height & suspension slope alignment
    const targetY = getTerrainHeight(this.pos.x, this.pos.z);
    this.pos.y = THREE.MathUtils.lerp(this.pos.y, targetY, 1 - Math.exp(-14 * dt));

    const normal = getTerrainNormal(this.pos.x, this.pos.z);
    const forwardVec = new THREE.Vector3(fwdX, 0, fwdZ);
    const rightVec = new THREE.Vector3().crossVectors(forwardVec, normal).normalize();
    const alignedFwd = new THREE.Vector3().crossVectors(normal, rightVec).normalize();
    const m = new THREE.Matrix4().makeBasis(rightVec, normal, alignedFwd.clone().negate());
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(m);
    this.quat.slerp(targetQuat, 1 - Math.exp(-10 * dt));

    // Turret traverse toward player aim yaw (realistic electric/hydraulic slew speed)
    let diff = ((aimYawWorld - this.turretWorldYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    const maxStep = this.specs.turretSlewRate * dt;
    if (Math.abs(diff) <= maxStep) {
      this.turretWorldYaw = aimYawWorld;
    } else {
      this.turretWorldYaw += Math.sign(diff) * maxStep;
    }

    // Gun elevation clamped to realistic depression/elevation limits
    const clampedElev = THREE.MathUtils.clamp(aimElevRad, this.specs.gunElevMin, this.specs.gunElevMax);
    const elevDiff = clampedElev - this.gunElevation;
    const elevStep = 0.45 * dt;
    this.gunElevation += Math.abs(elevDiff) <= elevStep ? elevDiff : Math.sign(elevDiff) * elevStep;
  }
}
