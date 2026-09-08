import { BufferAttribute, Matrix4, Quaternion } from 'three';

const decode = (text, Type) => new Type(Uint8Array.from(atob(text), c => c.charCodeAt(0)).buffer);

// Released MHR sparse rotation features → ReLU activations → corrective deltas.
// Evaluate AFTER animation blending, so transitions and interruptions deform
// consistently. Sparse CPU updates avoid thousands of GPU morph texture layers.
export function readMHRCorrectives(data) {
  return { ...data, components: data.components.map(c => ({ ...c, indices: decode(c.indices, Uint16Array), deltas: decode(c.deltas, Float32Array) })) };
}

export function bindMHRCorrectives(avatar, data) {
  const features = new Float64Array(data.bones.length * 6);
  const bones = data.bones.map(b => {
    const bone = avatar.getObjectByName(b.name);
    if (!bone?.isBone) throw Error(`MHR corrective joint missing: ${b.name}`);
    return { bone, restInverse: new Quaternion().fromArray(b.rest).invert(), basis: new Quaternion().fromArray(b.basis).normalize(), basisInverse: new Quaternion().fromArray(b.basis).normalize().invert() };
  });
  const surfaces = new Map();
  avatar.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const original = mesh.geometry.attributes.position;
    if (original.count !== data.vertexCount) throw Error('MHR corrective surface correspondence changed.');
    let surface = surfaces.get(original);
    if (!surface) {
      surface = { base: original.array, position: new BufferAttribute(original.array.slice(), 3) };
      surfaces.set(original, surface);
    }
    mesh.geometry = mesh.geometry.clone(); mesh.geometry.setAttribute('position', surface.position);
  });
  const q = new Quaternion(), matrix = new Matrix4(), weights = new Float64Array(data.components.length);
  return () => {
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i];
      q.copy(b.bone.quaternion).premultiply(b.restInverse).premultiply(b.basisInverse).multiply(b.basis).normalize();
      const e = matrix.makeRotationFromQuaternion(q).elements;
      features.set([e[0] - 1, e[1], e[2], e[4], e[5] - 1, e[6]], i * 6);
    }
    for (let i = 0; i < data.components.length; i++) {
      let value = 0; for (const [index, coefficient] of data.components[i].features) value += features[index] * coefficient;
      weights[i] = Math.max(0, value);
    }
    for (const surface of surfaces.values()) {
      const positions = surface.position.array; positions.set(surface.base);
      for (let i = 0; i < weights.length; i++) {
        const weight = weights[i]; if (!weight) continue;
        const { indices, deltas } = data.components[i];
        for (let v = 0; v < indices.length; v++) {
          const at = indices[v] * 3, from = v * 3;
          positions[at] += weight * deltas[from]; positions[at + 1] += weight * deltas[from + 1]; positions[at + 2] += weight * deltas[from + 2];
        }
      }
      surface.position.needsUpdate = true;
    }
    return weights;
  };
}
