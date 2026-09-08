// Engine-independent control and event clocks. Input owns movement; animation
// follows the distance actually traveled, including collision/boundary clamps.
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const approach = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
export const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

export function orbitIntent(x, z, centerZ = 1.1, radius = 2) {
  const dx = x, dz = z - centerZ, distance = Math.hypot(dx, dz);
  const nx = distance > .05 ? dx / distance : 1, nz = distance > .05 ? dz / distance : 0;
  const correction = (radius - distance) * 1.3;
  return { x: -nz + nx * correction, z: nx + nz * correction };
}

export function eventsBetween(events, previous, current, period, loop = false) {
  if (current <= previous || period <= 0) return [];
  const out = [];
  const first = loop ? Math.floor(previous / period) : 0, last = loop ? Math.floor(current / period) : 0;
  for (let cycle = first; cycle <= last; cycle++) for (const event of events) {
    const at = cycle * period + event.seconds;
    if (at > previous && at <= current) out.push(event);
  }
  return out;
}

export function gaitProfile(metadata) {
  const starts = metadata.contacts.left.filter(c => !c.beginsBeforeClip).map(c => c.startSeconds);
  const distance = metadata.strides.left.meanDistanceMeters;
  if (starts.length < 2 || !(distance > 0)) throw Error('Locomotion requires reviewed left-contact cycles and measured stride distance.');
  return { starts, distance, period: metadata.timing.playbackPeriodSeconds };
}

// Integer phase = left contact. Both locomotion clips sample the same foot phase
// while retaining their original within-stride timing and multi-stride variation.
export function timeAtPhase(profile, phase) {
  const count = profile.starts.length;
  const whole = Math.floor(phase), part = phase - whole;
  const cycle = Math.floor(whole / count), index = ((whole % count) + count) % count;
  const a = profile.starts[index], b = index + 1 < count ? profile.starts[index + 1] : profile.starts[0] + profile.period;
  return cycle * profile.period + a + (b - a) * part;
}

export class SignalClock {
  constructor(duration, events) { this.duration = duration; this.events = events.filter(e => e.source === 'authored'); this.time = 0; this.weight = 0; this.active = false; }
  start() {
    if (this.active || this.weight > .01) return false;
    this.active = true; this.time = 0; return true;
  }
  interrupt() { this.active = false; }
  step(dt) {
    const previous = this.time;
    if (this.active) this.time = Math.min(this.duration, this.time + dt);
    const target = this.active ? smooth(this.time / .18) * smooth((this.duration - this.time) / .24) : 0;
    this.weight = this.active ? target : approach(this.weight, 0, 28, dt);
    const events = this.active ? eventsBetween(this.events, previous, this.time, this.duration) : [];
    if (this.time >= this.duration) this.active = false;
    return events;
  }
}

export class MovementController {
  constructor(walk, run, phase = 0) {
    this.walk = walk; this.run = run; this.phase = phase;
    this.speed = 0; this.runBlend = 0; this.movingWeight = 0;
    this.x = 0; this.z = 0; this.vx = 0; this.vz = 0;
  }
  step(dt, intent, bounds = 5.3) {
    const length = Math.hypot(intent.x, intent.z), target = length ? intent.speed : 0;
    const x = length ? intent.x / length * target : 0, z = length ? intent.z / length * target : 0;
    this.vx = approach(this.vx, x, 15, dt); this.vz = approach(this.vz, z, 15, dt);
    const oldX = this.x, oldZ = this.z;
    this.x = clamp(this.x + this.vx * dt, -bounds, bounds); this.z = clamp(this.z + this.vz * dt, -bounds, bounds);
    const distance = Math.hypot(this.x - oldX, this.z - oldZ);
    this.speed = dt > 0 ? distance / dt : 0;
    const targetBlend = clamp((this.speed - intent.walkSpeed) / (intent.runSpeed - intent.walkSpeed), 0, 1);
    this.runBlend = approach(this.runBlend, targetBlend, 12, dt);
    this.movingWeight = approach(this.movingWeight, this.speed > .08 ? 1 : 0, 16, dt);
    const stride = this.walk.distance * (1 - this.runBlend) + this.run.distance * this.runBlend;
    this.phase += distance / stride;
    return { distance, dx: this.x - oldX, dz: this.z - oldZ };
  }
}
