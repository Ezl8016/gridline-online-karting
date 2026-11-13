// AI drivers. Each drives a real kart (KartPhysics, the same as yours) round
// a racing line (racingLine, below). How fast each part of the lap can be taken
// comes from practice (tools/train_ai: lap after lap in that kart on that
// track, in models/ai-pace.json), or if it has none, from how tight the corner
// is and how hard the kart can brake towards it. It steers by its line's own
// curve and holds the line closely, catches slides, brakes for traffic it
// can't get round, leaves room alongside, and picks its way back after a
// mistake. Skill is the share of its practice pace it drives at.

const G = 9.81;

// A racing line: the centreline pulled straight wherever the track's width
// allows (each point eased towards the middle of its neighbours, at
// shrinking scales, never closer than `margin` to the edge), so it sweeps
// wide into a corner, clips the inside and runs wide out of it.
export function racingLine(center, width, margin = 0.7, room = null) {
  const n = center.length, half = width / 2 - margin;
  const nx = new Float32Array(n), nz = new Float32Array(n), off = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = center[(i - 1 + n) % n], b = center[(i + 1) % n];
    const tx = b[0] - a[0], tz = b[1] - a[1], tl = Math.hypot(tx, tz) || 1;
    nx[i] = -tz / tl; nz[i] = tx / tl;               // right of travel
  }
  let step = 0;
  for (let i = 0; i < n; i++) { const a = center[i], b = center[(i + 1) % n]; step += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  step /= n;
  // (room: how far the pavement really goes each side, where it's known)
  const lo = (i) => (room ? -room.l[i] : -half), hi = (i) => (room ? room.r[i] : half);
  const P = (i) => { const c = center[i]; return [c[0] + nx[i] * off[i], c[1] + nz[i] * off[i]]; };
  for (const span of room ? [30, 20, 14, 9, 6, 4] : [14, 9, 6, 4]) {
    const k = Math.max(1, Math.round(span / step));
    for (let it = 0; it < 120; it++) {
      for (let i = 0; i < n; i++) {
        const a = P((i - k + n) % n), b = P((i + k) % n), c = center[i];
        const want = ((a[0] + b[0]) / 2 - c[0]) * nx[i] + ((a[1] + b[1]) / 2 - c[1]) * nz[i];
        off[i] = Math.max(lo(i), Math.min(hi(i), off[i] + (want - off[i]) * 0.5));
      }
    }
  }
  const out = Array.from({ length: n }, (_, i) => P(i));
  out.off = off;                                     // (how far right of the middle: the room each side)
  return out;
}

// What practice left for a kart on a track (models/ai-pace.json): its line, how
// fast it takes it, and how far the pavement really goes each side, kept for
// every 4th point of the centreline, for all of them
export function practised(center, p) {
  const n = center.length, at = (a, i) => { const u = i / 4, j = Math.floor(u), f = u - j, m = a.length; return a[j % m] + (a[(j + 1) % m] - a[j % m]) * f; };
  const off = new Float32Array(n), pace = new Float32Array(n), l = new Float32Array(n), r = new Float32Array(n), line = [];
  for (let i = 0; i < n; i++) {
    off[i] = at(p.off, i) / 100; pace[i] = at(p.pace, i) / 10; l[i] = at(p.l, i) / 100; r[i] = at(p.r, i) / 100;
    const a = center[(i - 1 + n) % n], b = center[(i + 1) % n], tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, c = center[i];
    line.push([c[0] - (b[1] - a[1]) / tl * off[i], c[1] + (b[0] - a[0]) / tl * off[i]]);
  }
  line.off = off; line.pace = pace; line.l = l; line.r = r;
  return line;
}

