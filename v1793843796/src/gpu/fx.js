// Effects and rain for the WebGPU renderer: effects.js's puffs and spray,
// rain.js's streaks, sheets and splashes, the same sums as their GLSL (named
// beside each). Their meshes sit at the origin, so a positionNode here is a
// world position. Each material keeps `uniforms` like a ShaderMaterial's.

import { NodeMaterial, Color, Vector3, BackSide, DoubleSide } from 'three/webgpu';
import { Fn, If, Discard, vec2, vec3, vec4, float, uniform, attribute, varying, uv, texture, positionGeometry, cameraPosition, cameraWorldMatrix,
  smoothstep, mix, clamp, fract, floor, sin, cos, abs, max, min, dot, length, normalize, cross, pow, sqrt } from 'three/tsl';

const mk = (o = {}) => Object.assign(new NodeMaterial(), { transparent: true, depthWrite: false, fog: false }, o);
const gmod = (x, y) => x.sub(y.mul(floor(x.div(y))));
const PI = 3.14159;
// a colour and alpha, drawn only where the alpha clears the threshold (a NaN never does)
const out = (col, a, th) => Fn(() => {
  const al = float(a).toVar();
  If(al.greaterThan(th).not(), () => { Discard(); });
  return vec4(col, al);
})();
// across a quad: 1 in the middle, 0 at the long edges
const across = (u) => { const x = min(abs(u.x.sub(0.5)).mul(2.0), 1.0); return float(1.0).sub(x.mul(x)); };

// ---- effects.js VERT/FRAG: smoke and dust puffs, turned to face the camera
export function puffMaterial(tex) {
  const m = mk({ fog: true });
  const uLight = uniform(new Color(1, 1, 1));
  const iPos = attribute('iPos', 'vec3'), iP = attribute('iP', 'vec4'), iCol = attribute('iCol', 'vec3');
  m.positionNode = Fn(() => {
    const c = cos(iP.z), s = sin(iP.z), p = positionGeometry.xy.mul(iP.x);
    const off = vec2(c.mul(p.x).sub(s.mul(p.y)), s.mul(p.x).add(c.mul(p.y)));
    return iPos.add(cameraWorldMatrix.mul(vec4(off, 0.0, 0.0)).xyz);
  })();
  m.colorNode = out(varying(iCol.mul(iP.w)).mul(uLight), texture(tex, uv()).r.mul(varying(iP.y)), 0.003);
  m.uniforms = { uTex: { value: tex }, uLight };
  return m;
}

// ---- effects.js DROP_V/DROP_F: a drop of spray, a thin streak along the way it moves as you see it
export function dropMaterial(uLight) {
  const m = mk();
  const uCamVel = uniform(new Vector3());
  const iPos = attribute('iPos', 'vec3'), iVel = attribute('iVel', 'vec3'), iD = attribute('iD', 'vec2');
  m.positionNode = Fn(() => {
    const v0 = iVel.sub(uCamVel), s = length(v0).add(0.001), v = v0.div(s);
    const to = cameraPosition.sub(iPos), d = length(to);
    const side = normalize(cross(v, to.div(max(d, 0.01))));
    return iPos.add(v.mul(positionGeometry.y).mul(clamp(s.mul(0.03), 0.05, 0.42))).add(side.mul(positionGeometry.x).mul(iD.y).mul(float(1.0).add(d.mul(0.05))));
  })();
  const u = uv();
  m.colorNode = out(vec3(0.9, 0.93, 0.96).mul(float(0.25).add(uLight.mul(2.2))), across(u).mul(sin(clamp(u.y, 0.0, 1.0).mul(PI))).mul(varying(iD.x)), 0.004);
  m.uniforms = { uLight, uCamVel };
  return m;
}

