// The game's custom materials for the WebGPU renderer, in three.js's node
// language (TSL): each one the same sums as its GLSL version (named beside
// it), set on the same three.js material, which the renderer turns into a
// node material when it first draws it. Uniforms the game already changes
// ({ value } objects) are bound to nodes (util.js bind), so it carries on
// changing them the same way.

import { NormalRGPacking, PhysicalLightingModel } from 'three/webgpu';
import { Fn, If, Loop, varyingProperty, vec2, vec3, vec4, float, mat2, uniform, attribute, varying, uv, texture, wgslFn, wgsl,
  positionWorld, positionLocal, positionGeometry, normalGeometry, normalWorld, cameraViewMatrix, cameraPosition,
  materialColor, materialRoughness, materialEmissive, materialReference, normalMap,
  smoothstep, mix, clamp, step, fract, floor, sin, cos, abs, max, min, dot, length, normalize, pow, select } from 'three/tsl';
import { bind, instanceMatrix, materialTexture, keyed, LUMA } from './util.js';
import { vnoise } from './sky.js';
import { LIVERY, LIVERY_HELPERS, SUIT, SUIT_HELPERS } from './patterns.js';

const luma = (c) => dot(c, vec3(...LUMA));
const hsh = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
// a normal in world space, as the view-space normal a material's normalNode wants
const toView = (n) => normalize(cameraViewMatrix.mul(vec4(n, 0.0)).xyz);

// ---- world.js groundMaterial: the wide photo ground with world-scale detail
export function wideGround(mat, uu) {
  const U = Object.fromEntries(Object.entries(uu).map(([k, u]) => [k, bind(u)]));
  const xz = positionWorld.xz;
  const su = Fn(() => xz.sub(U.uDetailRect.xy).div(U.uDetailRect.zw.sub(U.uDetailRect.xy)))();
  const surf = Fn(() => U.uSurf.sample(vec2(su.x, float(1).sub(su.y))).r)();
  mat.colorNode = Fn(() => {
    const dc = vec4(materialColor).toVar();
    const inside = step(0.0, su.x).mul(step(su.x, 1.0)).mul(step(0.0, su.y)).mul(step(su.y, 1.0));
    const s = surf.mul(inside);
    const asphalt = smoothstep(0.6, 0.95, s);
    const fine = U.uNoise.sample(xz.mul(1.7)).r, med = U.uNoise.sample(xz.mul(0.11)).g, big = U.uNoise.sample(xz.mul(0.013)).b;
    const aCol = dc.rgb.mul(float(0.86).add(fine.mul(0.22))).mul(float(0.92).add(med.mul(0.16)));
    const blades = U.uNoise.sample(xz.mul(4.3)).r;
    const gCol = dc.rgb.mul(float(0.78).add(blades.mul(0.36))).mul(float(0.85).add(med.mul(0.3))).mul(mix(vec3(1.0), vec3(0.95, 1.05, 0.9), big));
    dc.rgb.assign(mix(gCol, aCol, asphalt));
    If(U.uDetailOn.greaterThan(0.5), () => {
      const ph = dc.rgb.toVar();
      const green = smoothstep(0.355, 0.4, ph.g.div(max(ph.r.add(ph.g).add(ph.b), 1e-4)));
      const gd = U.uGrassT.sample(xz.mul(0.5)).rgb.div(U.uGrassM), ad = U.uAsphT.sample(xz.mul(0.5)).rgb.div(U.uAsphM);
      dc.rgb.assign(ph.mul(clamp(mix(ad, gd, green), 0.35, 2.2)));
    });
    return dc;
  })();
  mat.roughnessNode = mix(1.0, 0.82, smoothstep(0.6, 0.95, surf));
  keyed(mat);
}

