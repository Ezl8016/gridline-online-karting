// The racing line laid down in rubber, as on every real kart track: a dark
// band a kart's width along the line the karts drive (the AI's practised line
// for this layout and direction), darkest where they brake and turn hardest,
// fading out at its edges, with faint streaks along it. One strip, drawn just
// above the tarmac and under the skid marks.

import * as THREE from 'three';

const STEP = 1.0;            // m between cross-sections
const WIDTH = 1.9;           // m, edge to edge (fades to nothing at the edges)
const ACROSS = [-1, -0.5, 0, 0.5, 1];

// streaks along the band, lighter and darker, tiling every few metres
function streaks() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d'), img = g.createImageData(64, 256);
  const lane = new Float32Array(64);
  for (let x = 0; x < 64; x++) lane[x] = 0.75 + 0.25 * Math.sin(x * 1.7) * Math.sin(x * 0.37 + 1);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) {
    const n = Math.sin(x * 12.9898 + y * 0.31) * 43758.5453, r = n - Math.floor(n);
    const v = Math.round(255 * Math.min(1, lane[x] * (0.85 + r * 0.3)));
    const i = (y * 64 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Rubber {
  constructor(scene, groundAt) {
    this.groundAt = groundAt;
    this.mat = new THREE.MeshBasicMaterial({ color: 0x050505, alphaMap: streaks(), vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.renderOrder = 0.5;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  // line: [[x, z], ...] round the lap; pace (optional): practised speed at each point (m/s)
  set(line, pace = null) {
    const n = line.length;
    if (n < 10) { this.mesh.visible = false; return; }
    // evenly spaced points along the line
    const pts = [], sp = [];
    let carry = 0;
    for (let i = 0; i < n; i++) {
      const a = line[i], b = line[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let d = carry; d < L; d += STEP) {
        const t = d / L;
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        sp.push(pace ? pace[i] + (pace[(i + 1) % n] - pace[i]) * t : 0);
      }
      carry = (carry - L) % STEP; if (carry < 0) carry += STEP;
    }
    const m = pts.length;
    // how much rubber: some everywhere, more through corners and where they brake
    const amt = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const p = pts[(i - 4 + m) % m], q = pts[i], r = pts[(i + 4) % m];
      const h1 = Math.atan2(q[0] - p[0], q[1] - p[1]), h2 = Math.atan2(r[0] - q[0], r[1] - q[1]);
      const turn = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1))) / (4 * STEP);   // 1/m
      const brake = pace ? Math.max(0, sp[i] - sp[(i + 6) % m]) / (6 * STEP) : 0;           // m/s lost per m
      amt[i] = 0.13 + Math.min(0.13, turn * 1.4) + Math.min(0.1, brake * 0.2);
    }
    for (let pass = 0; pass < 3; pass++) {                // (smoothed: rubber builds up gradually)
      const o = amt.slice();
      for (let i = 0; i < m; i++) amt[i] = (o[(i - 2 + m) % m] + o[(i - 1 + m) % m] + o[i] * 2 + o[(i + 1) % m] + o[(i + 2) % m]) / 6;
    }
    const k = ACROSS.length, pos = new Float32Array((m + 1) * k * 3), col = new Float32Array((m + 1) * k * 4), uv = new Float32Array((m + 1) * k * 2), idx = [];
    for (let s = 0; s <= m; s++) {
      const i = s % m, a = pts[(i - 1 + m) % m], b = pts[(i + 1) % m], tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const rx = -(b[1] - a[1]) / tl, rz = (b[0] - a[0]) / tl;
      for (let j = 0; j < k; j++) {
        const off = ACROSS[j] * WIDTH / 2, x = pts[i][0] + rx * off, z = pts[i][1] + rz * off, v = s * k + j;
        pos.set([x, this.groundAt(x, z) + 0.02, z], v * 3);
        const edge = 1 - Math.abs(ACROSS[j]);
        col.set([1, 1, 1, amt[i] * edge * edge * (3 - 2 * edge)], v * 4);
        uv.set([(ACROSS[j] + 1) / 2, s * STEP / 6], v * 2);
      }
      if (s < m) for (let j = 0; j < k - 1; j++) { const a0 = s * k + j, b0 = a0 + k; idx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    this.mesh.visible = true;
  }
}
