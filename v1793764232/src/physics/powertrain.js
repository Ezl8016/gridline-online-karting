// Engine -> centrifugal dry clutch -> #35 chain -> solid 30 mm rear axle with
// a single hydraulic disc. Two engines (ENGINES below): the rental Honda
// GX390 and the Briggs & Stratton LO206 racing engine; the kart picked in the
// Garage says which.

const RPM = (w) => w * 60 / (2 * Math.PI);
const RAD = (rpm) => rpm * 2 * Math.PI / 60;

// Honda's published gross torque curve, extended past the stock 3,600 rpm
// governor. NET ~1.0 keeps it close to a stock GX390 (~13 hp): calibrated
// against a real 270 lb driver's ~31 s Tidal Turns lap (very quick for the
// track), with lighter drivers proportionally faster.
const GX390_CURVE = [
  [1000, 17.5], [1500, 21.5], [2000, 24.3], [2500, 26.4], [3000, 25.9],
  [3400, 24.6], [3600, 23.7], [3900, 22.0], [4200, 19.8], [4600, 17.4], [4900, 15.5],
];

// Briggs & Stratton LO206: 204 cc, factory sealed (crimped wire seals, so no
// tuning: every LO206 makes the same power), about 8.8-9 hp at 5,500 rpm,
// held to 6,100 rpm by a digital limiter in the ignition. Its curve is flat
// and peaks around 3,500 rpm; 11.6 Nm at 5,500 rpm is 8.96 hp.
const LO206_CURVE = [
  [1500, 9.5], [2000, 11.0], [2500, 12.2], [3000, 12.9], [3500, 13.2], [4000, 13.0],
  [4500, 12.6], [5000, 12.1], [5500, 11.6], [6000, 10.6], [6300, 9.8],
];

// IAME KA100 Reed Jet: 100 cc reed-valve two-stroke, peaky, about 19 hp at
// ~13,000 rpm, revving to ~16,000. Torque in Nm.
const KA100_CURVE = [
  [4000, 3.5], [6000, 5.0], [8000, 7.0], [10000, 9.0], [11500, 10.3], [12500, 10.6],
  [13500, 10.1], [14500, 9.1], [15500, 7.9], [16200, 7.0],
];

// KZ125: 125 cc single-cylinder, liquid-cooled two-stroke, about 46 hp at
// ~13,500 rpm, revving to 16,000. Torque in Nm.
const KZ125_CURVE = [
  [3000, 6], [5000, 9], [7000, 13], [9000, 18], [10500, 22], [11500, 24.8], [12500, 25.8],
  [13500, 24.3], [14500, 21], [15500, 17], [16200, 14],
];

export const ENGINES = {
  gx390: {
    name: 'Honda GX390', curve: GX390_CURVE, net: 0.93, idleRpm: 1500, governorRpm: 4700, limiter: 'governor',
    clutchIn: 2000, clutchFull: 2600, clutchCap: 95, ratio: 68 / 20, Ie: 0.075,
  },
  lo206: {
    // the LO206's curve and 6,100 rpm digital limiter, tuned to about twice
    // stock power (~18 hp; stock is ~9) by request, as stock felt badly
    // underpowered: a clutch that locks by 3,000 rpm and gearing for ~60 mph
    // on the limiter. Between the R25 and the KA100: 0-30 mph in ~4.9 s.
    name: 'Briggs & Stratton LO206', curve: LO206_CURVE, net: 2.0, idleRpm: 1800, governorRpm: 6100, limiter: 'cut',
    clutchIn: 2600, clutchFull: 3000, clutchCap: 240, ratio: 3.25, Ie: 0.045,
  },
  ka100: {
    // Race-tuned, by request, for ~75 mph and a hard launch: the KA100's
    // peaky two-stroke curve at 1.8x (~34 hp; a stock KA100 makes ~19 hp and
    // does nearer 65-70 mph), a light flywheel that revs up instantly, a
    // clutch that bites at ~12,000 rpm in the power band, and gearing that
    // reaches the 16,000 rpm limit at ~75 mph. 0-30 mph in ~3.4 s, 0-60 in
    // ~6.7 s (175 lb driver).
    name: 'IAME KA100', curve: KA100_CURVE, net: 1.8, idleRpm: 3000, governorRpm: 16000, limiter: 'cut',
    clutchIn: 11800, clutchFull: 12600, clutchCap: 200, ratio: 6.8, Ie: 0.004,
  },
  kz125: {
    // A six-speed sequential: gears are engine-to-axle ratios, first good for
    // ~38 mph and sixth for ~90 mph. The clutch only matters leaving the line,
    // so it takes itself up. A two-stroke barely engine-brakes.
    name: 'KZ125', curve: KZ125_CURVE, net: 1, idleRpm: 3500, governorRpm: 16000, limiter: 'cut',
    clutchIn: 5500, clutchFull: 8500, clutchCap: 120, ratio: 13.5, Ie: 0.006, engineBrake: 0.35, idleThrottle: 0.45,
    gears: [13.5, 10.6, 8.7, 7.4, 6.4, 5.68],
  },
};

const SHIFT_TIME = 0.05;                         // s: the ignition cut while the dogs change over
const OVER_REV = 600;                            // rpm past the limit a downshift may ask for
const AUTO = { up: 15300, downTo: 13800, wait: 0.35 };   // automatic shifting (the AI, and the setting)

function curve(c, rpm) {
  if (rpm <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (rpm <= c[i][0]) {
      const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
      return c[i - 1][1] + t * (c[i][1] - c[i - 1][1]);
    }
  }
  return c[c.length - 1][1];
}