// ---- ground.js: the modelled circuit's ground (scanned surfaces blended by a weights map)
export function circuitGround(mat, uu, edgeFade) {
  const U = Object.fromEntries(Object.entries(uu).map(([k, u]) => [k, bind(u)]));
  const xz = positionWorld.xz;
  // each texture sampled twice, at two scales and angles, blended by low-frequency noise
  const tileTex = (t, p, k) => {
    const q = mat2(0.8, -0.6, 0.6, 0.8).mul(p).mul(0.43).add(17.3);
    return mix(t.sample(p.mul(k)), t.sample(q.mul(k)), smoothstep(0.3, 0.7, vnoise(p.mul(0.07))));
  };
  const rect = U.uRect;
  const gUV = Fn(() => { const g = xz.sub(rect.xy).div(rect.zw.sub(rect.xy)); return vec2(g.x, float(1).sub(g.y)); })();
  // the weights of the four surfaces here, with ragged natural edges
  const gW = Fn(() => {
    const w3 = U.uW.sample(gUV).rgb;
    const w = vec4(w3, max(0.0, float(1.0).sub(w3.r).sub(w3.g).sub(w3.b))).toVar();
    const n1 = vnoise(xz.mul(3.1)).mul(0.6).add(vnoise(xz.mul(9.7)).mul(0.4));
    w.assign(pow(max(w, vec4(0.0)), vec4(1.4)).mul(float(0.85).add(vec4(n1, float(1).sub(n1), n1, float(1).sub(n1)).mul(0.3))));
    return w.div(max(dot(w, vec4(1.0)), 1e-3));
  })().toVar('gW');
  const gFade = Fn(() => { const e = min(xz.sub(rect.xy), rect.zw.sub(xz)); return smoothstep(0.0, edgeFade, min(e.x, e.y)); })().toVar('gFade');
  const gPud = Fn(() => U.uWet.mul(gW.x.add(gW.w)).mul(smoothstep(0.58, 0.72, vnoise(xz.mul(0.31)).mul(0.7).add(vnoise(xz.mul(1.7)).mul(0.3)))))().toVar('gPud');
  const A = [U.uA0, U.uA1, U.uA2, U.uA3], N = [U.uN0, U.uN1, U.uN2, U.uN3], comp = ['x', 'y', 'z', 'w'];
  mat.colorNode = Fn(() => {
    const w = gW, c = vec3(0.0).toVar();
    // only the surfaces present here (most pixels are just one); asphalt warmed a touch
    If(w.x.greaterThan(0.004), () => { c.addAssign(tileTex(A[0], xz, U.uTile.x).rgb.mul(vec3(1.05, 1.0, 0.92)).mul(w.x)); });
    for (const i of [1, 2, 3]) If(w[comp[i]].greaterThan(0.004), () => { c.addAssign(tileTex(A[i], xz, U.uTile[comp[i]]).rgb.mul(w[comp[i]])); });
    // grit dragged onto the tarmac where a dirt run-off meets it
    If(w.x.greaterThan(0.3), () => {
      const o = vec2(0.8).div(rect.zw.sub(rect.xy));
      const dn = max(max(U.uW.sample(gUV.add(vec2(o.x, 0.0))).b, U.uW.sample(gUV.sub(vec2(o.x, 0.0))).b),
        max(U.uW.sample(gUV.add(vec2(0.0, o.y))).b, U.uW.sample(gUV.sub(vec2(0.0, o.y))).b));
      const grit = smoothstep(0.58, 0.86, vnoise(xz.mul(7.0)).mul(0.6).add(vnoise(xz.mul(23.0)).mul(0.4))).mul(smoothstep(0.15, 0.6, dn)).mul(w.x);
      c.assign(mix(c, tileTex(A[2], xz, U.uTile.z).rgb.mul(0.95), grit.mul(0.85)));
    });
    // the photo's broad colour, as a ratio; stronger on the tarmac
    const tint = U.uTint.sample(gUV).rgb.mul(2.0).toVar();
    tint.assign(mix(tint, tint.sub(1.0).mul(1.45).add(1.0), w.x));
    c.mulAssign(mix(vec3(1.0), tint, float(0.85).sub(w.w.mul(0.55))));
    // mowed in stripes
    const pass = sin(dot(xz, vec2(0.94, 0.34)).mul(3.14159 / 4.0));
    const stripe = smoothstep(-0.25, 0.25, pass).mul(2.0).sub(1.0);
    c.mulAssign(float(1.0).add(float(0.075).mul(stripe).mul(w.y).mul(float(1.0).sub(U.uWet.mul(0.5)))));
    // wet: darker, and puddles in the low patches
    const hard = w.x.add(w.w);
    c.mulAssign(float(1.0).sub(U.uWet.mul(hard.mul(0.5).add(w.y.mul(0.18)))));
    c.mulAssign(float(1.0).sub(gPud.mul(0.25)));
    return vec4(mix(U.uPhoto.sample(gUV).rgb, c, gFade), 1.0);
  })();
  mat.roughnessNode = Fn(() => {
    const r = float(0.0).toVar();
    for (const i of [0, 1, 2, 3]) If(gW[comp[i]].greaterThan(0.004), () => { r.addAssign(tileTex(N[i], xz, U.uTile[comp[i]]).b.mul(U.uRough[comp[i]]).mul(gW[comp[i]])); });
    const rf = mix(0.95, clamp(r, 0.3, 1.0), gFade).toVar();
    rf.assign(mix(rf, 0.55, U.uWet.mul(gW.x.add(gW.w)).mul(gFade)));
    rf.assign(mix(rf, 0.2, gPud.mul(gFade)));
    return rf;
  })();
  // rain on standing water: rings spreading from where drops land
  const ripples = Fn(([p]) => {
    const sum = vec2(0.0).toVar();
    for (const k of [0, 1]) {
      const g = p.mul(1.3 + k * 0.6).add(k * 17.3), id = floor(g), f = fract(g).sub(0.5);
      const s = hsh(id.add(k * 7.0)), ph = fract(U.uRainT.mul(float(0.7).add(s.mul(0.5))).add(s.mul(9.0)));
      const d = f.sub(vec2(hsh(id.add(1.3)), hsh(id.add(2.7))).sub(0.5).mul(0.5));
      const r = length(d).add(1e-3), at = ph.mul(0.24);
      sum.addAssign(d.div(r).mul(sin(r.sub(at).mul(60.0))).mul(smoothstep(0.07, 0.0, abs(r.sub(at)))).mul(float(1).sub(ph)).mul(float(1).sub(ph)));
    }
    return sum;
  });
  mat.normalNode = Fn(() => {
    const b = vec2(0.0).toVar();
    for (const i of [0, 1, 2, 3]) If(gW[comp[i]].greaterThan(0.004), () => { b.addAssign(tileTex(N[i], xz, U.uTile[comp[i]]).xy.mul(2.0).sub(1.0).mul(gW[comp[i]]).mul(U.uBump[comp[i]])); });
    const nw = normalize(normalize(normalWorld).add(vec3(b.x, 0.0, b.y.negate()).mul(gFade).mul(float(1.0).sub(gPud.mul(0.85))))).toVar();
    If(gPud.greaterThan(0.01), () => { const rp = ripples(xz); nw.assign(normalize(nw.add(vec3(rp.x, 0.0, rp.y).mul(0.32).mul(gPud)))); });
    return toView(nw);
  })();
  mat.setupLightingModel = () => new WetLighting(U.uWet);
  keyed(mat);
}

