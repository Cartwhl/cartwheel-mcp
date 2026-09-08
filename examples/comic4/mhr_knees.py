"""Restore native MHR LOD1 knee pose correctives in Blender 5.

Uses the official MHR v1.0.1 assets (Apache-2.0), downloaded separately.
The released network is compiled into ordinary shape keys and Blender drivers:
no Python handlers, frame-specific sculpting, or ML runtime is needed to play
the saved scene. Original skeletal weights, animation and facial keys remain.
"""
import argparse
import json
from pathlib import Path
import sys

import bpy
import numpy as np

PREFIX = 'MHR_Knee_'
SOURCE = 'https://github.com/facebookresearch/MHR/releases/tag/v1.0.1'


def coordinates(points):
    result = np.empty((len(points), 3), dtype=np.float32)
    points.foreach_get('co', result.ravel())
    return result


def local_rotation(bone):
    matrix = bone.parent.matrix_local.inverted() @ bone.matrix_local if bone.parent else bone.matrix_local
    return matrix.to_quaternion()


def load_model(directory):
    """Load the released matrices and reference FBX for strict correspondence checks."""
    directory = Path(directory).resolve()
    paths = [directory/name for name in ('lod1.fbx', 'corrective_activation.npz', 'corrective_blendshapes_lod1.npz')]
    if not all(p.is_file() for p in paths):
        raise ValueError('Expected official MHR LOD1 FBX, activation and corrective blendshape assets.')
    with np.load(paths[1], allow_pickle=False) as data:
        activation = np.zeros((3000, 750), dtype=np.float32)
        activation[tuple(data['0.sparse_indices'])] = data['0.sparse_weight']
    with np.load(paths[2], allow_pickle=False) as data:
        blends = data['corrective_blendshapes']
    if blends.shape != (3000, 18439, 3):
        raise ValueError('This helper requires the released MHR LOD1 topology.')

    scene = bpy.context.scene
    frame, fps, fps_base, camera = scene.frame_current, scene.render.fps, scene.render.fps_base, scene.camera
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(paths[0]), use_anim=False, automatic_bone_orientation=False)
    imported = set(bpy.data.objects)-before
    try:
        rig = next(o for o in imported if o.type == 'ARMATURE')
        mesh = max((o for o in imported if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
        keys = mesh.data.shape_keys.key_blocks
        basis = coordinates(keys[0].data)
        names = [b.name for b in rig.data.bones]
        if len(names) != 126 or names[0] != 'root' or len(keys) != 118:
            raise ValueError('Unexpected MHR reference rig or blendshape layout.')
        model = {
            'names': names,
            'rotations': {b.name: local_rotation(b).copy() for b in rig.data.bones},
            'faces': [tuple(p.vertices) for p in mesh.data.polygons],
            'face_deltas': np.stack([coordinates(keys[f'shape_{45+i}'].data)-basis for i in range(72)]),
            'activation': activation,
            'blends': blends,
        }
    finally:
        for obj in imported:
            bpy.data.objects.remove(obj, do_unlink=True)
        scene.render.fps, scene.render.fps_base, scene.camera = fps, fps_base, camera
        scene.frame_set(frame)
    return model


def knee_mask(body, rig):
    """Anatomical support, with a C2 falloff into the thigh and calf."""
    mask = np.zeros(len(body.data.vertices), dtype=np.float32)
    for side in ('l', 'r'):
        knee = rig.data.bones[f'{side}_lowleg'].head_local
        ankle = rig.data.bones[f'{side}_talocrural'].head_local
        direction = ankle-knee
        length, axis = direction.length, direction.normalized()
        groups = {g.index for g in body.vertex_groups if g.name.startswith(side+'_') and 'leg' in g.name}
        for vertex in body.data.vertices:
            support = sum(g.weight for g in vertex.groups if g.group in groups)
            if not support:
                continue
            distance = abs((vertex.co-knee).dot(axis))/length
            t = min(1., max(0., (distance-.12)/.32))
            fade = 1-t*t*t*(t*(t*6-15)+10)
            mask[vertex.index] = max(mask[vertex.index], support*fade)
    return mask


def single_property(driver, name, owner, path, id_type='OBJECT'):
    variable = driver.variables.new()
    variable.name, variable.type = name, 'SINGLE_PROP'
    target = variable.targets[0]
    target.id_type, target.id, target.data_path = id_type, owner, path


def add_knee_correctives(body, rig, model):
    """Compile the native corrective model for an unmodified Comic 4 MHR surface."""
    if body.get('mhr_knee_correctives'):
        raise ValueError('Knee correctives are already installed; start from the original import to rebuild them.')
    if [b.name for b in rig.data.bones] != model['names']:
        raise ValueError('MHR joint names/order differ from the reference; do not guess a mapping.')
    if len(body.data.vertices) != 18439 or [tuple(p.vertices) for p in body.data.polygons] != model['faces']:
        raise ValueError('MHR vertex/polygon correspondence has changed.')
    if any(local_rotation(b).rotation_difference(model['rotations'][b.name]).angle > 1e-3 for b in rig.data.bones):
        raise ValueError('MHR local joint axes differ from the reference FBX.')
    arms = [m for m in body.modifiers if m.type == 'ARMATURE']
    if len(arms) != 1 or arms[0].object != rig or arms[0].use_deform_preserve_volume:
        raise ValueError('Native MHR correctives require the original single linear Armature modifier.')
    keys = body.data.shape_keys.key_blocks if body.data.shape_keys else []
    if len(keys) != 73:
        raise ValueError('Use the complete MHR FBX with its 72 original facial blendshapes.')
    basis = coordinates(keys[0].data)
    face = np.stack([coordinates(k.data)-basis for k in list(keys)[1:]])
    reference = model['face_deltas']
    scale = float(np.sum(face*reference, dtype=np.float64)/np.sum(reference*reference, dtype=np.float64))
    relative_error = float(np.linalg.norm(face-scale*reference)/np.linalg.norm(face))
    if scale <= 0 or relative_error > 1e-3:
        raise ValueError('Facial deltas do not match the reference; corrective axes/scale are unverified.')

    mask = knee_mask(body, rig)
    support = np.flatnonzero(mask > 0)
    components = np.flatnonzero(np.any(model['blends'][:, support] != 0, axis=(1, 2)))
    weights = model['activation'][components]
    feature_indices = np.flatnonzero(np.any(weights != 0, axis=0))
    control = bpy.data.objects.new(f'{body.name} — MHR knee pose', None)
    bpy.context.scene.collection.objects.link(control)
    control.hide_render = True
    control.empty_display_size = .01
    control['model_source'] = SOURCE
    control['method'] = 'Native MHR sparse rotation features, ReLU activations and corrective blendshapes.'
    partials = bpy.data.objects.new(f'{body.name} — MHR knee sums', None)
    bpy.context.scene.collection.objects.link(partials)
    partials.hide_render = True
    partials.empty_display_size = .01

    # MHR's features are the first two columns of the local XYZ rotation minus
    # identity. Normalize columns to exclude scale; read matrix_basis so the
    # same saved drivers work with Euler or quaternion animation.
    names = model['names'][1:]
    for feature in feature_indices:
        joint, element = divmod(int(feature), 6)
        column, row = divmod(element, 3)
        prop = f'f{feature}'
        control[prop] = 0.0
        driver = control.driver_add(f'[{json.dumps(prop)}]').driver
        for r in range(3):
            # RNA driver paths index matrix columns first; mathutils indexes
            # rows first. Transpose the path indices, not the MHR features.
            path = f'pose.bones[{json.dumps(names[joint])}].matrix_basis[{column}][{r}]'
            single_property(driver, f'm{r}', rig, path)
        driver.expression = f'm{row}/max(sqrt(m0*m0+m1*m1+m2*m2),1e-12)-{int(row == column)}'

    for component, row_weights in zip(components, weights):
        features = np.flatnonzero(row_weights != 0)
        # Bound the activation using the rotation-feature ranges, then absorb
        # that scale into the shape. Every Blender key can stay in [0, 1].
        bound = max(1., sum(abs(float(row_weights[f]))*(2 if f % 6 in (0, 4) else 1) for f in features))
        key = body.shape_key_add(name=f'{PREFIX}{component:04d}', from_mix=False)
        delta = model['blends'][component]*mask[:, None]*scale*bound
        key.data.foreach_set('co', (basis+delta).ravel())
        driver = key.driver_add('value').driver
        sums = []
        # Blender stores at most 255 expression characters. Small linear sums
        # preserve the released coefficients exactly without truncating them.
        for start in range(0, len(features), 8):
            prop = f'c{component}_{start//8}'
            partials[prop] = 0.0
            partial = partials.driver_add(f'[{json.dumps(prop)}]').driver
            terms = []
            for feature in features[start:start+8]:
                name = f'f{feature}'
                single_property(partial, name, control, f'[{json.dumps(name)}]')
                terms.append(f'({float(row_weights[feature]):.9g}*{name})')
            expression = '+'.join(terms)
            partial.expression = expression
            if partial.expression != expression:
                raise ValueError('Blender truncated an MHR driver expression.')
            name = f'p{start//8}'
            single_property(driver, name, partials, f'[{json.dumps(prop)}]')
            sums.append(name)
        driver.expression = f'max({"+".join(sums)},0)/{bound:.12g}'

    group = body.vertex_groups.new(name='MHR knee corrective region')
    for index in support:
        group.add([int(index)], float(mask[index]), 'REPLACE')
    body['mhr_knee_correctives'] = SOURCE
    body['mhr_corrective_scale'] = scale
    body['mhr_corrective_count'] = len(components)
    bpy.context.view_layer.update()
    return {'components': components, 'mask': mask, 'scale': scale, 'control': control, 'face_delta_relative_error': relative_error}


def copy_knee_correctives(body, garment, source_indices):
    """Transfer the same pre-skin deltas to a shell with known source vertex IDs."""
    indices = np.asarray(source_indices, dtype=np.int32)
    if len(indices) != len(garment.data.vertices) or np.any(indices < 0) or np.any(indices >= len(body.data.vertices)):
        raise ValueError('Provide one verified source-body vertex index for every garment vertex.')
    source = body.data.shape_keys.key_blocks
    source_basis = coordinates(source[0].data)
    targets = [(key, coordinates(key.data)[indices]-source_basis[indices]) for key in source if key.name.startswith(PREFIX)]
    targets = [(key, delta) for key, delta in targets if np.any(delta != 0)]
    if not targets:
        return 0
    if garment.data.shape_keys is None:
        garment.shape_key_add(name='Basis')
    basis = coordinates(garment.data.shape_keys.key_blocks[0].data)
    for original, delta in targets:
        if original.name in garment.data.shape_keys.key_blocks:
            raise ValueError('Garment already contains these knee correctives.')
        key = garment.shape_key_add(name=original.name, from_mix=False)
        key.data.foreach_set('co', (basis+delta).ravel())
        driver = key.driver_add('value').driver
        driver.type = 'AVERAGE'
        single_property(driver, 'body', body.data.shape_keys, f'key_blocks[{json.dumps(original.name)}].value', 'KEY')
    garment['mhr_knee_correctives'] = SOURCE
    return len(targets)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    actors = [o for o in bpy.context.scene.objects if o.type == 'MESH' and 'capture_actor_index' in o]
    if not actors:
        raise ValueError('First import the captured MHR FBXs with import_capture.py.')
    model = load_model(args.assets)
    for body in actors:
        rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE' and o.get('capture_actor_index') == body['capture_actor_index'])
        result = add_knee_correctives(body, rig, model)
        print('MHR_KNEES_INSTALLED', body.name, len(result['components']), result['scale'], flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.output).resolve()))


if __name__ == '__main__':
    main()