// ---- rain.js STREAK_V/STREAK_F: fine tapered streaks in a box of rain that travels with the camera
export function streakMaterial(u, box) {
  const m = mk();
  const B = vec3(...box), iSeed = attribute('iSeed', 'vec4');
  const rel = Fn(() => {
    const vel = vec3(u.uWind.x, float(8.0).add(iSeed.w.mul(4.0)).negate(), u.uWind.z);
    return gmod(iSeed.xyz.mul(B).add(vel.mul(u.uTime)).sub(cameraPosition), B).sub(B.mul(0.5));
  })();
  m.positionNode = Fn(() => {
    const vel = vec3(u.uWind.x, float(8.0).add(iSeed.w.mul(4.0)).negate(), u.uWind.z);
    const r = rel.toVar(), rv = vel.sub(u.uCamVel), s = length(rv), axis = rv.div(s), d = length(r);
    const len = clamp(s.mul(0.03), 0.3, 1.5).mul(float(0.7).add(iSeed.w.mul(0.6)));
    const side = normalize(cross(axis, r.negate().div(max(d, 0.01))));
    const w = mix(0.005, 0.013, iSeed.w).mul(float(1.0).add(d.mul(0.07)));
    return cameraPosition.add(r).add(axis.mul(positionGeometry.y).mul(len)).add(side.mul(positionGeometry.x).mul(w));
  })();
  const d = length(rel);
  const vA = varying(smoothstep(0.5, 2.0, d).mul(float(1.0).sub(smoothstep(15.0, 23.0, d))).mul(float(0.55).add(iSeed.w.mul(0.45))));
  const q = uv();
  m.colorNode = out(u.uCol, across(q).mul(pow(max(sin(clamp(q.y, 0.0, 1.0).mul(PI)), 0.0), 0.8)).mul(vA).mul(u.uA), 0.002);
  return m;
}

// ---- rain.js SHEET_F: sheets of rain moving across the distance
const h = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
const n = Fn(([p]) => {
  const i = floor(p), f0 = fract(p), f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0)));
  return mix(mix(h(i), h(i.add(vec2(1, 0))), f.x), mix(h(i.add(vec2(0, 1))), h(i.add(vec2(1, 1))), f.x), f.y);
});
export function sheetMaterial(u) {
  const m = mk({ side: BackSide });
  const q = uv(), t = u.uTime;
  const sheets = smoothstep(0.3, 0.8, n(vec2(q.x.mul(11.0).add(t.mul(0.05)), t.mul(0.04))).mul(0.65).add(n(vec2(q.x.mul(29.0).sub(t.mul(0.03)), 3.0)).mul(0.35)));
  const fine = n(vec2(q.x.mul(420.0), q.y.mul(5.0).add(t.mul(2.2))));
  const a = u.uA.mul(float(0.45).add(sheets.mul(0.85))).mul(float(0.8).add(fine.mul(0.3))).mul(smoothstep(0.0, 0.04, q.y)).mul(float(1.0).sub(smoothstep(0.35, 1.0, q.y)));
  m.colorNode = vec4(u.uCol, a);
  return m;
}

// ---- rain.js RING / CROWN: a splash where a drop lands, a ring and a little crown of water
export function splashMaterial(u, life, kind) {
  const m = mk({ side: DoubleSide });
  const iS = attribute('iS', 'vec4');
  const tOf = () => clamp(u.uClock.sub(iS.w).div(life), 0.0, 1.0);
  m.positionNode = Fn(() => {
    const vT = tOf(), p = positionGeometry;
    if (kind === 'ring') return iS.xyz.add(vec3(p.x, 0.0, p.y).mul(mix(0.03, 0.2, sqrt(vT))));
    const to = cameraPosition.sub(iS.xyz).mul(vec3(1, 0, 1)), right = normalize(vec3(to.z, 0.0, to.x.negate()));
    const ht = float(0.06).mul(sin(pow(vT, 0.7).mul(PI))).add(0.001);
    return iS.xyz.add(right.mul(p.x).mul(mix(0.025, 0.07, vT))).add(vec3(0.0, p.y.add(0.5).mul(ht), 0.0));
  })();
  const vT = varying(tOf()), q = uv();
  let a;
  if (kind === 'ring') {
    const d = length(q.sub(0.5)).mul(2.0);
    a = smoothstep(0.2, 0.0, abs(d.sub(0.75))).mul(pow(float(1.0).sub(vT), 1.5)).mul(u.uA);
  } else {
    const x = min(abs(q.x.sub(0.5)).mul(2.0), 1.0), c = abs(x.sub(q.y.mul(0.85)));
    a = smoothstep(0.2, 0.02, c).mul(float(1.0).sub(q.y.mul(0.6))).mul(float(1.0).sub(vT)).mul(u.uA);
  }
  m.colorNode = out(u.uCol, a, 0.003);
  return m;
}
