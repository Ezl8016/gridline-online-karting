// post.js for the WebGPU renderer: the same finish (bloom down and back up a
// chain of half-size images, ambient occlusion from the depth at half size,
// film tone mapping, the grade, the vignette and a whisper of noise), the
// same sums, as node materials drawn on a full-screen quad.

import { afterWarm } from '../gl.js';
import { RenderTarget, DepthTexture, HalfFloatType, FloatType, LinearFilter, LinearSRGBColorSpace, NoToneMapping, AdditiveBlending,
  NodeMaterial, QuadMesh, Vector2, Matrix4 } from 'three/webgpu';
import { Fn, vec2, vec3, vec4, float, uniform, texture, uv, screenCoordinate, select, getViewPosition, getScreenPosition,
  smoothstep, mix, clamp, fract, sin, cos, sqrt, abs, max, min, dot, length, normalize, cross, step, sRGBTransferOETF } from 'three/tsl';

const LUMA = vec3(0.2126, 0.7152, 0.0722);
const hash = (p) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));
const mat = (colorNode, extra = {}) => Object.assign(new NodeMaterial(), { colorNode, depthTest: false, depthWrite: false, fog: false, toneMapped: false }, extra);
// GLSL mat3(c0, c1, c2) * v
const m3 = (c0, c1, c2, v) => vec3(...c0).mul(v.x).add(vec3(...c1).mul(v.y)).add(vec3(...c2).mul(v.z));
const filmTone = (c0) => {
  const v = m3([0.59719, 0.07600, 0.02840], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777], c0.div(0.6));
  const a = v.mul(v.add(0.0245786)).sub(0.000090537), b = v.mul(v.mul(0.983729).add(0.4329510)).add(0.238081);
  return clamp(m3([1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602], a.div(b)), 0.0, 1.0);
};

export class Post {
  constructor(renderer) {
    this.r = renderer;
    this.on = true;
    this.bloomOn = true;
    this.aoOn = true;
    this.samples = 4; this.levels = 5;
    this.quad = new QuadMesh();
    this.target = null; this.mips = []; this.mats = [];
    this.u = { exposure: uniform(1), threshold: uniform(1.0), bloom: uniform(0.14), vignette: uniform(0.3), sat: uniform(1.1), time: uniform(0),
      res: uniform(new Vector2(1, 1)), ao: uniform(0.85), contrast: uniform(0.35), radius: uniform(0.7),
      proj: uniform(new Matrix4()), invProj: uniform(new Matrix4()) };
  }

  setQuality(q) {
    this.on = q !== 'low' && q !== 'performance';
    this.samples = q === 'high' ? 4 : 2;
    this.aoOn = q === 'high';
    this.levels = q === 'high' ? 5 : 4;
    this.dispose();
  }

  dispose() {
    // (after any warm-up that's using them: its shaders for a thrown-away target fail)
    const old = [this.target, this.aoTarget, ...this.mips, ...this.mats];
    afterWarm(() => { for (const x of old) x?.dispose(); });
    this.target = null; this.aoTarget = null; this.mips = []; this.mats = [];
  }

  // downsample with a 13-tap filter, the first pass keeping only the bright parts
  down(src, w, h, first) {
    const U = this.u, texel = vec2(1 / w, 1 / h);
    // (a broken pixel, NaN or infinite, counts as black: blurred, one would spread over the whole screen)
    const s = (x, y) => { const c = texture(src, uv().add(vec2(x, y).mul(texel))).rgb; return select(c.r.add(c.g).add(c.b).lessThan(1e5), c, vec3(0.0)); };
    const node = Fn(() => {
      const c = s(0, 0).mul(0.125).toVar();
      c.addAssign(s(-1, -1).add(s(1, -1)).add(s(-1, 1)).add(s(1, 1)).mul(0.125));
      c.addAssign(s(-2, -2).add(s(2, -2)).add(s(-2, 2)).add(s(2, 2)).mul(0.03125));
      c.addAssign(s(-2, 0).add(s(2, 0)).add(s(0, -2)).add(s(0, 2)).mul(0.0625));
      if (first) {
        c.mulAssign(U.exposure);
        const l = max(c.r, max(c.g, c.b));
        c.mulAssign(max(0.0, l.sub(U.threshold)).div(max(l, 1e-4)));
        c.assign(min(c, vec3(40.0)));
      }
      return vec4(c, 1.0);
    })();
    return mat(node);
  }

