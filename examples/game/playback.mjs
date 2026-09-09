import { AnimationClip, AnimationMixer, Group, Quaternion, Vector3 } from 'three';

const ease = t => t * t * t * (t * (t * 6 - 15) + 10);

// Separate the reviewed cycle's net travel from the pelvis performance. Setting
// every X/Z sample to zero also erased hip sway and changed planted-foot motion.
// Measure in Y-up world space: an animated parent can reverse local-axis travel.
// Bake the centered result back through that parent's transform at each key.
export function centerRootMotion(clip, sourceRoot, start = 0, end = null, alignHeading = true) {
  const track = clip.tracks.find(t => t.name === `${sourceRoot.name}.position`);
  const rotation = clip.tracks.find(t => t.name === `${sourceRoot.name}.quaternion`);
  if (!track || !rotation) throw Error('Moving root needs position and rotation tracks.');
  let top = sourceRoot; while (top.parent) top = top.parent;
  const rig = top.clone(true), container = new Group(); container.add(rig);
  const root = rig.getObjectByName(sourceRoot.name), mixer = new AnimationMixer(container);
  // Sampling must remain independent of the track arrays being rewritten.
  const action = mixer.clipAction(clip.clone()); action.play(); action.paused = true;
  const seek = time => { action.time = time; mixer.update(0); container.updateMatrixWorld(true); };
  seek(start);
  const origin = root.getWorldPosition(new Vector3()), delta = new Vector3();
  if (end !== null) { seek(end); root.getWorldPosition(delta).sub(origin); }
  delta.y = 0;
  const heading = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), alignHeading ? -Math.atan2(delta.x, delta.z) : 0);
  const p = new Vector3(), q = new Quaternion();
  for (let i = 0; i < track.times.length; i++) {
    seek(track.times[i]); root.getWorldPosition(p);
    const progress = end === null ? 0 : (track.times[i] - start) / (end - start);
    p.x -= origin.x + progress * delta.x; p.z -= origin.z + progress * delta.z;
    p.applyQuaternion(heading);
    root.parent.worldToLocal(p).toArray(track.values, i * 3);
  }
  const parentInverse = new Quaternion();
  for (let i = 0; i < rotation.times.length; i++) {
    seek(rotation.times[i]);
    root.parent.getWorldQuaternion(parentInverse).invert();
    root.getWorldQuaternion(q).premultiply(heading).premultiply(parentInverse).normalize().toArray(rotation.values, i * 4);
  }
  mixer.stopAllAction(); mixer.uncacheRoot(container);
  return delta.length();
}

/** A reviewed source cycle, with a short symmetric blend across its wrap.
 * Source samples on both sides of the boundary keep the same time derivative.
 * The final key equals the first at duration: there is no extra held frame.
 * This only blends a selected seam; it does not filter the performance or use IK.
 */
export function cycleClip(source, cycle, fps) {
  const { startFrame: start, endFrame: end, blendFrames: width } = cycle;
  if (![start, end, width].every(Number.isInteger) || width < 1 || end - start <= 2 * width
    || start < width || (end + width) / fps > source.duration + 1e-5) throw Error('Cycle needs source samples before and after its blend window.');
  const count = end - start, duration = count / fps;
  const times = Float32Array.from({ length: count + 1 }, (_, i) => i / fps);
  const qa = new Quaternion(), qb = new Quaternion();
  const tracks = source.tracks.map(track => {
    const size = track.getValueSize(), sample = track.createInterpolant();
    const values = new Float32Array((count + 1) * size);
    for (let i = 0; i <= count; i++) {
      const u = i <= width ? i : i >= count - width ? i - count : null;
      let value;
      if (u === null) value = sample.evaluate((start + i) / fps);
      else {
        const a = sample.evaluate((end + u) / fps).slice();
        const b = sample.evaluate((start + u) / fps);
        const weight = ease((u + width) / (2 * width));
        value = track.ValueTypeName === 'quaternion'
          ? qa.fromArray(a).normalize().slerp(qb.fromArray(b).normalize(), weight).toArray()
          : Array.from(a, (v, k) => v + (b[k] - v) * weight);
      }
      values.set(value, i * size);
    }
    values.set(values.subarray(0, size), count * size);
    return new track.constructor(track.name, times, values);
  });
  return new AnimationClip(source.name, duration, tracks);
}

// Normalized replacement layers, not additive arm swing plus a full gesture.
export function splitBodyClip(clip, upperNames) {
  const upper = [], lower = [];
  for (const track of clip.tracks) (upperNames.has(track.name.slice(0, track.name.lastIndexOf('.'))) ? upper : lower).push(track);
  return {
    upper: new AnimationClip(`${clip.name}-upper`, clip.duration, upper),
    lower: new AnimationClip(`${clip.name}-lower`, clip.duration, lower),
  };
}
