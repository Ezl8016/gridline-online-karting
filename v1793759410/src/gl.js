// A WebGL renderer, or the reason there can't be one. Asks again with less
// (no antialiasing, then whatever graphics chip it likes): a browser short of
// graphics memory, or on a chip it's wary of, can still say yes to that.

import * as THREE from 'three';

// NODE: drawing through three.js's WebGPU renderer, whose materials are built
// from nodes (three/tsl) rather than GLSL. Chosen once, before anything is
// built (initGraphics): the one picked in Settings (ENGINE, kept on the
// device; ?gl=webgpu or ?gl=webgl for one visit), else WebGPU in Chrome or
// Edge on a computer (as fast as WebGL there, faster at night) and WebGL
// elsewhere: in Safari its WebGPU was still the slower in testing, and it's
// not yet tried on a phone. Without WebGPU, or if it won't start, the WebGL
// renderer and the GLSL shaders.
// (Firefox's WebGPU checks a shader rule three.js turns off everywhere else, which src/gpu relies on)
export const ENGINE = 'gridline.engine';
const chromium = () => !!navigator.userAgentData?.brands?.some(b => /Chromium/.test(b.brand));
const phone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
export const webgpuPossible = () => !!navigator.gpu && !/Firefox/.test(navigator.userAgent);
export let NODE = false;
let GPU = null, NODES = null;      // three/webgpu and src/gpu, once loaded
export async function initGraphics() {
  let want = new URLSearchParams(location.search).get('gl');
  if (!want) try { want = localStorage.getItem(ENGINE); } catch { /* private mode */ }
  if (!want) want = !phone() && chromium() ? 'webgpu' : 'webgl';
  if (want !== 'webgpu' || !webgpuPossible()) return NODE;
  try {
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!a) return NODE;
    [GPU, NODES] = await Promise.all([import('three/webgpu'), import('./gpu/index.js')]);
    NODE = true;
  } catch (e) { console.warn('WebGPU unavailable, using WebGL', e); }
  return NODE;
}
// the node versions of the game's shaders (src/gpu), when NODE
export const gpu = () => NODES;

// a renderer of the chosen kind (the WebGPU one has to start up first)
// (if the first WebGPU renderer won't start, everything falls back to WebGL: nothing has been built for WebGPU yet)
let made = 0;
export async function makeRendererAsync(opts) {
  if (!NODE) return makeRenderer(opts);
  const { preserveDrawingBuffer, ...o } = opts;
  let r;
  try {
    r = new GPU.WebGPURenderer(o);
    await r.init();
    if (!r.backend.isWebGPUBackend) throw new Error('fell back to WebGL');
  } catch (e) {
    if (made) throw e;
    console.warn('WebGPU renderer would not start, using WebGL', e);
    r?.dispose?.();
    NODE = false;
    return makeRenderer(opts);
  }
  made++;
  // a lost device: say so the way WebGL does, for watchGraphics
  r.backend.device.lost.then((info) => { if (info.reason === 'destroyed') return; r.__lost = true; console.warn('WebGPU device lost', info.reason, info.message); r.domElement.dispatchEvent(new Event('webglcontextlost')); });
  return r;
}

