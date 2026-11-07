// Collision + navigation. Static colliders are 2.5D (footprint + height): axis-aligned
// boxes and circles. Characters are vertical capsules approximated by circles on XZ.
// Navigation uses a flow field (BFS distance grid) toward the player, so any number of
// enemies path around walls/props cheaply and never get stuck behind obstacles.
import * as THREE from 'three';

export class CollisionWorld {
  constructor(bounds = 40) {
    this.boxes = [];   // {minX,maxX,minZ,maxZ,minY,h(top),tag,off}
    this.circles = []; // {x,z,r,h,tag,off}
    this.ramps = [];   // {minX,maxX,minZ,maxZ,axis,lowAtMin,y0,y1,tag,off}
    this.bounds = bounds;
    this.activeTag = null; // colliders with a tag are only active when it matches
    this._box3 = new THREE.Box3();
    this._ray = new THREE.Ray();
    this._v = new THREE.Vector3();
  }

  on(c) { return !c.off && (!c.tag || c.tag === this.activeTag); }

  addBox(cx, cz, w, d, h = 4, { minY = 0, tag = null } = {}) { const b = { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, minY, h, tag }; this.boxes.push(b); return b; }
  addCircle(x, z, r, h = 3, { tag = null } = {}) { const c = { x, z, r, h, tag }; this.circles.push(c); return c; }
  // Ramp rising from y0 to y1 along `axis` ('x'|'z'); lowAtMin = the low end is at the min side.
  addRamp(minX, maxX, minZ, maxZ, axis, lowAtMin, y0, y1, { tag = null } = {}) { const rp = { minX, maxX, minZ, maxZ, axis, lowAtMin, y0, y1, tag }; this.ramps.push(rp); return rp; }

  rampHeight(rp, x, z) {
    const t = rp.axis === 'x' ? (x - rp.minX) / (rp.maxX - rp.minX) : (z - rp.minZ) / (rp.maxZ - rp.minZ);
    const k = Math.max(0, Math.min(1, rp.lowAtMin ? t : 1 - t));
    return rp.y0 + (rp.y1 - rp.y0) * k;
  }

  // Highest walkable surface under a circle whose top is reachable from footY (step-up).
  groundAt(x, z, r, footY, step = 0.6) {
    let best = 0, surf = null;
    const rr = r * 0.55;
    for (const b of this.boxes) {
      if (!this.on(b) || b.h > footY + step || b.h <= best) continue;
      if (x + rr > b.minX && x - rr < b.maxX && z + rr > b.minZ && z - rr < b.maxZ) { best = b.h; surf = b; }
    }
    for (const rp of this.ramps) {
      if (!this.on(rp) || x < rp.minX || x > rp.maxX || z < rp.minZ || z > rp.maxZ) continue;
      const h = this.rampHeight(rp, x, z);
      if (h <= footY + step && h > best) { best = h; surf = rp; }
    }
    return { y: best, surf };
  }

