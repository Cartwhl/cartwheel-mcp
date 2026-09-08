import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { MovementController, SignalClock, gaitProfile, timeAtPhase, orbitIntent, clamp } from './controller.mjs';

const $ = id => document.getElementById(id);
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#142d28');
scene.fog = new THREE.Fog('#142d28', 14, 30);
const camera = new THREE.PerspectiveCamera(35, 1, .05, 100);
camera.position.set(5.8, 4.8, 8.4);
const orbit = new OrbitControls(camera, canvas);
orbit.target.set(0, .65, .1);
orbit.enableDamping = true; orbit.maxPolarAngle = Math.PI * .46;
orbit.minDistance = 5; orbit.maxDistance = 22; orbit.enablePan = false;
const hemi = new THREE.HemisphereLight('#e2ffe7', '#51615f', 2.3); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff5d3', 3.4);
sun.position.set(-4, 10, 5); sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: .5, far: 30 });
sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = .018; sun.shadow.bias = -.0001;
scene.add(sun);
const rim = new THREE.DirectionalLight('#9ce6de', 2); rim.position.set(5, 4, -7); scene.add(rim);

const standard = (color, roughness = .8) => new THREE.MeshStandardMaterial({ color, roughness });
const materials = { floor: standard('#28473b'), edge: standard('#365f49'), dark: standard('#203e33'), mint: standard('#c3d7a7'), peach: standard('#d99870'), stripe: standard('#68846a') };
function mesh(geometry, material, position, receive = true) {
  const object = new THREE.Mesh(geometry, material); object.position.set(...position); object.receiveShadow = receive; scene.add(object); return object;
}
mesh(new THREE.BoxGeometry(13.2, .36, 12.4), materials.edge, [0, -.22, -1]);
mesh(new THREE.PlaneGeometry(13, 12.2), materials.floor, [0, -.032, -1]).rotation.x = -Math.PI / 2;
mesh(new THREE.PlaneGeometry(200, 200), materials.dark, [0, -.43, 0]).rotation.x = -Math.PI / 2;
const grid = new THREE.GridHelper(12, 24, '#537158', '#3b5746'); grid.position.set(0, -.02, -1); grid.material.transparent = true; grid.material.opacity = .4; scene.add(grid);
function ring(x, z, radius, material, width = .025) {
  const r = mesh(new THREE.RingGeometry(radius - width, radius, 96), material, [x, -.018, z]); r.rotation.x = -Math.PI / 2; return r;
}
ring(0, 1.1, 2.65, materials.stripe); ring(0, 1.1, 2.72, materials.stripe, .008);
for (let i = 0; i < 5; i++) {
  const x = -5.7 + i * 2.85;
  const plinth = mesh(new THREE.CylinderGeometry(.47, .52, .45, 40), materials.dark, [x, .17, -6.35]); plinth.castShadow = true;
  const crown = mesh(new THREE.IcosahedronGeometry(.48, 1), i % 2 ? materials.peach : materials.mint, [x, .76, -6.35]); crown.scale.set(.8, 1.2, .8); crown.castShadow = true;
}
for (const x of [-6.15, 6.15]) for (const z of [-5.5, -3, -.5, 2, 4.5]) {
  const marker = mesh(new THREE.BoxGeometry(.075, .015, .42), materials.mint, [x, -.011, z]); marker.material = materials.mint;
}

const effects = [];
const effectGeometry = new THREE.RingGeometry(.065, .087, 28);
function effectAt(position, signal = false) {
  const material = new THREE.MeshBasicMaterial({ color: signal ? '#ffd88c' : '#bbf29c', transparent: true, opacity: .85, depthWrite: false, side: THREE.DoubleSide });
  const effect = new THREE.Mesh(effectGeometry, material);
  effect.position.copy(position); if (!signal) { effect.position.y = .006; effect.rotation.x = -Math.PI / 2; }
  else effect.quaternion.copy(camera.quaternion);
  scene.add(effect); effects.push({ mesh: effect, age: 0, duration: signal ? .85 : .5, signal });
}
const keys = new Set(); let mode = 'idle', touchIntent = null, enabled = false;
function setMode(value) {
  mode = value; document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === value));
}
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
window.addEventListener('keydown', e => {
  if ($('source-dialog').open || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(e.code)) { e.preventDefault(); keys.add(e.code); setMode('manual'); }
  if (e.code === 'KeyE' && !e.repeat) player?.signal.start();
  if (e.code === 'Escape') player?.signal.interrupt();
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); touchIntent = null; });
document.querySelectorAll('[data-move]').forEach(b => {
  b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); touchIntent = b.dataset.move.split(',').map(Number); setMode('manual'); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(event, () => { touchIntent = null; });
});
$('crowd').addEventListener('input', () => { $('crowd-value').textContent = $('crowd').value; });
$('details').addEventListener('click', () => $('source-dialog').showModal());
$('close-details').addEventListener('click', () => $('source-dialog').close());
$('source-dialog').addEventListener('click', e => { if (e.target === $('source-dialog')) $('source-dialog').close(); });