// a floodlight's reflection in wet tarmac stays a bright sheen, not a white-out through the bloom
// (and never a broken pixel): the sun and lamps' specular, softened once they've all been added
class WetLighting extends PhysicalLightingModel {
  constructor(wet) { super(); this.wet = wet; }
  start(builder) {
    super.start(builder);
    const sp = builder.context.reflectedLight.directSpecular;
    If(this.wet.greaterThan(0.0), () => {
      sp.assign(select(sp.r.add(sp.g).add(sp.b).lessThan(1e5), sp.div(float(1.0).add(dot(sp, vec3(0.33)).div(0.45))), vec3(0.0)));
    });
  }
}

// ---- grass.js: grass tufts (turned, sized, swaying; coloured from the ground under them, lit as facing up)
export function grassTufts(mat, uu) {
  const U = Object.fromEntries(Object.entries(uu).map(([k, u]) => [k, bind(u)]));
  const tuft = attribute('tuft', 'vec4'), tip = attribute('tip', 'float');
  const vRoot = varyingProperty('vec2', 'vRoot'), vTip = varying(tip);
  mat.positionNode = Fn(() => {
    const root = positionLocal.sub(positionGeometry).toVar();       // (each tuft's instance is a plain translation)
    vRoot.assign(root.xz);
    const c = cos(tuft.w), s = sin(tuft.w), p = positionGeometry;
    const xz = vec2(c.mul(p.x).add(s.mul(p.z)), s.negate().mul(p.x).add(c.mul(p.z)));
    const t = vec3(xz.x, p.y, xz.y).mul(tuft.z).toVar();
    const gust = sin(U.uTime.mul(1.7).add(root.x.mul(0.35)).add(root.z.mul(0.2))).mul(0.5).add(sin(U.uTime.mul(3.1).add(root.x.mul(1.3))).mul(0.2));
    t.xz.addAssign(vec2(0.6, 0.35).mul(gust).mul(0.018).mul(tip).mul(tip));
    return root.add(t);
  })();
  mat.colorNode = Fn(() => {
    const g = U.uRect, u = vRoot.sub(g.xy).div(g.zw.sub(g.xy));
    const col = U.uAlb.sample(vRoot.mul(U.uTile)).rgb.mul(U.uTint.sample(vec2(u.x, float(1).sub(u.y))).rgb).mul(2.0);
    return vec4(col.mul(mix(0.7, 1.25, vTip)).mul(vec3(0.97, 1.03, 0.92)), 1.0);
  })();
  mat.normalNode = toView(vec3(0, 1, 0));
  keyed(mat);
}

