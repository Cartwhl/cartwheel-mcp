"""Independently measure rendered boot surfaces and leg continuity after IK."""
import argparse,json,math,sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from contacts import foot_geometry,world_vertices,gaussian

p=argparse.ArgumentParser();p.add_argument('--output',required=True)
args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);scene=bpy.context.scene;report={};failures=[]
frames=list(range(scene.frame_start,scene.frame_end+1))
markings=[obj for obj in scene.objects if obj.name.startswith(('Docking lane dash','Inlaid compass circle','Compass spoke'))]
if not markings:raise RuntimeError('Missing deck-marking geometry')
highest_marking=max((obj.matrix_world@Vector(corner)).z for obj in markings for corner in obj.bound_box)
for rig in [obj for obj in scene.objects if obj.type=='ARMATURE'and obj.get('cast_member')]:
    slug=rig['cast_member'];meshes=[obj for obj in scene.objects if obj.type=='MESH'and obj.find_armature()==rig]
    scene.frame_set(frames[0]);geometry=foot_geometry(rig,meshes);contact=json.loads(rig['contact_review'])
    rig.data.pose_position='REST';bpy.context.view_layer.update();soles={}
    for side in ('left','right'):
        parts=geometry[side]['parts'];vertices={obj.name:world_vertices(obj,bpy.context.evaluated_depsgraph_get())for obj,_ in parts}
        low=min(float(vertices[obj.name][indices,2].min())for obj,indices in parts)
        soles[side]=[(obj,[i for i in indices if vertices[obj.name][i,2]<low+.006])for obj,indices in parts]
    rig.data.pose_position='POSE';bpy.context.view_layer.update()
    data={side:{'centers':[],'low':[],'knees':[],'rotations':[],'lengths':[]}for side in ('left','right')}
    for frame in frames:
        scene.frame_set(frame);bpy.context.view_layer.update();depsgraph=bpy.context.evaluated_depsgraph_get()
        vertices={obj.name:world_vertices(obj,depsgraph)for obj in meshes}
        for side in data:
            row=data[side];parts=geometry[side]['parts']
            row['low'].append(min(float(vertices[obj.name][indices,2].min())for obj,indices in parts))
            row['centers'].append(np.concatenate([vertices[obj.name][indices]for obj,indices in soles[side]if indices]).mean(axis=0))
            hip,knee,ankle=[rig.matrix_world@rig.pose.bones[side+'_'+part].head for part in ('hip','knee','ankle')]
            row['knees'].append(knee);row['lengths'].append(((hip-knee).length,(knee-ankle).length))
            row['rotations'].append((rig.matrix_world@rig.pose.bones[side+'_ankle'].matrix).to_quaternion())
    for side,row in data.items():
        drift=0.;coverage=0
        for start,end in contact['contacts'][side]:
            confidence=gaussian([float(start<=frame<=end)for frame in frames],sigma=scene.render.fps*contact['sigma_seconds'])
            core=[i for i,value in enumerate(confidence)if value>.999]
            coverage+=len(core)
            if core:drift=max(drift,max(float(np.linalg.norm(row['centers'][i]-row['centers'][core[0]]))for i in core))
        rotation=max(math.degrees(2*math.acos(min(1,abs(a.dot(b)))))for a,b in zip(row['rotations'],row['rotations'][1:]))
        acceleration=max((row['knees'][i+1]-2*row['knees'][i]+row['knees'][i-1]).length for i in range(1,len(frames)-1))
        lengths=np.array(row['lengths']);variation=float(np.max(np.ptp(lengths,axis=0)))
        values={'deep_stance_frames':coverage,'max_deep_stance_surface_drift_m':drift,'minimum_boot_height_m':min(row['low']),'max_boot_rotation_degrees_per_frame':rotation,'max_knee_acceleration_m_per_frame_squared':acceleration,'max_segment_length_variation_m':variation}
        report[slug+'/'+side]=values
        if coverage<8 or drift>.002 or min(row['low'])<max(contact['floor_height_m'],highest_marking) or rotation>20 or acceleration>.08 or variation>.0001:failures.append(slug+'/'+side)
Path(args.output).write_text(json.dumps({'measurements':report,'highest_deck_marking_m':highest_marking,'failures':failures},indent=2)+'\n')
print(json.dumps(report,indent=2))
if failures:raise RuntimeError('Contact review failed: '+', '.join(failures))
print('PASS: actual boot surfaces, stance drift, floor clearance, leg lengths and continuity')
