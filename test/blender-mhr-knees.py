"""Integration check for an MHR-corrected .blend and official local model assets.

blender -b corrected.blend --disable-autoexec --python-exit-code 1 \
  --python test/blender-mhr-knees.py -- --assets /path/to/mhr-assets

No capture data or model assets are distributed with the test. This checks the
saved driver graph against independent NumPy inference, including rotated
poses that catch Blender RNA's column-first matrix indexing.
"""
import argparse
import json
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Quaternion

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'examples/comic4'))
from mhr_knees import PREFIX, coordinates, knee_mask, load_model

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--assets', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
model = load_model(args.assets)
scene = bpy.context.scene
actors = [o for o in scene.objects if o.type == 'MESH' and 'capture_actor_index' in o]
assert actors, 'No imported capture actors'
report = []
for body in actors:
    rig = next(o for o in scene.objects if o.type == 'ARMATURE' and o.get('capture_actor_index') == body['capture_actor_index'])
    keys = [k for k in body.data.shape_keys.key_blocks if k.name.startswith(PREFIX)]
    assert keys, 'Native knee correctives are missing'
    components = np.array([int(k.name[len(PREFIX):]) for k in keys])
    weights = model['activation'][components]
    ranges = np.ones(750)
    ranges[0::6] = 2
    ranges[4::6] = 2
    bounds = np.maximum(1, (np.abs(weights)*ranges).sum(axis=1))
    mask = knee_mask(body, rig)
    support = np.flatnonzero(mask > 0)
    basis = coordinates(body.data.shape_keys.key_blocks[0].data)
    for key in keys:
        assert np.array_equal(coordinates(key.data)[mask == 0], basis[mask == 0]), 'Corrective reaches beyond knees'
    matrix = (model['blends'][:, support][components]*mask[support][None, :, None]*body['mhr_corrective_scale']).reshape(len(keys), -1)
    maximum_error = 0.

    def check():
        global maximum_error
        bpy.context.view_layer.update()
        rotations = np.array([np.array(rig.pose.bones[n].matrix_basis.to_quaternion().to_matrix()) for n in model['names'][1:]])
        rotations -= np.eye(3)
        features = rotations[:, :, :2].transpose(0, 2, 1).reshape(750)
        expected = np.maximum(weights@features, 0)
        actual = np.array([k.value for k in keys])*bounds
        error = float(np.abs((actual-expected)@matrix).max())
        maximum_error = max(maximum_error, error)
        # Blender suppresses driven values very close to zero; constrain the
        # resulting pre-skin coordinate discrepancy to 0.02 mm.
        assert error < .002, f'Native MHR model mismatch: {error} cm'
        assert all(c.driver.is_valid for c in body.data.shape_keys.animation_data.drivers)

    for frame in np.linspace(scene.frame_start, scene.frame_end, 9).round().astype(int):
        scene.frame_set(int(frame))
        check()
    action = rig.animation_data.action
    rig.animation_data.action = None
    for side in ('l', 'r'):
        bone = rig.pose.bones[f'{side}_lowleg']
        mode, euler, quaternion = bone.rotation_mode, bone.rotation_euler.copy(), bone.rotation_quaternion.copy()
        try:
            for angle in (0., .7, 1.6, 2.75):
                bone.rotation_mode = 'QUATERNION'
                bone.rotation_quaternion = Quaternion((.05, .02, 1), angle)
                check()
            bone.rotation_mode = 'XYZ'
            bone.rotation_euler = (.08, -.06, 2.4)
            check()
        finally:
            bone.rotation_mode, bone.rotation_euler, bone.rotation_quaternion = mode, euler, quaternion
    rig.animation_data.action = action
    report.append({'actor': body['capture_actor_index'], 'corrective_shapes': len(keys), 'max_coordinate_error_mm': maximum_error*10})
print('MHR_KNEE_TEST_PASSED', json.dumps(report), flush=True)