// ---- packed.js: scanned textures whose normal map holds roughness in blue
export function packedNormal(mat) {
  const nm = materialTexture(mat, 'normalMap');
  const n = normalMap(nm, materialReference('normalScale', 'vec2'));
  n.unpackNormalMode = NormalRGPacking;
  mat.normalNode = n;
  mat.roughnessNode = clamp(materialRoughness.mul(nm.b), 0.04, 1.0);
  keyed(mat);
}

// ---- trees.js sway: the leaves in a breeze, more the higher up the crown
export function treeSway(mat, u, mesh) {
  const T = bind(u.uTime);
  const M = instanceMatrix(mesh);
  mat.positionNode = Fn(() => {
    const p = positionGeometry, ph = M[3].x.mul(0.37).add(M[3].z.mul(0.23));
    const k = clamp(p.y.div(40.0), 0.0, 1.0);
    const d = vec3(k.mul(sin(T.mul(1.3).add(ph).add(p.y.mul(0.05))).mul(0.35).add(sin(T.mul(3.1).add(ph.mul(1.7))).mul(0.15))), 0.0,
      k.mul(0.25).mul(sin(T.mul(1.1).add(ph.mul(0.6)).add(p.x.mul(0.05)))));
    return positionLocal.add(M.mul(vec4(d, 0.0)).xyz);
  })();
  keyed(mat);
}

// ---- trees.js impostor: a far tree's picture, upright and turned to face the camera
export function impostorMaterial(NodeMaterial, map, size, mesh) {
  const m = new NodeMaterial();
  const M = instanceMatrix(mesh), uSize = uniform(size);
  m.positionNode = Fn(() => {
    const base = M[3].xyz, sx = length(M[0].xyz), sy = length(M[1].xyz);
    const to = cameraPosition.sub(base).mul(vec3(1, 0, 1)).add(vec3(1e-4, 0, 0)).normalize();
    const right = vec3(to.z, 0.0, to.x.negate());
    return base.add(right.mul(positionGeometry.x).mul(sx).mul(uSize.x)).add(vec3(0.0, positionGeometry.y.mul(sy).mul(uSize.y), 0.0));
  })();
  const t = texture(map, uv().flipY());          // (a picture drawn by WebGPU is the other way up)
  m.colorNode = vec4(t.rgb.div(max(t.a, 1e-3)), 1.0);
  m.opacityNode = t.a;
  m.alphaTest = 0.5;
  m.fog = true;
  m.uniforms = { map: { value: map }, uSize: uSize };
  return m;
}

// a picture the renderer drew (a render target's), shown on a material the right way up
export function renderedMap(m, tex) {
  m.colorNode = texture(tex, uv().flipY());
  keyed(m);
}

// ---- buildings.js: weathering on the clubhouse walls (dirt splashed up the bottom, faint streaks)
export function wallWeathering(mat) {
  mat.colorNode = Fn(() => {
    const dc = vec4(materialColor).toVar(), u = uv(), hgt = u.y;
    const n = fract(sin(dot(floor(u.mul(vec2(9.0, 3.0))), vec2(12.9898, 78.233))).mul(43758.5453));
    dc.rgb.mulAssign(mix(vec3(0.72, 0.68, 0.6), vec3(1.0), smoothstep(0.0, float(0.55).add(n.mul(0.25)), hgt)));
    dc.rgb.mulAssign(float(1.0).sub(float(0.05).mul(smoothstep(0.6, 1.0, fract(u.x.mul(0.37).add(n.mul(0.3))))).mul(smoothstep(0.5, 3.0, hgt))));
    return dc;
  })();
  keyed(mat);
}