let player, actors = [], clips, metadata, profiles, model;
const modulo = (n, d) => ((n % d) + d) % d;
const v = new THREE.Vector3(), q = new THREE.Quaternion();

async function loadClip(name) {
  const [text, m] = await Promise.all([fetch(`assets/${name}.bvh`).then(r => r.text()), fetch(`assets/${name}.motion.json`).then(r => r.json())]);
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (sha !== m.preparation.outputSha256 || m.preparation.positionConvention !== 'offset_relative' || m.source.units !== 'meters' || m.source.upAxis !== 'Y') throw Error(`Clip ${name} does not match its prepared metadata or this reference’s coordinate contract.`);
  const bvh = new BVHLoader().parse(text);
  const rootName = m.skeleton.rootJoint, root = model.getObjectByName(rootName);
  if (!root?.isBone) throw Error(`Character has no ${rootName} bone.`);
  // Same names alone are insufficient: validate the native rest offsets too.
  for (const bone of bvh.skeleton.bones.filter(b => b.name !== 'ENDSITE')) {
    const target = model.getObjectByName(bone.name);
    if (!target?.isBone) throw Error(`Character is missing joint ${bone.name}.`);
    if (bone !== bvh.skeleton.bones[0] && target.position.distanceTo(bone.position) > .0001) throw Error(`Rest offset mismatch at ${bone.name}; retarget to this character before playback.`);
  }
  model.updateMatrixWorld(true);
  const parentInverse = root.parent.matrixWorld.clone().invert();
  const parentRotationInverse = root.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  for (const track of bvh.clip.tracks) {
    if (track.name === `${rootName}.position`) for (let i = 0; i < track.values.length; i += 3) {
      v.fromArray(track.values, i); v.x = 0; v.z = 0; // origin for this in-place controller
      v.applyMatrix4(parentInverse).toArray(track.values, i);
    }
    if (track.name === `${rootName}.quaternion`) for (let i = 0; i < track.values.length; i += 4) {
      q.fromArray(track.values, i).premultiply(parentRotationInverse).normalize().toArray(track.values, i);
    }
  }
  bvh.clip.name = name;
  bvh.clip.duration = m.timing.playbackPeriodSeconds;
  return { clip: bvh.clip, metadata: m };
}

function makeActor(index) {
  const avatar = clone(model), group = new THREE.Group(); group.add(avatar); scene.add(group);
  const mixer = new THREE.AnimationMixer(avatar);
  const actions = Object.fromEntries(Object.entries(clips).map(([name, clip]) => {
    const action = mixer.clipAction(clip); action.play(); action.paused = true; action.setEffectiveWeight(0); return [name, action];
  }));
  const controller = new MovementController(profiles.walk, profiles.run, index * .57);
  if (index) { controller.x = -4.5 + ((index - 1) % 4) * 3; controller.z = -2.6 - Math.floor((index - 1) / 4) * 2.7; }
  else controller.z = 1.1;
  const signal = new SignalClock(clips.signal.duration, metadata.signal.events);
  const bones = Object.fromEntries(['left_ankle', 'right_ankle', 'right_wrist'].map(n => [n, avatar.getObjectByName(n)]));
  const actor = { group, avatar, mixer, actions, controller, signal, bones, contact: { left: false, right: false }, index, idleClock: index * .7, yaw: Math.PI * .1, phaseTimes: {}, contacts: {} };
  return actor;
}