  // upsample with a tent filter, added onto the next size up
  up(src, w, h) {
    const d = vec2(1 / w, 1 / h), t = (x, y) => texture(src, uv().add(vec2(x, y).mul(d))).rgb;
    const c = t(0, 0).mul(4.0).add(t(1, 0).add(t(-1, 0)).add(t(0, 1)).add(t(0, -1)).mul(2.0)).add(t(1, 1)).add(t(-1, -1)).add(t(1, -1)).add(t(-1, 1));
    return mat(vec4(c.div(16.0), 1.0), { blending: AdditiveBlending, transparent: true });
  }

  // ambient occlusion: points round each pixel in the half-sphere above its
  // surface; the more of them are inside something, the darker
  occlusion(depthTex, w, h) {
    const U = this.u, texel = vec2(1 / w, 1 / h);
    const depthAt = (q) => texture(depthTex, q).x;
    const viewAt = (q) => getViewPosition(q, depthAt(q), U.invProj);
    const node = Fn(() => {
      const q = uv(), d = depthAt(q);
      const P = viewAt(q).toVar();
      const N = normalize(cross(viewAt(q.add(vec2(texel.x, 0.0))).sub(P), viewAt(q.add(vec2(0.0, texel.y))).sub(P))).toVar();
      N.assign(select(dot(N, P).greaterThan(0.0), N.negate(), N));
      const fade = float(1.0).sub(smoothstep(40.0, 80.0, P.z.negate()));
      const fc = screenCoordinate.xy, a0 = hash(fc).mul(6.2831853);
      const T = normalize(select(abs(N.y).lessThan(0.9), cross(N, vec3(0, 1, 0)), cross(N, vec3(1, 0, 0)))).toVar(), B = cross(N, T).toVar();
      const occ = float(0.0).toVar();
      const K = 12;
      for (let i = 0; i < K; i++) {
        const r = U.radius.mul(float(0.25).add(fract(hash(fc.add(i)).add(i * 0.618)).mul(0.75)));
        const a = a0.add(i * 2.3999632), ht = 0.15 + 0.85 * ((i * 0.381966) % 1), sq = Math.sqrt(1 - ht * ht);
        const S = P.add(T.mul(cos(a).mul(sq)).add(B.mul(sin(a).mul(sq))).add(N.mul(ht)).mul(r));
        const su = getScreenPosition(S, U.proj);
        const inside = step(0.0, su.x).mul(step(0.0, su.y)).mul(step(su.x, 1.0)).mul(step(su.y, 1.0));
        const sz = viewAt(clamp(su, 0.0, 1.0)).z;
        const range = smoothstep(0.0, 1.0, U.radius.div(max(abs(P.z.sub(sz)), 1e-3)));
        occ.addAssign(step(S.z.add(0.02), sz).mul(range).mul(inside));
      }
      const ao = float(1.0).sub(occ.div(K).mul(max(fade, 0.0)));
      const sky = this.r.reversedDepthBuffer ? d.lessThanEqual(0.00001) : d.greaterThanEqual(0.99999);
      return vec4(vec3(select(sky, float(1.0), ao)), 1.0);
    })();
    return mat(node);
  }