export class AIDriver {
  // line: racingLine(); opts: skill (share of its pace, 1: flat out), grip (the
  // kart's cornering grip in g), lane (m off the line it likes, + right),
  // width (of the track, m), pace: practised speeds along the line (m/s)
  constructor(line, opts = {}) {
    this.skill = opts.skill ?? 0.9;
    this.grip = opts.grip ?? 1.4;
    this.home = opts.lane ?? 0;
    this.lane = this.home;
    this.width = opts.width ?? 6.8;
    this.react = opts.react ?? 0.05;   // s it looks ahead on its speed plan (a moment to react)
    this.brakeG = opts.brake ?? 0.8;   // how hard the kart can brake (g; rear brakes only)
    this.pace = opts.pace ?? null;
    this.wet = 1;                      // share of the dry speed
    this.lockTol = opts.lockTol ?? 0.12;   // rad of steering past the corner's own angle
    this.steerMode = opts.steer ?? 'ff'; this.ffAhead = opts.ffAhead ?? 0.2; this.ffHead = opts.ffHead ?? 1; this.ffLat = opts.ffLat ?? 2.5;
    this.idx = 0;
    this.setLine(line);
  }

  setLine(line, pace = null) {
    const n = this.n = line.length;
    this.line = line;
    this.pace = line.pace ?? (pace?.length === n ? pace : null);
    this.off = line.off ?? new Float32Array(n);
    this.edgeL = line.l ?? null; this.edgeR = line.r ?? null;
    // distance along, heading, and curvature (smoothed over a few metres)
    const s = this.s = new Float32Array(n + 1), hd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = line[i], b = line[(i + 1) % n];
      s[i + 1] = s[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
      hd[i] = Math.atan2(b[0] - a[0], b[1] - a[1]);
    }
    this.len = s[n];
    const step = this.ds = this.len / n, w = Math.max(2, Math.round(4 / step));
    const k = this.k = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let d = hd[(i + w) % n] - hd[(i - w + n) % n];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      k[i] = d / (2 * w * step);       // + turning left (heading measured from +Z towards +X)
    }
    this.plan();
    this.idx = 0;
  }

  // the limit of each point, before skill: practised, or worked out
  limit(i) {
    return this.pace ? this.pace[i] : Math.min(40, Math.sqrt(this.grip * G / Math.max(Math.abs(this.k[i]), 1e-3)));
  }

  // how fast each point can be taken: its limit, then braking back from every
  // slower point ahead
  plan() {
    const n = this.n, v = this.v = new Float32Array(n), f = this.skill * this.wet;
    const aBrk = this.brakeG * G * f * f;
    for (let i = 0; i < n; i++) v[i] = this.limit(i) * f;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const j = (i + 1) % n;
        v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * aBrk * this.ds));
      }
    }
  }

  // nearest point on the line, searching near the last one
  locate(x, z) {
    let best = Infinity, bi = this.idx;
    const span = this.lost ? this.n : 40;
    for (let d = -span; d <= span; d++) {
      const i = ((this.idx + d) % this.n + this.n) % this.n, p = this.line[i];
      const e = (p[0] - x) ** 2 + (p[1] - z) ** 2;
      if (e < best) { best = e; bi = i; }
    }
    this.lost = best > 400;
    this.idx = bi;
    this.err = Math.sqrt(best);
    return bi;
  }

  // moved over to the inside of a corner its arc is tighter than the line's:
  // the share of the line's speed that's left
  tighter(i) {
    const inside = -this.k[i] * this.lane;           // (k: + left, lane: + right)
    return inside > 0 ? Math.sqrt(Math.max(0.3, 1 - inside)) : 1;
  }

  // the index `d` metres on from i
  ahead(i, d) { return (i + Math.round(d / this.ds)) % this.n; }

  // the most it can move off the line here and stay on the track (m): [left, right], left negative
  room(i, edge = 1) {
    const half = this.width / 2 - edge, o = this.off[i];
    const lo = this.edgeL ? -this.edgeL[i] : -half, hi = this.edgeR ? this.edgeR[i] : half;
    return [Math.min(0, lo - o), Math.max(0, hi - o)];
  }

  // a point on its line, `ahead` metres on from index i
  target(i, ahead, lane = this.lane) {
    const n = this.n;
    let j = i, d = 0;
    while (d < ahead) { const a = this.line[j], b = this.line[(j + 1) % n]; d += Math.hypot(b[0] - a[0], b[1] - a[1]); j = (j + 1) % n; }
    const a = this.line[j], b = this.line[(j + 1) % n];
    const tx = b[0] - a[0], tz = b[1] - a[1], tl = Math.hypot(tx, tz) || 1;
    // (the right of travel along (tx, tz), as for a kart: right = (-forward z, forward x))
    const rx = -tz / tl, rz = tx / tl, [lo, hi] = this.room(j);
    const l = Math.max(lo, Math.min(hi, lane));
    return [a[0] + rx * l, a[1] + rz * l, j];
  }

  // this step's controls. kart: KartPhysics; others: [{ x, z, vx, vz }]
  control(kart, others = []) {
    const t = kart.body.translation(), q = kart.body.rotation(), v = kart.body.linvel();
    const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));     // forward (-Z of the kart)
    const fl = Math.hypot(fx, fz) || 1, ux = fx / fl, uz = fz / fl, rx = -uz, rz = ux;   // right
    const speed = Math.hypot(v.x, v.z);
    const i = this.locate(t.x, t.z);
    const [want, cap] = this.traffic(i, t, ux, uz, rx, rz, speed, others);
    this.lane += (want - this.lane) * 0.012;
    // off its line after a mistake: comes back gradually, not straight across the track
    const here = this.line[i], next = this.line[(i + 1) % this.n], lx = next[0] - here[0], lz = next[1] - here[1], ll = Math.hypot(lx, lz) || 1;
    const wide = ((t.x - here[0]) * -lz + (t.z - here[1]) * lx) / ll;
    if (Math.abs(wide - this.lane) > 1.5) this.lane = wide - Math.sign(wide - this.lane) * 1.5;
    // steering: the corner's own lock (from the line's curvature a moment
    // ahead), plus turning to the line's heading there and back onto the line.
    // (It used to aim at a point a few metres on, which cut across the inside
    // of every tight corner: on a human's line it lost over a second a lap.)
    const wb = 1.05;
    const j = this.ahead(i, Math.max(0.8, speed * this.ffAhead)), a = this.line[j], c = this.line[(j + 1) % this.n];
    const hx = c[0] - a[0], hz = c[1] - a[1], hl = Math.hypot(hx, hz) || 1;
    const psi = Math.atan2((hx * rx + hz * rz) / hl, (hx * ux + hz * uz) / hl);
    const [px, pz] = this.target(i, 0.01), e = (px - t.x) * rx + (pz - t.z) * rz;
    let delta;
    if (this.steerMode === 'pursuit' || Math.abs(e) > 1.5 || (Math.abs(psi) > 0.6 && speed < 10)) {
      // well off its line or pointing away from it (a bump, a spin): back
      // towards a point ahead, gently, not hard onto the line where it is
      const L = Math.max(2.2, 1.2 + speed * 0.15), [tx, tz] = this.target(i, L), dx = tx - t.x, dz = tz - t.z;
      delta = Math.atan2(2 * wb * Math.sin(Math.atan2(dx * rx + dz * rz, dx * ux + dz * uz)), Math.max(L, 1));
    } else {
      // (the heading correction eases off at speed: full, it weaved in fast sweepers)
      const head = this.ffHead * (1 - 0.4 * Math.min(1, Math.max(0, (speed - 12) / 12)));
      delta = -Math.atan(wb * this.k[j]) + head * psi + Math.atan(this.ffLat * e / (speed + 2));
    }
    // catching a slide: steer the way it's going
    const vSide = v.x * rx + v.z * rz, vFwd = v.x * ux + v.z * uz;
    const slip = speed > 3 ? Math.atan2(vSide, Math.max(1, Math.abs(vFwd))) : 0;
    // (no more lock than the corner needs and the tyres can use: past that the
    // fronts only scrub, and it ploughs wide)
    if (speed > 5) {
      const lock = Math.abs(Math.atan(wb * this.k[this.ahead(i, speed * 0.25)])) + this.lockTol;
      delta = Math.max(-lock, Math.min(lock, delta));
    }
    delta += slip * 0.7;
    const steer = Math.max(-1, Math.min(1, delta / 0.45));
    // speed: the plan a little ahead (it needs time to brake)
    const look = Math.min(this.n - 1, Math.round((speed * this.react) / this.ds));
    let vt = cap;
    for (let k = 0; k <= look + 1; k++) vt = Math.min(vt, this.v[(i + k) % this.n] * this.tighter((i + k) % this.n));
    if (this.lost) vt = Math.min(vt, 6);
    else if (this.err > 2.5 + Math.abs(this.lane)) vt = Math.min(vt, 12);    // (off line: picks its way back)
    let throttle = 0, brake = 0;
    if (speed < vt + 0.2) throttle = Math.max(0.15, Math.min(1, 0.7 + (vt - speed) * 1.5));
    else brake = Math.min(1, (speed - vt - 0.2) / 1.5);
    // sliding: ease off
    if (Math.abs(slip) > 0.2) throttle *= 0.5;
    return { steer, throttle, brake };
  }

  // The others: where it wants to be across the track (`home`, unless someone
  // needs going round) and how fast they leave it to go. It looks further
  // the faster it's going, gives a kart alongside its room, goes round the
  // side with space (the inside of the next corner, if both have), and if
  // there's no way past it brakes rather than drives into them.
  traffic(i, t, ux, uz, rx, rz, speed, others) {
    const [lo, hi] = this.room(i), reach = 6 + speed * 1.1;
    let want = this.home, cap = Infinity, push = 0, crowd = false;
    const turn = this.k[this.ahead(i, 8 + speed * 0.5)];      // + left: the next corner
    for (const o of others) {
      const dx = o.x - t.x, dz = o.z - t.z, along = dx * ux + dz * uz, side = dx * rx + dz * rz;
      if (along < -4 || along > reach || Math.abs(side) > 3.2) continue;
      const theirs = o.vx * ux + o.vz * uz, closing = speed - theirs;
      // alongside (or half a length off it, as on the grid): a kart's width between us
      if (along < 4) {
        crowd = true;
        if (Math.abs(side) < 2) push += (side > 0 ? -1 : 1) * (2 - Math.abs(side)) * 1.5;
        if (along < 2.4) continue;
      }
      if (closing < 0.3) continue;                            // pulling away, or holding station
      const clash = (along - 2.2) / closing;
      if (clash > 2.5) continue;                              // (too far off to matter yet)
      // their place across the track, and each way past it
      const at = this.lane + side, left = at - 2, right = at + 2;
      const canL = left >= lo, canR = right <= hi;
      if (canL || canR) {
        const inside = turn > 0 ? left : right;
        const go = canL && canR ? (Math.abs(turn) > 0.02 ? inside : Math.abs(left - this.lane) < Math.abs(right - this.lane) ? left : right) : canL ? left : right;
        want = go;
      }
      // braking for them, unless it's already clear of their kart's width
      if (Math.abs(side) < 1.7) cap = Math.min(cap, Math.sqrt(Math.max(0, theirs) ** 2 + 2 * 6 * Math.max(0, along - 2.2)));
    }
    // wheel to wheel into a tight corner: a margin, not the practised limit
    if (crowd) for (let k = 0, m = Math.round((6 + speed) / this.ds); k <= m; k++) { const j = (i + k) % this.n; if (Math.abs(this.k[j]) > 0.06) cap = Math.min(cap, this.v[j] * 0.93); }
    return [Math.max(lo, Math.min(hi, want + push)), cap];
  }

  // laps done and how far round: for the timing (0..1 of a lap)
  get frac() { return this.s[this.idx] / this.len; }
}
