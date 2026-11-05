// The sky and the clouds for the WebGPU renderer, in three.js's node
// language (TSL): the same sums as the GLSL ones (three.js r169's Sky,
// graded as world.js gradeSky does, and world.js buildClouds), so the two
// renderers draw the same sky. Each material keeps a `uniforms` object of
// { name: node } like a ShaderMaterial's, so world.js sets them the same way.

import { BackSide, BoxGeometry, Mesh, NodeMaterial, Vector3 } from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, uniform, acos, cos, dot, exp, max, mix, clamp, normalize, pow, smoothstep, floor, fract, sin, step,
  positionWorld, cameraPosition, modelViewProjection, varyingProperty, If, Discard, Loop } from 'three/tsl';

export class Sky extends Mesh {
  constructor() {
    const material = new NodeMaterial();
    super(new BoxGeometry(1, 1, 1), material);
    this.isSky = true;
    const U = material.uniforms = {
      turbidity: uniform(2), rayleigh: uniform(1), mieCoefficient: uniform(0.005), mieDirectionalG: uniform(0.8),
      sunPosition: uniform(new Vector3()), up: uniform(new Vector3(0, 1, 0)), uNight: uniform(0),
    };
    const vSunDirection = varyingProperty('vec3'), vSunfade = varyingProperty('float'), vBetaR = varyingProperty('vec3'),
      vBetaM = varyingProperty('vec3'), vSunE = varyingProperty('float');
    material.vertexNode = Fn(() => {
      const e = float(2.718281828459045);
      const totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
      const MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
      const cutoffAngle = float(1.6110731556870734), steepness = float(1.5), EE = float(1000.0);
      const sd = normalize(U.sunPosition);
      vSunDirection.assign(sd);
      const zc = clamp(dot(sd, U.up), -1, 1);
      vSunE.assign(EE.mul(max(0.0, float(1.0).sub(pow(e, cutoffAngle.sub(acos(zc)).div(steepness).negate())))));
      const fade = float(1.0).sub(clamp(float(1.0).sub(exp(U.sunPosition.y.div(450000.0))), 0, 1));
      vSunfade.assign(fade);
      vBetaR.assign(totalRayleigh.mul(U.rayleigh.sub(float(1.0).sub(fade))));
      vBetaM.assign(float(0.434).mul(float(0.2).mul(U.turbidity).mul(10E-18)).mul(MieConst).mul(U.mieCoefficient));
      const p = modelViewProjection;
      p.z.assign(p.w);                           // (at the far plane)
      return p;
    })();
    material.colorNode = Fn(() => {
      const pi = float(3.141592653589793);
      const direction = normalize(positionWorld.sub(cameraPosition)).toVar();
      const zenithAngle = acos(max(0.0, dot(U.up, direction)));
      const inverse = float(1.0).div(cos(zenithAngle).add(float(0.15).mul(pow(float(93.885).sub(zenithAngle.mul(180.0).div(pi)), -1.253))));
      const sR = float(8.4E3).mul(inverse), sM = float(1.25E3).mul(inverse);
      const Fex = exp(vBetaR.mul(sR).add(vBetaM.mul(sM)).negate()).toVar();
      const cosTheta = dot(direction, vSunDirection);
      const rPhase = float(0.05968310365946075).mul(float(1.0).add(pow(cosTheta.mul(0.5).add(0.5), 2.0)));
      const betaRTheta = vBetaR.mul(rPhase);
      const g = U.mieDirectionalG, g2 = pow(g, 2.0);
      const mPhase = float(0.07957747154594767).mul(float(1.0).sub(g2).mul(float(1.0).div(pow(float(1.0).sub(float(2.0).mul(g).mul(cosTheta)).add(g2), 1.5))));
      const betaMTheta = vBetaM.mul(mPhase);
      const ratio = vSunE.mul(betaRTheta.add(betaMTheta).div(vBetaR.add(vBetaM)));
      const Lin = pow(ratio.mul(float(1.0).sub(Fex)), vec3(1.5)).toVar();
      Lin.mulAssign(mix(vec3(1.0), pow(ratio.mul(Fex), vec3(0.5)), clamp(pow(float(1.0).sub(dot(U.up, vSunDirection)), 5.0), 0.0, 1.0)));
      const L0 = vec3(0.1).mul(Fex).toVar();
      const sac = float(0.9999566769464484);
      L0.addAssign(vSunE.mul(19000.0).mul(Fex).mul(smoothstep(sac, sac.add(0.00002), cosTheta)));
      const texColor = Lin.add(L0).mul(0.04).add(vec3(0.0, 0.0003, 0.00075));
      const retColor = pow(texColor, vec3(float(1.0).div(float(1.2).add(vSunfade.mul(1.2)))));
      // the grade (world.js gradeSky): more colour, deeper blue overhead; at night its own sky
      const skyLum = dot(retColor, vec3(0.2126, 0.7152, 0.0722));
      const graded = max(mix(vec3(skyLum), retColor, 1.55), 0.0).mul(mix(1.0, 0.72, smoothstep(0.04, 0.55, direction.y))).toVar();
      If(U.uNight.greaterThan(0.0), () => {
        const up = clamp(direction.y, 0.0, 1.0);
        const night = mix(vec3(0.045, 0.036, 0.034), vec3(0.010, 0.016, 0.034), smoothstep(0.0, 0.18, up)).toVar();
        night.assign(mix(night, vec3(0.003, 0.006, 0.016), smoothstep(0.18, 0.9, up)));
        const sd = floor(direction.mul(700.0));
        const h = fract(sin(dot(sd, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
        night.addAssign(vec3(0.9, 0.95, 1.0).mul(step(0.9982, h)).mul(smoothstep(0.06, 0.35, up)).mul(float(0.25).add(fract(h.mul(91.7)).mul(0.75))).mul(0.5));
        graded.assign(mix(graded, night, U.uNight));
      });
      return graded;
    })();
    material.side = BackSide;
    material.depthWrite = false;
    material.fog = false;
  }
}

// world.js buildClouds's material
const hash = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
export const vnoise = Fn(([p]) => {
  const i = floor(p), f = fract(p), u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
  return mix(mix(hash(i), hash(i.add(vec2(1, 0))), u.x), mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), u.x), u.y);
});
const fbm = Fn(([p0]) => {
  const p = vec2(p0).toVar(), v = float(0).toVar(), a = float(0.5).toVar();
  Loop(5, () => { v.addAssign(a.mul(vnoise(p))); p.assign(p.mul(2.03).add(vec2(1.7, 9.2))); a.mulAssign(0.5); });
  return v;
});

export function cloudMaterial(sunDir) {
  const m = new NodeMaterial();
  const U = m.uniforms = { uTime: uniform(0), uSun: uniform(sunDir.clone()), uCam: uniform(new Vector3()), uCover: uniform(0), uGrey: uniform(0), uDim: uniform(1) };
  const out = Fn(() => {
    const p = positionWorld.xz.div(1400.0).add(vec2(U.uTime.mul(0.004), U.uTime.mul(0.0015))).toVar();
    const n = fbm(p).toVar();
    const d = smoothstep(float(0.52).sub(U.uCover.mul(0.42)), float(0.78).sub(U.uCover.mul(0.3)), n).toVar();
    If(d.lessThan(0.01), () => { Discard(); });
    const edge = fbm(p.add(U.uSun.xz.mul(0.03)));
    const lit = clamp(float(0.55).add(n.sub(edge).mul(4.0)), 0.25, 1.0);
    const col = mix(vec3(0.62, 0.66, 0.74), vec3(1.0, 0.98, 0.95), lit).mul(2.2).toVar();
    col.assign(mix(col, vec3(0.6, 0.63, 0.67).mul(float(1.2).add(lit.mul(0.5))), U.uGrey));
    const fade = float(1.0).sub(smoothstep(3000.0, 9000.0, positionWorld.xz.sub(U.uCam.xz).length()));
    return vec4(col.mul(U.uDim), d.mul(0.92).mul(fade));
  })();
  m.colorNode = out;
  m.transparent = true; m.depthWrite = false; m.fog = false;
  return m;
}