// WebGPU: a thing's shaders made in the background before it's first drawn.
// Otherwise the first frame to show it stops while they're made: the first
// race on a device, everything at once, ten seconds or more. Into the target
// the scene is really drawn into (target(): the finish's picture, or null),
// and everything, not only what the camera sees.
let warmCtx = null;
export function setWarm(renderer, scene, camera, target) { if (renderer.isWebGPURenderer) warmCtx = { renderer, scene, camera, target }; }
export async function warm(obj) {
  if (!warmCtx) return;
  const { renderer: r, scene, camera, target } = warmCtx, culled = [];
  obj.traverse((o) => { if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
  const prev = r.getRenderTarget();
  let job;
  try {
    r.setRenderTarget(target());
    job = r.compileAsync(obj, camera, scene);       // (it picks what to make straight away, then waits)
  } finally {
    r.setRenderTarget(prev);
    for (const o of culled) o.frustumCulled = true;
  }
  try { await job; } catch (e) { console.warn('warm', e); }
}

// an environment map from a scene, for either renderer
export function pmremFrom(renderer, scene, blur = 0.02) {
  const pm = renderer.isWebGPURenderer ? new NODES.PMREMGenerator(renderer) : new THREE.PMREMGenerator(renderer);
  const t = pm.fromScene(scene, blur).texture;
  pm.dispose();
  return t;
}
// a render target for either renderer
export const renderTarget = (w, h, o) => (NODE ? new NODES.RenderTarget(w, h, o) : new THREE.WebGLRenderTarget(w, h, o));

// the graphics have been taken away (WebGL's context lost; WebGPU has its own way of saying so)
export const contextLost = (r) => (r.isWebGPURenderer ? !!r.__lost : r.getContext().isContextLost());

export function makeRenderer(opts) {
  let why = null;
  for (const o of [opts, { ...opts, antialias: false }, { ...opts, antialias: false, powerPreference: 'default' }]) {
    try { return new THREE.WebGLRenderer(o); } catch (e) { why = e; }
  }
  throw why;
}

// nothing can be drawn: say so, and what to try
export function graphicsFailed() {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:16px;background:#14151a;color:#f4f3f0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;text-align:center';
  box.innerHTML = `<div style="max-width:460px"><h1 style="font:italic 900 24px/1.2 'Arial Black',Arial,sans-serif;margin:0 0 12px">THE GRAPHICS COULDN'T START</h1>
    <p>Your browser wouldn't let the game use the computer's graphics chip. It's usually temporary.</p>
    <p>Try these in order: reload, fully quit and reopen the app or browser, then restart the computer. In Chrome or Edge, also check that
    "Use graphics acceleration" is on in Settings, under System.</p>
    <button style="margin-top:8px;padding:12px 26px;border:0;border-radius:4px;background:#d42a2a;color:#fff;font:italic 900 14px/1 'Arial Black',Arial,sans-serif;cursor:pointer">RELOAD</button></div>`;
  box.querySelector('button').onclick = () => location.reload();
  document.body.appendChild(box);
}

// The graphics chip can drop the game at any time (the browser restarts its
// graphics when they crash). Until it's back the picture is blank white, and
// what was drawn only once (reflections, the far trees) doesn't come back with
// it. keep(): carry on in place (mid-race) rather than reload. restored(): put
// back what can be. stepDown(): crashing again and again, so ask less of it.
const LOST = 'gridline.glLost', WINDOW = 5 * 60e3, WAIT = 5000;
export function watchGraphics(canvas, { keep, restored, stepDown }) {
  let cover = null, giveUp = 0;
  const hide = () => { cover?.remove(); cover = null; clearTimeout(giveUp); };
  const recent = () => {
    let t = [];
    try { t = JSON.parse(sessionStorage.getItem(LOST)) || []; } catch { /* first time */ }
    t = t.filter(x => Date.now() - x < WINDOW).concat(Date.now());
    try { sessionStorage.setItem(LOST, JSON.stringify(t)); } catch { /* private mode */ }
    return t.length;
  };
  const reload = (n) => {
    if (n >= 4) { hide(); graphicsFailed(); return; }
    location.reload();
  };
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();                // (asks for it back)
    const n = recent();
    if (n >= 2) stepDown();
    if (!cover) {
      cover = document.createElement('div');
      cover.style.cssText = 'position:fixed;inset:0;z-index:99998;display:grid;place-items:center;background:#14151a;color:#f4f3f0;font:italic 900 22px/1.2 "Arial Black",Arial,sans-serif';
      cover.textContent = 'GRAPHICS RESTARTING…';
      document.body.appendChild(cover);
    }
    clearTimeout(giveUp);
    giveUp = setTimeout(() => reload(n), WAIT);    // (it didn't come back by itself)
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (!keep()) { reload(0); return; }
    hide();
    restored();
  });
}