export class Powertrain {
  constructor(engine = 'gx390') {
    this.setEngine(engine);
    this.chainEff = 0.93;
    this.Ia = 0.24;                              // axle, rear wheels, sprocket, disc
    this.brakeMax = 400;                         // Nm at the axle (enough to lock the rears)
    this.we = RAD(this.idleRpm);
    this.wa = 0;
    this.throttleEff = 0;
    this.clutchSlip = 0;
  }

  setEngine(id) {
    const e = ENGINES[id] || ENGINES.gx390;
    this.engine = ENGINES[id] ? id : 'gx390';
    this.spec = e;
    this.curve = e.curve; this.net = e.net;
    this.idleRpm = e.idleRpm;
    this.governorRpm = e.governorRpm;           // the governor's or the limiter's rpm
    this.clutchIn = e.clutchIn;                 // engagement starts
    this.clutchFull = e.clutchFull;             // fully locked
    this.clutchCap = e.clutchCap;               // Nm when fully engaged
    this.ratio = e.ratio;                       // final drive
    this.Ie = e.Ie;                             // crank + flywheel + clutch drum
    this.cut = false;
    this.gears = e.gears || null;               // a gearbox: overall ratios, first to top
    this.gear = 1;
    this.shifting = 0; this.autoWait = 0;
  }

  // change gear: +1 up, -1 down. Nothing happens past either end, or if going
  // down would throw the engine past its limit
  shift(dir) {
    if (!this.gears || this.shifting > 0) return false;
    const to = this.gear + dir;
    if (to < 1 || to > this.gears.length) return false;
    if (dir < 0 && RPM(this.gears[to - 1] * Math.abs(this.wa)) > this.governorRpm + OVER_REV) return false;
    this.gear = to;
    this.ratio = this.gears[to - 1];
    this.shifting = SHIFT_TIME;
    return true;
  }

  // the gear an automatic would be in
  autoShift(dt) {
    this.autoWait -= dt;
    if (this.autoWait > 0 || this.shifting > 0) return;
    const r = this.gears, g = this.gear - 1;
    if (this.rpm > AUTO.up) { if (this.shift(1)) this.autoWait = AUTO.wait; }
    else if (g > 0 && RPM(r[g - 1] * Math.abs(this.wa)) < AUTO.downTo) { if (this.shift(-1)) this.autoWait = AUTO.wait; }
  }

  get maxRpm() { return this.governorRpm; }

  get rpm() { return RPM(this.we); }

  engineTorque(throttle) {
    const rpm = this.rpm;
    // idle governor
    const idle = Math.min(this.spec.idleThrottle ?? 0.22, Math.max(0, (this.idleRpm - rpm) / 400));
    let thr = Math.max(throttle, idle);
    if (this.spec.limiter === 'cut') {
      // digital limiter: kills the spark at the limit, back on ~120 rpm below
      if (rpm >= this.governorRpm) this.cut = true;
      else if (rpm < this.governorRpm - 120) this.cut = false;
      if (this.cut) thr = 0;
    } else {
      // mechanical governor: closes the throttle over the last ~150 rpm
      thr = Math.min(thr, Math.max(0, Math.min(1, (this.governorRpm + 60 - rpm) / 150)));
    }
    this.throttleEff = thr;
    // the published curve is measured at the crank, so it's already net of
    // internal friction; friction and pumping losses show up as engine
    // braking as the throttle closes
    const drive = thr * curve(this.curve, rpm) * this.net * (this.boost ?? 1);   // (boost: the driver's weight, kart.js)
    const braking = (1 - thr) * (1.8 + 0.002 * rpm) * (this.spec.engineBrake ?? 1);
    return drive - (rpm > 50 ? braking : 0);
  }

  // Advance by dt. tyreTorque = torque the road applies to the axle
  // (-r * sum Fx of rear tyres). Returns the axle speed.
  step(dt, throttle, brake, tyreTorque) {
    if (this.gears) {
      if (this.auto) this.autoShift(dt);
      // changing gear: the ignition cut, and nothing through the box until the
      // engine's at the new gear's speed
      if (this.shifting > 0) {
        this.shifting -= dt;
        this.we += (this.ratio * Math.abs(this.wa) - this.we) * Math.min(1, dt / 0.015);
        return this.freeAxle(dt, brake, tyreTorque);
      }
    }
    const Te = this.engineTorque(throttle);
    const rpm = this.rpm;
    const engage = Math.max(0, Math.min(1, (rpm - this.clutchIn) / (this.clutchFull - this.clutchIn)));
    const cap = this.clutchCap * engage * engage;
    const slip = this.we - this.ratio * this.wa;
    // stiff viscous coupling clamped by the shoe capacity (stable at 2 kHz;
    // softer through a low gear, where the axle looks light to the engine)
    const k = this.gears ? Math.min(40, 0.5 / (dt * (1 / this.Ie + this.ratio * this.ratio / this.Ia))) : 40;
    const Tc = Math.max(-cap, Math.min(cap, k * slip));
    this.clutchSlip = slip;

    this.we += dt * (Te - Tc) / this.Ie;
    if (this.we < 0) this.we = 0;

    return this.freeAxle(dt, brake, tyreTorque, Tc * this.ratio * this.chainEff);
  }

  freeAxle(dt, brake, tyreTorque, drive = 0) {
    let wa = this.wa + dt * (drive + tyreTorque) / this.Ia;
    // disc brake: friction that can stop the axle but never reverse it
    const dwBrake = (brake * this.brakeMax) * dt / this.Ia;
    if (Math.abs(wa) <= dwBrake) wa = 0;
    else wa -= Math.sign(wa) * dwBrake;
    this.wa = wa;
    return wa;
  }

  reset() {
    this.we = RAD(this.idleRpm); this.wa = 0;
    if (this.gears) { this.gear = 1; this.ratio = this.gears[0]; this.shifting = 0; }
  }
}