  // Lowest overhead surface above footY (for slide clearance / head bumps).
  ceilingAt(x, z, r, footY) {
    let best = Infinity;
    for (const b of this.boxes) {
      if (!this.on(b) || b.minY <= footY + 0.05 || b.minY >= best) continue;
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) best = b.minY;
    }
    return best;
  }

  // Nearest vertical wall face beside a character (for wall-running / wall-jumping).
  wallProbe(pos, r, footY, height, reach = 0.6) {
    let best = null;
    const lo = footY + 0.3, hi = footY + Math.min(1.3, height - 0.3);
    for (const b of this.boxes) {
      if (!this.on(b) || b.minY > lo || b.h < hi) continue; // wall must cover the torso
      const cx = Math.max(b.minX, Math.min(pos.x, b.maxX)), cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      const dx = pos.x - cx, dz = pos.z - cz; const d = Math.hypot(dx, dz);
      if (d < 1e-4 || d > r + reach) continue;
      if (!best || d < best.dist) best = { dist: d, normal: new THREE.Vector3(dx / d, 0, dz / d), point: new THREE.Vector3(cx, footY, cz), box: b };
    }
    return best;
  }

  // Push a circle (character) out of static geometry. Returns true if it collided.
  // y = feet height, height = body height; obstacles you can step onto (top <= y+step) don't block.
  resolve(pos, r, y = 0, height = 2.6, step = 0.35) {
    let hit = false;
    for (let iter = 0; iter < 2; iter++) {
      for (const rp of this.ramps) {
        if (!this.on(rp)) continue;
        const cx = Math.max(rp.minX, Math.min(pos.x, rp.maxX)), cz = Math.max(rp.minZ, Math.min(pos.z, rp.maxZ));
        if (y >= this.rampHeight(rp, cx, cz) - step) continue;
        const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
        if (d2 < r * r && d2 > 1e-8) { const d = Math.sqrt(d2); pos.x = cx + dx / d * r; pos.z = cz + dz / d * r; hit = true; }
      }
      for (const b of this.boxes) {
        if (!this.on(b) || y > b.h - step || y + height <= b.minY) continue;
        const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          hit = true;
          if (d2 > 1e-8) { const d = Math.sqrt(d2); pos.x = cx + dx / d * r; pos.z = cz + dz / d * r; }
          else { // centre inside the box: push out along the shallowest axis
            const pl = pos.x - b.minX, pr = b.maxX - pos.x, pb = pos.z - b.minZ, pf = b.maxZ - pos.z;
            const m = Math.min(pl, pr, pb, pf);
            if (m === pl) pos.x = b.minX - r; else if (m === pr) pos.x = b.maxX + r; else if (m === pb) pos.z = b.minZ - r; else pos.z = b.maxZ + r;
          }
        }
      }
      for (const c of this.circles) {
        if (!this.on(c) || y > c.h - step) continue;
        const dx = pos.x - c.x, dz = pos.z - c.z; const rr = r + c.r; const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) { hit = true; const d = Math.sqrt(d2) || 1e-4; pos.x = c.x + dx / d * rr; pos.z = c.z + dz / d * rr; }
      }
    }
    const B = this.bounds - r;
    if (pos.x > B) { pos.x = B; hit = true; } if (pos.x < -B) { pos.x = -B; hit = true; }
    if (pos.z > B) { pos.z = B; hit = true; } if (pos.z < -B) { pos.z = -B; hit = true; }
    return hit;
  }

  pointBlocked(x, z, r = 0, y = 0) {
    for (const b of this.boxes) if (this.on(b) && y <= b.h && b.minY < y + 2.0 && x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return true;
    for (const c of this.circles) if (this.on(c) && y <= c.h && (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + r) ** 2) return true;
    for (const rp of this.ramps) if (this.on(rp) && x > rp.minX - r && x < rp.maxX + r && z > rp.minZ - r && z < rp.maxZ + r && this.rampHeight(rp, x, z) > 0.8) return true;
    return Math.abs(x) > this.bounds - r || Math.abs(z) > this.bounds - r;
  }

  // 2D segment test against obstacles taller than minH (line of sight / attack contact).
  // y = height of the observers' feet (obstacles entirely above/below the line are ignored).
  segmentBlocked(ax, az, bx, bz, minH = 1.2, pad = 0, y = 0) {
    const dx = bx - ax, dz = bz - az;
    for (const b of this.boxes) {
      if (!this.on(b) || b.h < y + minH || b.minY > y + 1.6) continue;
      if (segAABB(ax, az, dx, dz, b.minX - pad, b.maxX + pad, b.minZ - pad, b.maxZ + pad)) return true;
    }
    for (const c of this.circles) {
      if (!this.on(c) || c.h < y + minH) continue;
      const fx = ax - c.x, fz = az - c.z; const a = dx * dx + dz * dz; if (a < 1e-9) continue;
      const t = Math.max(0, Math.min(1, -(fx * dx + fz * dz) / a));
      const px = fx + dx * t, pz = fz + dz * t;
      if (px * px + pz * pz < (c.r + pad) ** 2) return true;
    }
    return false;
  }

  // 3D ray vs static colliders (camera collision, arrows). Returns distance or Infinity.
  raycast(origin, dir, maxDist) {
    let best = maxDist;
    const ray = this._ray; ray.origin.copy(origin); ray.direction.copy(dir);
    for (const b of this.boxes) {
      if (!this.on(b)) continue;
      this._box3.min.set(b.minX, b.minY > 0 ? b.minY : -1, b.minZ); this._box3.max.set(b.maxX, b.h, b.maxZ);
      const p = ray.intersectBox(this._box3, this._v);
      if (p) { const d = p.distanceTo(origin); if (d < best) best = d; }
    }
    for (const rp of this.ramps) { // coarse: the ramp's mid-height block
      if (!this.on(rp)) continue;
      this._box3.min.set(rp.minX, -1, rp.minZ); this._box3.max.set(rp.maxX, (rp.y0 + rp.y1) * 0.5, rp.maxZ);
      const p = ray.intersectBox(this._box3, this._v);
      if (p) { const d = p.distanceTo(origin); if (d < best) best = d; }
    }
    for (const c of this.circles) {
      if (!this.on(c)) continue;
      // treat as a vertical cylinder: 2D ray-circle then height check
      const ox = origin.x - c.x, oz = origin.z - c.z; const a = dir.x * dir.x + dir.z * dir.z; if (a < 1e-9) continue;
      const bq = 2 * (ox * dir.x + oz * dir.z); const cq = ox * ox + oz * oz - c.r * c.r;
      const disc = bq * bq - 4 * a * cq; if (disc < 0) continue;
      const t = (-bq - Math.sqrt(disc)) / (2 * a);
      if (t >= 0 && t < best) { const y = origin.y + dir.y * t; if (y <= c.h && y >= -1) best = t; }
    }
    // ground
    if (dir.y < 0) { const t = -origin.y / dir.y; if (t >= 0 && t < best) best = t; }
    return best;
  }
}

