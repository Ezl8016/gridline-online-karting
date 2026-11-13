// Gridline Comp: the G920 through tools/wheel/helper.py, which talks to the
// wheel itself (Safari can't see wheels) with no Logitech software.
//
// The wheel shows up to the game as a G920 in HID mode would in Chrome
// (steering axis 0; throttle, brake and clutch axes 1-3, +1 at rest, -1 all the
// way down), so the wheel's setup, calibration and sensitivity all apply. The
// clutch pedal is a brake too (Ezra brakes with it): the brake is whichever of
// the two is pressed further.
//
// Force feedback: the steering force the game works out each frame (feel(),
// from the front tyres), sent to the helper, which drives the wheel.

const URL = 'ws://localhost:8644';
const ID = 'G920 Driving Force Racing Wheel (Gridline helper) (Vendor: 046d Product: c262)';

export class WheelHelper {
  constructor() {
    this.ws = null; this.state = null; this.at = 0; this.lastSent = 0; this.lastF = null; this.range = null;
    this.buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
    this.retry = 2000;
    // (only where it can be: the game served from this computer, or switched on in
    // Settings. On the website every player's browser would otherwise keep
    // knocking on localhost, and Chrome may ask them about local network access)
    if (WheelHelper.wanted()) this.connect();
  }

  connect() {
    if (!WheelHelper.wanted()) { this.trying = false; return; }   // (switched off: no more tries)
    this.trying = true;
    let ws;
    try { ws = new WebSocket(URL); } catch { setTimeout(() => this.connect(), 10000); return; }
    ws.onopen = () => { this.ws = ws; this.retry = 2000; this.lastF = null; if (this.range) this.send({ range: this.range }); };   // (the force sent again at once)
    ws.onmessage = (e) => { try { this.state = JSON.parse(e.data); this.at = performance.now(); } catch { /* not ours */ } };
    ws.onclose = () => { if (this.ws === ws) this.ws = null; this.state = null; setTimeout(() => this.connect(), this.retry); this.retry = Math.min(15000, this.retry * 1.5); };
    ws.onerror = () => {};
  }

  static wanted() {
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return true;
    try { return localStorage.getItem('gridline.wheelHelper') === '1'; } catch { return false; }
  }
  enable(on) {
    try { localStorage.setItem('gridline.wheelHelper', on ? '1' : '0'); } catch { /* private window */ }
    if (on && !this.trying) this.connect();
    if (!on && this.ws) { this.off(); this.ws.close(); }
  }

  get connected() { return !!this.ws && this.ws.readyState === 1; }

  // the wheel as a Gamepad, as Chrome shows a G920 in HID mode
  gamepad() {
    const s = this.state; if (!this.connected || !s) return null;
    const brake = Math.max(s.br ?? 0, s.cl ?? 0);          // (the clutch pedal brakes too)
    // buttons, in the order Chrome gives a G920 in HID mode: A, B, X, Y (byte 1's
    // top bits), right paddle, left paddle, menu, view... (byte 2 on). (Byte 2's
    // 0x10, button 8, is on all the time here: left out, or it'd read as held.)
    const b = s.b || [], bits = ((b[0] ?? 0) >> 4) | ((b[1] ?? 0) << 4) | ((b[2] ?? 0) << 12);
    for (let i = 0; i < 16; i++) { const on = i !== 8 && !!(bits & (1 << i)); const x = this.buttons[i]; x.pressed = on; x.touched = on; x.value = on ? 1 : 0; }
    return { id: ID, index: 99, connected: true, mapping: '', timestamp: this.at,
      axes: [s.st ?? 0, 1 - 2 * (s.th ?? 0), 1 - 2 * brake, 1 - 2 * (s.cl ?? 0)], buttons: this.buttons, helper: true };
  }

  send(m) { if (this.connected) this.ws.send(JSON.stringify(m)); }

  // the wheel's rotation, lock to lock (degrees): a kart's, not 900
  setRange(deg) { this.range = deg; this.send({ range: deg }); }

  // the steering force, -1..1 (+ turns the wheel right), at most ~100 times a second
  force(f) {
    const now = performance.now();
    if (now - this.lastSent < 10 || (this.lastF != null && Math.abs(f - this.lastF) < 0.004)) return;
    this.lastSent = now; this.lastF = f; this.send({ f: +f.toFixed(4) });
  }

  off() { this.lastF = null; this.send({ off: true }); }
}

// The steering force from the kart: the front tyres' sideways grip pulling the
// wheel back towards straight (heavier the harder they're working), going light
// as they reach the limit (the front washing out); bumps: one front tyre loaded
// more suddenly than the other kicks the wheel, the kerbs rattle it, the grass
// shakes it, the asphalt has a fine grain that grows with speed; a jolt on a
// hit. strength: the Settings slider, 0..1.
const mem = { fz: [0, 0], t: 0 };
export function feel(kart, t, hit = 0, strength = 0.6) {
  let fy = 0, util = 0, kerb = 0, grass = 0;
  const fr = kart.wheels.filter(w => w.front);
  fr.forEach((w) => {
    if (!w.contact) return;
    fy += w.Fy || 0; util = Math.max(util, w.util || 0);
    if (w.surface === 'kerb') kerb++; else if (w.surface === 'grass') grass++;
  });
  const trail = 0.15 + 0.85 * Math.max(0, 1 - Math.pow(Math.min(1, util), 3));   // (the pneumatic trail falls away at the limit)
  let f = -(fy / 700) * trail;                        // (Fy + is to the right: it pulls the wheel back left)
  // bumps: the change in load on each front tyre since last time, left against right
  const dt = Math.max(1e-3, t - mem.t), fzL = fr[0]?.Fz || 0, fzR = fr[1]?.Fz || 0;
  if (dt < 0.1) {
    const dL = (fzL - mem.fz[0]) / dt, dR = (fzR - mem.fz[1]) / dt;   // (N per second)
    f += Math.max(-0.35, Math.min(0.35, (dL - dR) / 60000));
  }
  mem.fz = [fzL, fzR]; mem.t = t;
  const v = kart.speed || 0;
  if (kerb) f += Math.sin(t * 2 * Math.PI * 17) * 0.3 * Math.min(1, v / 6);
  if (grass) f += (Math.random() - 0.5) * 0.35 * Math.min(1, v / 5);
  f += Math.sin(t * 2 * Math.PI * (9 + v * 0.8)) * 0.025 * Math.min(1, v / 15);   // (the asphalt's grain)
  if (hit) f += (Math.random() < 0.5 ? -1 : 1) * hit * 0.7;
  return Math.max(-1, Math.min(1, f * strength));
}
