import { Quaternion } from 'three';

// Align anatomical joint frames from an explicitly reviewed retarget reference.
// This is a constant change of basis, not a per-frame pose filter. BVH has no
// rest-rotation field, so names and OFFSETs alone cannot supply this correction.
export function remapJointFrames(clip, avatar, references) {
  const quaternion = values => {
    if (!Array.isArray(values) || values.length !== 4 || !values.every(Number.isFinite)) throw Error('Invalid reference quaternion.');
    const q = new Quaternion().fromArray(values);
    if (Math.abs(q.length() - 1) > 1e-4) throw Error('Reference quaternions must be normalized.');
    return q.normalize();
  };
  const changes = references.map(reference => {
    const bone = avatar.getObjectByName(reference.joint);
    if (!bone?.isBone || bone.quaternion.angleTo(quaternion(reference.nativeLocal)) > .001
      || bone.children.filter(b => b.isBone).map(b => b.name).join() !== reference.children.join()) {
      throw Error(`Rest-frame contract changed at ${reference.joint}; review the character and retarget reference.`);
    }
    const change = quaternion(reference.retargetWorld).invert()
      .multiply(quaternion(reference.sourceAnatomicalWorld))
      .multiply(quaternion(reference.nativeAnatomicalLocal).invert()).normalize();
    return { reference, change };
  });
  // Validate every binding before changing any track; compensate immediate
  // children so the existing world-space arm rotations and twists survive.
  const edits = changes.flatMap(({ reference, change }) => [
    { name: reference.joint, change, left: false },
    ...reference.children.map(name => ({ name, change: change.clone().invert(), left: true })),
  ]).map(edit => {
    const track = clip.tracks.find(t => t.name === `${edit.name}.quaternion`);
    if (!track || track.getValueSize() !== 4) throw Error(`Missing quaternion track for ${edit.name}.`);
    return { ...edit, track };
  });
  if (new Set(edits.map(e => e.name)).size !== edits.length) throw Error('Reference corrections overlap.');
  const q = new Quaternion();
  for (const { track, change, left } of edits) for (let i = 0; i < track.values.length; i += 4) {
    q.fromArray(track.values, i);
    if (left) q.premultiply(change); else q.multiply(change);
    q.normalize().toArray(track.values, i);
  }
  return clip;
}