function actorStep(actor, dt, intent) {
  const c = actor.controller, movement = c.step(dt, intent);
  actor.group.position.set(c.x, 0, c.z);
  if (movement.distance > .00001) {
    const desired = Math.atan2(movement.dx, movement.dz);
    const delta = Math.atan2(Math.sin(desired - actor.yaw), Math.cos(desired - actor.yaw));
    actor.yaw += delta * (1 - Math.exp(-18 * dt));
  }
  actor.group.rotation.y = actor.yaw;
  actor.idleClock += dt;
  actor.actions.idle.time = modulo(actor.idleClock, clips.idle.duration);
  actor.actions.idle.setEffectiveWeight(1 - c.movingWeight);
  for (const name of ['walk', 'run']) {
    const time = timeAtPhase(profiles[name], c.phase);
    actor.phaseTimes[name] = modulo(time, clips[name].duration);
    actor.actions[name].time = actor.phaseTimes[name];
    actor.actions[name].setEffectiveWeight(c.movingWeight * (name === 'run' ? c.runBlend : 1 - c.runBlend));
  }
  const emitted = actor.signal.step(dt);
  actor.actions.signal.time = Math.min(actor.signal.time, clips.signal.duration - 1e-5);
  actor.actions.signal.setEffectiveWeight(actor.signal.weight);
  actor.mixer.update(dt);
  actor.group.updateMatrixWorld(true);
  const dominant = c.movingWeight < .5 ? 'idle' : c.runBlend > .5 ? 'run' : 'walk';
  const time = dominant === 'idle' ? actor.actions.idle.time : actor.phaseTimes[dominant];
  for (const side of ['left', 'right']) {
    const contact = metadata[dominant].contacts[side].some(interval => time >= interval.startSeconds && time < interval.endSeconds);
    if (!actor.index && c.speed > .1 && contact && !actor.contact[side] && $('contacts').checked) {
      effectAt(actor.bones[`${side}_ankle`].getWorldPosition(new THREE.Vector3()));
      $('event').textContent = `${side} foot`;
    }
    actor.contact[side] = contact;
  }
  for (const event of emitted) if (event.name === 'signal') {
    effectAt(actor.bones.right_wrist.getWorldPosition(new THREE.Vector3()), true);
    if (!actor.index) $('event').textContent = 'signal · authored';
  }
  if (!actor.index) {
    $('speed').textContent = c.speed.toFixed(2);
    $('speed-bar').style.width = `${clamp(c.speed / intent.runSpeed, 0, 1) * 100}%`;
    $('state').textContent = c.movingWeight < .5 ? 'IDLE' : c.runBlend > .5 ? 'RUNNING' : 'WALKING';
    $('layer').textContent = actor.signal.active ? 'Signaling' : actor.signal.weight > .01 ? 'Interrupted' : 'Ready';
    for (const side of ['left', 'right']) $(`${side}-foot`).classList.toggle('on', actor.contact[side]);
  }
}

async function initialize() {
  const gltf = await new GLTFLoader().loadAsync('assets/character.glb'); model = gltf.scene;
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; } });
  const loaded = Object.fromEntries(await Promise.all(['idle', 'walk', 'run', 'signal'].map(async name => [name, await loadClip(name)])));
  metadata = Object.fromEntries(Object.entries(loaded).map(([name, value]) => [name, value.metadata]));
  if (new Set(Object.values(metadata).map(m => m.skeleton.id)).size !== 1) throw Error('The clips do not share a skeleton identity.');
  clips = Object.fromEntries(Object.entries(loaded).map(([name, value]) => [name, value.clip]));
  profiles = { walk: gaitProfile(metadata.walk), run: gaitProfile(metadata.run) };
  const upperNames = new Set(); model.getObjectByName('spine3').traverse(o => { if (o.isBone) upperNames.add(o.name); });
  const additive = clips.signal.clone();
  THREE.AnimationUtils.makeClipAdditive(additive, 0, clips.signal, metadata.signal.timing.fps);
  additive.tracks = additive.tracks.filter(t => t.name.endsWith('.quaternion') && upperNames.has(t.name.slice(0, -11)));
  if (!additive.tracks.length) throw Error('The upper-body mask contains no rotation tracks.');
  clips.signal = additive;
  actors = Array.from({ length: 9 }, (_, i) => makeActor(i)); player = actors[0];
  $('signal').addEventListener('click', () => player.signal.start());
  $('interrupt').addEventListener('click', () => { player.signal.interrupt(); $('event').textContent = 'interrupted'; });
  for (const [name, m] of Object.entries(metadata)) {
    const row = document.createElement('section'); row.className = 'source-row';
    const title = document.createElement('h3'); title.textContent = name;
    const prompt = document.createElement('p'); prompt.textContent = m.source.provenance.prompt;
    const metrics = document.createElement('div'); metrics.className = 'source-metrics';
    for (const value of [`${m.timing.frameCount} frames · ${m.timing.fps.toFixed(0)} fps`, `${m.setupFrame.removedFrames} setup frames removed`, `${m.loopSeam.maximumJointAngleDegrees.toFixed(1)}° endpoint seam`, ...(name === 'walk' || name === 'run' ? [`${m.rootMotion.referenceSpeedMetersPerSecond.toFixed(2)} m/s reference`] : [])]) {
      const span = document.createElement('span'); span.textContent = value; metrics.append(span);
    }
    row.append(title, prompt, metrics); $('source-content').append(row);
  }
  $('loading').hidden = true; enabled = true;
}

