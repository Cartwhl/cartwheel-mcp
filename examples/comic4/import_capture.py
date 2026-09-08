"""Import Comic 4's per-person MHR FBXs and optional camera into Blender 5.

Run in a new Blender process. No recentering, floor snapping, or retargeting is
performed. Explicit time scales correct a verified export-cadence mismatch;
they must be checked against the source, not guessed from one pose.
"""
import argparse
from pathlib import Path
import sys

import bpy
import numpy as np


def scale_action_time(action, scale):
    """Scale every channel, including shape keys, around its first frame."""
    if scale == 1:
        return
    origin = float(action.frame_range[0])
    for layer in action.layers:
        for strip in layer.strips:
            for slot in action.slots:
                bag = strip.channelbag(slot)
                if bag is None:
                    continue
                for curve in bag.fcurves:
                    points = curve.keyframe_points
                    values = np.empty(len(points) * 2, dtype=np.float32)
                    for field in ('co', 'handle_left', 'handle_right'):
                        points.foreach_get(field, values)
                        values[::2] = origin + (values[::2] - origin) * scale
                        points.foreach_set(field, values)
                    curve.update()


def import_capture(actor_paths, camera_path=None, fps=30, actor_time_scale=1, camera_time_scale=1):
    if not 1 <= len(actor_paths) <= 4:
        raise ValueError('Provide one to four per-person MHR FBX files.')
    if not 0 < fps <= 240 or actor_time_scale <= 0 or camera_time_scale <= 0:
        raise ValueError('Frame rate and time scales must be positive.')
    paths = [Path(p).resolve() for p in actor_paths]
    camera_path = Path(camera_path).resolve() if camera_path else None
    for path in paths + ([camera_path] if camera_path else []):
        if not path.is_file() or path.suffix.lower() != '.fbx':
            raise ValueError(f'Expected a local FBX file: {path}')
    scene = bpy.context.scene
    world = bpy.data.objects.new('Capture — shared coordinate frame', None)
    scene.collection.objects.link(world)
    actors, cameras, imported_actions = [], [], []
    for index, path in enumerate(paths + ([camera_path] if camera_path else [])):
        is_camera = index == len(paths)
        objects_before, actions_before = set(bpy.data.objects), set(bpy.data.actions)
        bpy.ops.import_scene.fbx(filepath=str(path), use_anim=True)
        objects = set(bpy.data.objects) - objects_before
        actions = set(bpy.data.actions) - actions_before
        for action in actions:
            scale_action_time(action, camera_time_scale if is_camera else actor_time_scale)
        imported_actions.extend(actions)
        for obj in objects:
            obj.name = f'{"SourceCamera" if is_camera else f"Actor_{index:02}"}__{obj.name}'
            obj['capture_source'] = path.name
            if not is_camera:
                obj['capture_actor_index'] = index
            if obj.parent not in objects:
                # The common parent starts at identity, preserving animated local
                # transforms and everyone's relative placement.
                obj.parent = world
        if is_camera:
            cameras.extend(o for o in objects if o.type == 'CAMERA')
        else:
            rigs = [o for o in objects if o.type == 'ARMATURE']
            meshes = [o for o in objects if o.type == 'MESH']
            if not rigs or not meshes:
                raise ValueError(f'{path.name} must contain the captured MHR rig and mesh.')
            actors.append({'index': index, 'objects': objects, 'rigs': rigs, 'meshes': meshes})
    scene.render.fps = round(fps)
    scene.render.fps_base = round(fps) / fps
    scene.frame_start = min(round(a.frame_range[0]) for a in imported_actions)
    scene.frame_end = max(round(a.frame_range[1]) for a in imported_actions)
    scene.frame_set(scene.frame_start)
    if cameras:
        scene.camera = cameras[0]
    world['actor_time_scale'] = actor_time_scale
    world['camera_time_scale'] = camera_time_scale
    world['review_required'] = 'Verify source synchronization, axes, scale, facial timing and contacts before rendering.'
    return {'world': world, 'actors': actors, 'cameras': cameras}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--actor', action='append', required=True, help='Repeat in capture actor-index order.')
    parser.add_argument('--camera')
    parser.add_argument('--fps', type=float, default=30)
    parser.add_argument('--actor-time-scale', type=float, default=1)
    parser.add_argument('--camera-time-scale', type=float, default=1)
    parser.add_argument('--output', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    result = import_capture(args.actor, args.camera, args.fps, args.actor_time_scale, args.camera_time_scale)
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
    print(f'CAPTURE_IMPORTED: {len(result["actors"])} actors, {len(result["cameras"])} cameras; {output.name}')


if __name__ == '__main__':
    main()