  // the scene and its bloom, tone-mapped, graded, to the screen
  finish(sceneTex, bloomTex, aoTex, aw, ah) {
    const U = this.u;
    const node = Fn(() => {
      const q = uv();
      const c = texture(sceneTex, q).rgb.mul(U.exposure).toVar();
      if (aoTex) {
        const ao = float(0.0).toVar();
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) ao.addAssign(texture(aoTex, q.add(vec2(i * 1.5 / aw, j * 1.5 / ah))).r);
        c.mulAssign(mix(1.0, ao.div(9.0), U.ao));
      }
      c.addAssign(texture(bloomTex, q).rgb.mul(U.bloom));
      c.assign(filmTone(c));
      c.assign(mix(c, c.mul(c).mul(vec3(3.0).sub(c.mul(2.0))), U.contrast));
      const l = dot(c, LUMA).toVar();
      c.assign(mix(vec3(l), c, U.sat));
      const green = clamp(c.g.sub(max(c.r, c.b)).mul(4.0), 0.0, 1.0);
      c.assign(mix(c, mix(vec3(l), c, 0.78).mul(vec3(1.02, 0.97, 0.9)), green.mul(0.6)));
      c.mulAssign(mix(vec3(0.995, 0.995, 1.005), vec3(1.04, 1.0, 0.95), smoothstep(0.12, 0.65, l)));
      const v = q.sub(0.5), vq = vec2(v.x.mul(U.res.x.div(U.res.y)), v.y);
      c.mulAssign(float(1.0).sub(U.vignette.mul(smoothstep(0.35, 1.05, length(vq)))));
      const o = sRGBTransferOETF(clamp(c, 0.0, 1.0)).add(hash(screenCoordinate.xy.add(U.time)).sub(0.5).div(255.0));
      return vec4(o, 1.0);
    })();
    return mat(node);
  }

  ensure() {
    const s = this.r.getDrawingBufferSize(new Vector2());
    if (this.target && this.target.width === s.x && this.target.height === s.y) return s;
    this.dispose();
    const opt = { type: HalfFloatType, colorSpace: LinearSRGBColorSpace, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false };
    this.target = new RenderTarget(s.x, s.y, { type: HalfFloatType, samples: this.samples });
    this.target.depthTexture = new DepthTexture(s.x, s.y, FloatType);
    this.aoTarget = new RenderTarget(Math.max(1, s.x >> 1), Math.max(1, s.y >> 1), opt);
    let w = s.x, h = s.y;
    for (let i = 0; i < this.levels; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      this.mips.push(new RenderTarget(w, h, opt));
    }
    // the passes, each with its own images
    let src = this.target.texture, sw = s.x, sh = s.y;
    this.downs = this.mips.map((m, i) => { const d = this.down(src, sw, sh, i === 0); src = m.texture; sw = m.width; sh = m.height; return d; });
    this.ups = this.mips.map((m, i) => (i > 0 ? this.up(m.texture, m.width, m.height) : null));
    const aw = this.aoTarget.width, ah = this.aoTarget.height;
    this.aoMat = this.aoOn ? this.occlusion(this.target.depthTexture, aw, ah) : null;
    this.finalMat = this.finish(this.target.texture, this.mips[0].texture, this.aoOn ? this.aoTarget.texture : null, aw, ah);
    this.mats = [...this.downs, ...this.ups.filter(Boolean), this.aoMat, this.finalMat].filter(Boolean);
    return s;
  }

  pass(m, target) {
    this.quad.material = m;
    this.r.setRenderTarget(target);
    this.quad.render(this.r);
  }

  render(scene, camera, time = 0) {
    const r = this.r;
    if (!this.on) { r.setRenderTarget(null); r.render(scene, camera); return; }
    const s = this.ensure(), auto = r.autoClear;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    this.u.exposure.value = r.toneMappingExposure;
    for (let i = 0; i < this.mips.length; i++) this.pass(this.downs[i], this.mips[i]);
    r.autoClear = false;
    for (let i = this.mips.length - 1; i > 0; i--) this.pass(this.ups[i], this.mips[i - 1]);
    r.autoClear = auto;
    if (this.aoOn) {
      this.u.proj.value.copy(camera.projectionMatrix); this.u.invProj.value.copy(camera.projectionMatrixInverse);
      this.pass(this.aoMat, this.aoTarget);
    }
    this.u.time.value = time % 1000; this.u.res.value.set(s.x, s.y);
    // (straight to the screen: its own tone mapping and sRGB, so none from the renderer, and no extra copy of the picture)
    const tm = r.toneMapping, cs = r.outputColorSpace;
    r.toneMapping = NoToneMapping; r.outputColorSpace = LinearSRGBColorSpace;
    this.pass(this.finalMat, null);
    r.toneMapping = tm; r.outputColorSpace = cs;
  }
}