const resize = new ResizeObserver(() => {
  const { width, height } = canvas.getBoundingClientRect(); renderer.setSize(width, height, false); camera.aspect = width / height;
  camera.fov = 35 + Math.max(0, 1.45 - camera.aspect) * 35;
  camera.updateProjectionMatrix();
}); resize.observe(canvas);
let previous = performance.now(), elapsed = 0, statsTime = 0, frames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const wallDt = (now - previous) / 1000, dt = Math.min(wallDt, .05); previous = now;
  if (!enabled || document.hidden) return;
  elapsed += dt;
  const walkSpeed = metadata.walk.rootMotion.referenceSpeedMetersPerSecond, runSpeed = metadata.run.rootMotion.referenceSpeedMetersPerSecond;
  let x = 0, z = 0, speed = 0;
  if (mode === 'manual') {
    let side = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    let forward = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
    if (touchIntent) [side, forward] = touchIntent;
    const backwards = camera.position.clone().sub(orbit.target); backwards.y = 0; backwards.normalize();
    const right = new THREE.Vector3(backwards.z, 0, -backwards.x);
    x = right.x * side + backwards.x * forward; z = right.z * side + backwards.z * forward;
    speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? runSpeed : walkSpeed;
  } else if (mode !== 'idle') {
    ({ x, z } = orbitIntent(player.controller.x, player.controller.z));
    speed = mode === 'run' ? runSpeed : walkSpeed;
  }
  actorStep(player, dt, { x, z, speed, walkSpeed, runSpeed });
  const crowd = Number($('crowd').value);
  for (const actor of actors.slice(1)) {
    actor.group.visible = actor.index <= crowd;
    if (!actor.group.visible) continue;
    const i = actor.index - 1, laneX = -4.2 + i % 4 * 2.8, laneZ = -2.2 - Math.floor(i / 4) * 2.7;
    const angle = elapsed * .75 + i * 1.3;
    const targetX = laneX + Math.cos(angle) * 1.1, targetZ = laneZ + Math.sin(angle) * .75;
    actorStep(actor, dt, { x: targetX - actor.controller.x, z: targetZ - actor.controller.z, speed: walkSpeed * (.68 + i % 3 * .1), walkSpeed, runSpeed });
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i]; e.age += dt;
    const t = e.age / e.duration;
    if (t >= 1) { scene.remove(e.mesh); e.mesh.material.dispose(); effects.splice(i, 1); }
    else { e.mesh.scale.setScalar(1 + t * (e.signal ? 8 : 3)); e.mesh.material.opacity = (1 - t) * .8; if (e.signal) e.mesh.quaternion.copy(camera.quaternion); }
  }
  orbit.update(); renderer.render(scene, camera);
  frames++; statsTime += wallDt;
  if (statsTime > .8) { $('render-stats').textContent = `${crowd + 1} characters · ${Math.round(frames / statsTime)} fps · ${renderer.info.render.calls} draw calls`; statsTime = 0; frames = 0; }
}
initialize().catch(error => { $('loading').textContent = `Couldn’t load the example: ${error.message}`; console.error(error); });
requestAnimationFrame(frame);
