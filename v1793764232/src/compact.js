// A still group's pieces as one mesh for each material and kind of geometry,
// for the WebGPU renderer: it spends more of the processor's time on each
// thing drawn than WebGL does, and the clubhouse, the pits with their parked
// karts and the car park are hundreds of small things that never move.
// Left as they are: what's in `keep` (things that change), the see-through
// (sorted back to front), the instanced and the skinned. Returns [before, after].

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function compactStatic(g, keep = []) {
  const kept = new Set(keep.filter(Boolean));
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), buckets = new Map();
  g.traverse((c) => {
    if (!c.isMesh || c.isInstancedMesh || c.isSkinnedMesh || Array.isArray(c.material) || c.material.transparent || c.morphTargetInfluences) return;
    for (let p = c; p && p !== g; p = p.parent) if (kept.has(p) || !p.visible) return;
    const at = c.geometry.attributes;
    const kind = Object.keys(at).sort().map(k => `${k}${at[k].itemSize}`).join(',') + (c.geometry.index ? 'i' : 'n') + (c.castShadow ? 's' : '') + (c.receiveShadow ? 'r' : '');
    const key = c.material.uuid + '|' + kind;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(c);
  });
  let before = 0, after = 0;
  for (const list of buckets.values()) {
    before += list.length;
    if (list.length < 2) { after++; continue; }
    // (each in the group's own frame, its numbers plain floats: glTF's can be packed integers)
    const geos = list.map((c) => {
      const src = c.geometry, out = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(src.attributes)) {
        const f = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) f[i * a.itemSize + j] = a.getComponent(i, j);
        out.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
      }
      if (src.index) out.setIndex(Array.from(src.index.array));
      return out.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld));
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) { after += list.length; continue; }
    const m = new THREE.Mesh(merged, list[0].material);
    m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow; m.name = 'merged';
    g.add(m);
    for (const c of list) c.parent.remove(c);
    after++;
  }
  return [before, after];
}