function segAABB(ax, az, dx, dz, minX, maxX, minZ, maxZ) {
  let t0 = 0, t1 = 1;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, ax - minX) && clip(dx, maxX - ax) && clip(-dz, az - minZ) && clip(dz, maxZ - az) && t0 <= t1;
}

export class FlowField {
  constructor(world, { size = 1, half = 40, agentRadius = 0.8 } = {}) {
    this.world = world; this.size = size; this.half = half;
    this.n = Math.ceil(half * 2 / size);
    this.blocked = new Uint8Array(this.n * this.n);
    this.dist = new Float32Array(this.n * this.n).fill(Infinity);
    this.agentRadius = agentRadius;
    this.queue = new Int32Array(this.n * this.n);
    this.target = { x: 0, z: 0 }; this.lastCell = -1;
    this.rebuildBlocked();
  }

  rebuildBlocked() {
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const x = -this.half + (i + 0.5) * this.size, z = -this.half + (j + 0.5) * this.size;
      this.blocked[j * this.n + i] = this.world.pointBlocked(x, z, this.agentRadius, 0) ? 1 : 0;
    }
  }

  cellOf(x, z) {
    const i = Math.floor((x + this.half) / this.size), j = Math.floor((z + this.half) / this.size);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  update(tx, tz) {
    let c = this.cellOf(tx, tz);
    if (c < 0 || c === this.lastCell) return;
    this.lastCell = c;
    // if the target stands in a blocked cell (hugging a wall) seed from nearest open neighbours
    const n = this.n, dist = this.dist, q = this.queue, blk = this.blocked;
    dist.fill(Infinity);
    let head = 0, tail = 0;
    const seed = (k) => { if (k >= 0 && dist[k] === Infinity) { dist[k] = 0; q[tail++] = k; } };
    seed(c);
    if (blk[c]) { const ci = c % n, cj = (c / n) | 0; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const ii = ci + di, jj = cj + dj; if (ii >= 0 && jj >= 0 && ii < n && jj < n && !blk[jj * n + ii]) seed(jj * n + ii); } }
    while (head < tail) {
      const k = q[head++]; const i = k % n, j = (k / n) | 0; const d = dist[k];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const kk = jj * n + ii; if (blk[kk]) continue;
        if (di && dj && (blk[j * n + ii] || blk[jj * n + i])) continue; // no corner cutting
        const nd = d + (di && dj ? 1.414 : 1);
        if (nd < dist[kk]) { dist[kk] = nd; q[tail++] = kk; }
      }
    }
  }

  // Direction (unit x,z) to follow from a world position, or null.
  direction(x, z, out) {
    const k = this.cellOf(x, z); if (k < 0) return null;
    const n = this.n; const i = k % n, j = (k / n) | 0;
    let best = this.dist[k], bi = -1, bj = -1;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const kk = jj * n + ii;
      if (this.blocked[kk]) continue;
      if (di && dj && (this.blocked[j * n + ii] || this.blocked[jj * n + i])) continue;
      if (this.dist[kk] < best) { best = this.dist[kk]; bi = ii; bj = jj; }
    }
    if (bi < 0) return null;
    const cx = -this.half + (bi + 0.5) * this.size, cz = -this.half + (bj + 0.5) * this.size;
    out.x = cx - x; out.z = cz - z; const l = Math.hypot(out.x, out.z) || 1; out.x /= l; out.z /= l;
    return out;
  }

  reachable(x, z) { const k = this.cellOf(x, z); return k >= 0 && !this.blocked[k] && this.dist[k] < Infinity; }
  isOpen(x, z) { const k = this.cellOf(x, z); return k >= 0 && !this.blocked[k]; }
}
