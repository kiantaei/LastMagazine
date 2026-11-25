import * as THREE from 'three';

/**
 * Vector Avionics HUD, Target Lock Diamond, Lead Pipper, Tank Ballistic Reticle & Radar Scope
 */
export class CombatHUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * dpr);
    this.canvas.height = Math.floor(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear() {
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  render({
    camera,
    playerUnit,
    units,
    lockedTarget,
    lockProgress,
    cockpitView,
    gunnerOptics,
    selectedWeapon,
  }) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!playerUnit) return;

    const cx = this.w / 2;
    const cy = this.h / 2;

    if (playerUnit.category === 'jet' || playerUnit.category === 'heli') {
      this._drawAirHUD(ctx, cx, cy, camera, playerUnit, cockpitView, lockedTarget, lockProgress, selectedWeapon);
    } else {
      this._drawTankHUD(ctx, cx, cy, camera, playerUnit, gunnerOptics);
    }

    this._drawTargetMarkers(ctx, camera, playerUnit, units, lockedTarget, lockProgress);
    this._drawRadarScope(ctx, playerUnit, units);
  }

  _drawAirHUD(ctx, cx, cy, camera, p, cockpitView, lockedTarget, lockProgress, selectedWeapon) {
    const hudColor = 'rgba(74, 246, 138, 0.88)';
    ctx.strokeStyle = hudColor;
    ctx.fillStyle = hudColor;
    ctx.lineWidth = 1.6;
    ctx.font = '700 12px "JetBrains Mono", Consolas, monospace';

    // Aircraft Euler pitch/roll/yaw
    const euler = new THREE.Euler().setFromQuaternion(p.quat, 'YXZ');
    const pitchDeg = THREE.MathUtils.radToDeg(euler.x);
    const rollRad = euler.z;
    const headingDeg = ((THREE.MathUtils.radToDeg(-euler.y) % 360) + 360) % 360;

    // 1. Center Boresight Cross
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy);
    ctx.lineTo(cx - 5, cy);
    ctx.moveTo(cx + 5, cy);
    ctx.lineTo(cx + 14, cy);
    ctx.moveTo(cx, cy - 14);
    ctx.lineTo(cx, cy - 5);
    ctx.stroke();

    // 2. Pitch Ladder & Horizon Line (clipped to central HUD glass zone)
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - 190, cy - 170, 380, 340);
    ctx.clip();

    ctx.translate(cx, cy);
    ctx.rotate(-rollRad);

    const pxPerDeg = 5.5;
    for (let deg = -60; deg <= 60; deg += 10) {
      const yOff = (pitchDeg - deg) * pxPerDeg;
      if (Math.abs(yOff) > 190) continue;

      ctx.beginPath();
      if (deg === 0) {
        ctx.moveTo(-125, yOff);
        ctx.lineTo(-32, yOff);
        ctx.moveTo(32, yOff);
        ctx.lineTo(125, yOff);
      } else {
        if (deg < 0) ctx.setLineDash([6, 4]);
        else ctx.setLineDash([]);
        ctx.moveTo(-72, yOff);
        ctx.lineTo(-26, yOff);
        ctx.lineTo(-26, yOff + (deg > 0 ? 7 : -7));
        ctx.moveTo(72, yOff);
        ctx.lineTo(26, yOff);
        ctx.lineTo(26, yOff + (deg > 0 ? 7 : -7));
        ctx.fillText(String(deg), -98, yOff + 4);
        ctx.fillText(String(deg), 78, yOff + 4);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // 3. Velocity Vector (Flight Path Marker)
    if (p.vel.lengthSq() > 25) {
      const vPoint = p.pos.clone().add(p.vel.clone().normalize().multiplyScalar(500));
      const proj = vPoint.project(camera);
      if (proj.z < 1) {
        const vx = (proj.x * 0.5 + 0.5) * this.w;
        const vy = (-proj.y * 0.5 + 0.5) * this.h;
        ctx.beginPath();
        ctx.arc(vx, vy, 8, 0, Math.PI * 2);
        ctx.moveTo(vx - 16, vy);
        ctx.lineTo(vx - 8, vy);
        ctx.moveTo(vx + 8, vy);
        ctx.lineTo(vx + 16, vy);
        ctx.moveTo(vx, vy - 8);
        ctx.lineTo(vx, vy - 15);
        ctx.stroke();
      }
    }

    // 4. Airspeed & Altitude Digital Readout Boxes
    const kts = Math.round(p.airspeed * 1.94384);
    const altFt = Math.round(p.pos.y * 3.28084);
    const aglFt = Math.round(p.agl * 3.28084);

    ctx.strokeRect(cx - 265, cy - 16, 74, 30);
    ctx.fillText(`${kts} KTS`, cx - 258, cy + 4);

    ctx.strokeRect(cx + 190, cy - 16, 86, 30);
    ctx.fillText(`${altFt} FT`, cx + 197, cy + 4);

    ctx.font = '600 11px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(`MACH ${p.mach.toFixed(2)}`, cx - 265, cy + 32);
    ctx.fillText(`G ${p.gLoad.toFixed(1)}`, cx - 265, cy + 48);
    ctx.fillText(`AOA ${p.aoaDeg ? p.aoaDeg.toFixed(1) : '0.0'}°`, cx - 265, cy + 64);

    ctx.fillText(`AGL ${aglFt} FT`, cx + 190, cy + 32);
    ctx.fillText(`HDG ${String(Math.round(headingDeg)).padStart(3, '0')}°`, cx - 26, cy - 185);
    ctx.fillText(selectedWeapon.toUpperCase(), cx + 190, cy + 50);

    if (p.afterburner) {
      ctx.fillStyle = '#fb923c';
      ctx.fillText('AB ENGAGED', cx - 265, cy - 30);
    }
    if (p.agl < 85 && p.vel.y < -12) {
      ctx.fillStyle = '#ef4444';
      ctx.font = '700 15px "JetBrains Mono", Consolas, monospace';
      ctx.fillText('PULL UP // TERRAIN', cx - 78, cy + 120);
    }

    // Missile seeker circle
    if (selectedWeapon !== 'cannon') {
      ctx.strokeStyle = lockProgress >= 1.0 ? '#ef4444' : 'rgba(74, 246, 138, 0.55)';
      ctx.beginPath();
      ctx.arc(cx, cy, lockProgress >= 1.0 ? 28 : 54, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _drawTankHUD(ctx, cx, cy, camera, p, gunnerOptics) {
    const color = gunnerOptics ? 'rgba(250, 204, 21, 0.92)' : 'rgba(226, 232, 240, 0.86)';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;

    // Gunner Optical Reticle / Crosshair
    if (gunnerOptics) {
      // Vignette frame
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.92)';
      ctx.fillStyle = 'rgba(250, 204, 21, 0.92)';

      // Stadiametric range ticks & ballistic drop dashes
      ctx.beginPath();
      ctx.moveTo(cx - 120, cy);
      ctx.lineTo(cx - 12, cy);
      ctx.moveTo(cx + 12, cy);
      ctx.lineTo(cx + 120, cy);
      ctx.moveTo(cx, cy - 90);
      ctx.lineTo(cx, cy - 10);
      ctx.moveTo(cx, cy + 10);
      ctx.lineTo(cx, cy + 120);
      for (let r = 1; r <= 4; r++) {
        const y = cy + r * 22;
        ctx.moveTo(cx - 14 + r * 2, y);
        ctx.lineTo(cx + 14 - r * 2, y);
      }
      ctx.stroke();
    } else {
      // Projected aim circle showing where the turret barrel is actually pointed
      const gunDir = new THREE.Vector3(
        -Math.sin(p.model.turretWorldYaw) * Math.cos(p.model.gunElevation),
        Math.sin(p.model.gunElevation),
        -Math.cos(p.model.turretWorldYaw) * Math.cos(p.model.gunElevation)
      );
      const aimPt = p.pos.clone().add(new THREE.Vector3(0, 2.2, 0)).addScaledVector(gunDir, 300);
      const proj = aimPt.project(camera);
      if (proj.z < 1) {
        const ax = (proj.x * 0.5 + 0.5) * this.w;
        const ay = (-proj.y * 0.5 + 0.5) * this.h;
        ctx.beginPath();
        ctx.arc(ax, ay, 12, 0, Math.PI * 2);
        ctx.moveTo(ax - 18, ay);
        ctx.lineTo(ax - 12, ay);
        ctx.moveTo(ax + 12, ay);
        ctx.lineTo(ax + 18, ay);
        ctx.stroke();
      }
    }

    // Hull & Turret Orientation Indicator (bottom-left above status)
    const hx = 105;
    const hy = this.h - 145;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.75)';
    ctx.lineWidth = 2;
    ctx.save();
    ctx.rotate(-p.model.heading);
    ctx.strokeRect(-14, -22, 28, 44);
    ctx.restore();
    ctx.save();
    ctx.rotate(-p.model.turretWorldYaw);
    ctx.strokeStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.moveTo(0, -8);
    ctx.lineTo(0, -32);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  _drawTargetMarkers(ctx, camera, playerUnit, units, lockedTarget, lockProgress) {
    ctx.font = '700 11px "JetBrains Mono", Consolas, monospace';
    for (const u of units) {
      if (!u.alive) continue;
      const dist = u.pos.distanceTo(playerUnit.pos);
      if (dist > 6500) continue;

      const worldPos = u.pos.clone();
      const proj = worldPos.project(camera);
      if (proj.z >= 1) continue;

      const sx = (proj.x * 0.5 + 0.5) * this.w;
      const sy = (-proj.y * 0.5 + 0.5) * this.h;
      if (sx < -40 || sx > this.w + 40 || sy < -40 || sy > this.h + 40) continue;

      const isEnemy = u.team !== playerUnit.team;
      const isLocked = lockedTarget && lockedTarget.id === u.id;
      ctx.strokeStyle = isEnemy ? (isLocked ? '#ff3b3b' : 'rgba(248, 113, 113, 0.85)') : 'rgba(96, 165, 250, 0.82)';
      ctx.fillStyle = ctx.strokeStyle;

      const sz = isLocked ? 15 : 10;
      ctx.lineWidth = isLocked ? 2.2 : 1.3;
      ctx.strokeRect(sx - sz, sy - sz, sz * 2, sz * 2);

      if (isLocked && lockProgress > 0) {
        ctx.beginPath();
        ctx.arc(sx, sy, 22 - lockProgress * 7, 0, Math.PI * 2 * lockProgress);
        ctx.stroke();
      }

      const distLabel = dist >= 1000 ? `${(dist / 1000).toFixed(1)}KM` : `${Math.round(dist)}M`;
      if (isEnemy || dist < 1800) {
        ctx.fillText(`${u.name.split(' ')[0]} ${distLabel}`, sx + sz + 6, sy + 4);
      }

      // Ballistic Lead Pipper for air-to-air / tank guns on locked enemy
      if (isLocked && u.vel) {
        const tof = dist / 880;
        const leadWorld = u.pos.clone().addScaledVector(u.vel, tof);
        const lProj = leadWorld.project(camera);
        if (lProj.z < 1) {
          const lx = (lProj.x * 0.5 + 0.5) * this.w;
          const ly = (-lProj.y * 0.5 + 0.5) * this.h;
          ctx.beginPath();
          ctx.arc(lx, ly, 6, 0, Math.PI * 2);
          ctx.moveTo(sx, sy);
          ctx.lineTo(lx, ly);
          ctx.stroke();
        }
      }
    }
  }

  _drawRadarScope(ctx, playerUnit, units) {
    const r = 74;
    const rx = this.w - r - 28;
    const ry = r + 28;

    ctx.save();
    ctx.beginPath();
    ctx.arc(rx, ry, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6, 14, 10, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.clip();

    // Range rings & FOV cone
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.2)';
    ctx.beginPath();
    ctx.arc(rx, ry, r * 0.5, 0, Math.PI * 2);
    ctx.moveTo(rx, ry);
    ctx.lineTo(rx - 44, ry - 64);
    ctx.moveTo(rx, ry);
    ctx.lineTo(rx + 44, ry - 64);
    ctx.stroke();

    const euler = new THREE.Euler().setFromQuaternion(playerUnit.quat, 'YXZ');
    const yaw = euler.y;
    const range = 4200;

    for (const u of units) {
      if (!u.alive) continue;
      const dx = u.pos.x - playerUnit.pos.x;
      const dz = u.pos.z - playerUnit.pos.z;
      // Rotate relative to player heading (-Z forward)
      const cos = Math.cos(-yaw);
      const sin = Math.sin(-yaw);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;

      const px = rx + (lx / range) * r;
      const py = ry + (lz / range) * r;
      if (Math.hypot(px - rx, py - ry) > r - 4) continue;

      ctx.fillStyle = u.team !== playerUnit.team ? '#ef4444' : '#60a5fa';
      ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
    }

    // Player center blip
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(rx - 3, ry - 3, 6, 6);
    ctx.restore();
  }
}
