// Small helpers for the WebGPU (node) materials.

import { DataTexture, InstancedInterleavedBuffer } from 'three/webgpu';
import { uniform, texture, buffer, instanceIndex, instancedDynamicBufferAttribute, mat4 } from 'three/tsl';

// A GLSL-style uniform ({ value }) as a node. The object's .value then reads
// and writes the node's, so code that sets `u.value` (or keeps hold of `u`)
// carries on working unchanged. kind 'texture' for a texture that may still be null.
const nodes = new WeakMap();
const BLANK = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); BLANK.needsUpdate = true;
export function bind(u, kind) {
  if (!u) return u;
  if (u.isNode) return u;
  let n = nodes.get(u);
  if (n) return n;
  const v = u.value;
  n = kind === 'texture' || v?.isTexture ? texture(v || BLANK) : uniform(v);
  Object.defineProperty(u, 'value', { get: () => n.value, set: (x) => { n.value = x || (n.isTextureNode ? BLANK : x); }, configurable: true, enumerable: true });
  nodes.set(u, n);
  return n;
}

// an InstancedMesh's own matrix for the instance being drawn (three applies
// it before a positionNode runs; this is for positions that need it themselves)
export function instanceMatrix(mesh) {
  const m = mesh.instanceMatrix, n = Math.max(m.count, 1);
  if (n * 64 <= 65536) return buffer(m.array, 'mat4', n).element(instanceIndex);
  const ib = new InstancedInterleavedBuffer(m.array, 16, 1);
  const prev = mesh.onBeforeRender;
  mesh.onBeforeRender = (...a) => { if (ib.version !== m.version) ib.version = m.version; prev?.apply(mesh, a); };
  return mat4(...[0, 4, 8, 12].map(o => instancedDynamicBufferAttribute(ib, 'vec4', 16, o)));
}

// a texture node for one of a material's textures (m[prop]) that follows it
// when it's swapped (materialReference would read the shadow pass's own
// material there, which has none)
export function materialTexture(m, prop) {
  let cur = m[prop];
  const n = texture(cur || BLANK);
  Object.defineProperty(m, prop, { get: () => cur, set: (t) => { cur = t; n.value = t || BLANK; }, configurable: true, enumerable: true });
  return n;
}

// A plain three.js material given nodes (colorNode and the rest) needs a
// cache key from them: three keys it by its ordinary settings only, so two
// such materials alike in those would share one compiled shader, and with it
// the first one's uniforms (every kart in the first kart's paint).
const SLOTS = ['colorNode', 'normalNode', 'roughnessNode', 'metalnessNode', 'emissiveNode', 'opacityNode', 'positionNode'];
export function keyed(m) {
  m.customProgramCacheKey = function () { return SLOTS.map(k => (this[k] ? this[k].getCacheKey() : '-')).join(','); };
  m.needsUpdate = true;
  return m;
}

export const LUMA = [0.2126, 0.7152, 0.0722];