// ---- driver.js VISOR_FX: patterned visors, from the visor's own normal
export function visorFX(m, kind) {
  const vn = normalize(normalGeometry);
  const blend = (a, b) => mix(vec3(...a), vec3(...b), smoothstep(-0.14, 0.2, vn.y));
  const fx = {
    sunset: () => blend([0.3, 0.03, 0.55], [0.98, 0.3, 0.04]),
    ocean: () => blend([0.01, 0.08, 0.5], [0.02, 0.75, 0.7]),
    ember: () => blend([0.8, 0.04, 0.01], [1.0, 0.6, 0.05]),
    winner: () => blend([0.75, 0.5, 0.1], [1.0, 0.95, 0.7]),
    champion: () => { m.emissiveNode = materialEmissive.add(vec3(0.16, 0.1, 0.02)); return blend([0.55, 0.3, 0.04], [1.0, 0.8, 0.25]); },
    holo: () => float(0.72).add(cos(vn.x.mul(1.6).add(vn.y.mul(2.2)).add(vec3(0.0, 0.33, 0.67)).mul(6.283)).mul(0.28)),
    aurora: () => float(0.5).add(cos(vn.x.mul(0.8).add(vn.y.mul(1.1)).add(vec3(0.33, 0.55, 0.8)).mul(6.283)).mul(0.5)).add(vec3(0, 0.15, 0)),
    galaxy: () => {
      const vs = fract(sin(dot(floor(vn.mul(46.0)), vec3(127.1, 311.7, 74.7))).mul(43758.5453));
      m.emissiveNode = materialEmissive.add(vec3(0.2, 0.05, 0.42).mul(float(0.45).add(sin(vn.x.mul(9.0).add(vn.y.mul(7.0))).mul(0.45)))).add(vec3(1.2).mul(step(0.93, vs)));
      return vec3(0.01, 0.01, 0.03);
    },
  }[kind];
  if (!fx) return;
  m.colorNode = fx();
  keyed(m);
}

// ---- paint.js maskShader: paint and livery
const liveryFn = wgslFn(LIVERY, [wgsl(LIVERY_HELPERS)]);
export function paintLivery(m, u, usesMap) {
  const U = {};
  for (const k of Object.keys(u)) U[k] = bind(u[k], k === 'uMask' ? 'texture' : undefined);
  const prev = m.colorNode;
  m.colorNode = Fn(() => {
    const dc = (prev ? vec4(prev) : vec4(materialColor)).toVar();
    const mk = usesMap ? U.uMask.sample(uv()) : vec4(0.0);
    const k = U.uOn.mul(select(U.uHasMask.greaterThan(0.5), mk.r, float(1.0))).toVar();
    const ref = select(U.uRefMap.greaterThan(0.5), max(U.uRef.mul(2.0).mul(mk.g).mul(mk.g), 1e-3), U.uRef);
    If(k.greaterThan(0.0), () => {
      const has = U.uHasMask.greaterThan(0.5);
      const lum = luma(dc.rgb), cl = max(luma(U.uCol), 1e-3);
      const shade = clamp(select(has, lum.div(ref), lum.div(cl)), 0.0, 2.5);
      const base = select(has, U.uCol.mul(shade), dc.rgb);
      const lv = liveryFn({ P: attribute('livPos', 'vec3'), N: attribute('livNrm', 'vec3'), uPat: U.uPat, uDim: U.uDim });
      const c = mix(mix(base, U.uCol2.mul(shade), lv.x), U.uCol3.mul(min(shade, 1.2)), lv.y);
      dc.rgb.assign(mix(dc.rgb, c, k));
    });
    return dc;
  })();
  keyed(m);
}

// ---- suits.js suitShader: the suit's designs, over its paint (paintLivery above, whose mask and uniforms it shares)
const suitFn = wgslFn(SUIT, [wgsl(SUIT_HELPERS)]);
export function suitDesigns(m, u, paintU) {
  const U = { uSD: bind(u.uSD), uS2: bind(u.uS2), uS3: bind(u.uS3) };
  const P = { uOn: bind(paintU.uOn), uMask: bind(paintU.uMask, 'texture'), uRef: bind(paintU.uRef) };
  const prev = m.colorNode, map = materialTexture(m, 'map');
  m.colorNode = Fn(() => {
    const dc = (prev ? vec4(prev) : vec4(materialColor)).toVar();
    If(U.uSD.greaterThan(0.5), () => {
      const k = P.uOn.mul(P.uMask.sample(uv()).r).toVar();
      If(k.greaterThan(0.0), () => {
        const tx = map;
        const shade = clamp(luma(tx.rgb).div(P.uRef), 0.0, 2.5);
        const d = suitFn({ p: attribute('suitP', 'vec3'), n: normalize(attribute('suitN', 'vec3')), l: attribute('suitL', 'vec3'), uSD: U.uSD.add(0.5).toInt() });
        const c = mix(mix(dc.rgb, U.uS2.mul(shade), d.x), U.uS3.mul(min(shade, 1.2)), d.y);
        dc.rgb.assign(mix(dc.rgb, c, k));
      });
    });
    return dc;
  })();
  keyed(m);
}
