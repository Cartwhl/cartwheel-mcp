"""Check grounding and temporal continuity in the rebuilt gallery using Blender."""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector, Quaternion

ROOT = Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from contact_math import detect_contacts, foot_headings, gaussian, solve_knee
from motion import lock_feet
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--scene-root',type=Path,default=ROOT)
parser.add_argument('--example',choices=('all','after-hours','garden','moon'),default='all')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
SCENES = args.scene_root

# A toe pitching through vertical must not become a horizontal foot flip.
rotations = [Quaternion((0,0,1),.4)@Quaternion((1,0,0),math.radians(pitch)) for pitch in (0,20,60,80,95,110,170,110,95,80,60,20,0)]
assert max(abs(a-.4) for a in foot_headings(rotations)) < 1e-5

# Gaussian contact transitions must not introduce the hard anchor's velocity jump.
raw = [Vector((i*.02,0,.15)) for i in range(80)]
corrected, angles = lock_feet(raw,[0.]*80,[(20,50)],.145)
assert max((corrected[i+1]-2*corrected[i]+corrected[i-1]).length for i in range(1,79)) < .04

# Moving an IK target across the old leg axis must not reverse the knee pole.
hip,knee,ankle = Vector((0,0,1)),Vector((0,-.3,.5)),Vector((0,0,0))
for x in (-.2,0,.2):
    target = Vector((x,0,.1))
    solved = solve_knee(hip,knee,ankle,target,Vector((0,-1,0)))
    assert solved.y < 0
    assert abs((solved-hip).length-(knee-hip).length) < 1e-5
    assert abs((target-solved).length-(ankle-knee).length) < 1e-5

report = {}
for title,filename,ground,bots in (
    ('after-hours','after_hours.blend',.103,{'PIP':'dance_0','MOMO':'dance_1'}),
    ('garden','garden/garden.blend',.08,{'MOMO':'showcase_0'}),
    ('moon','moon/moon.blend',.08,{'MOMO':'showcase_1'}),
):
    if args.example not in ('all',title):
        continue
    bpy.ops.wm.open_mainfile(filepath=str(SCENES/filename))
    scene = bpy.context.scene
    for name,motion in bots.items():
        source_file = ROOT/'assets'/(motion+'.bvh')
        with source_file.open() as source:
            source_fps = 1/float(next(line.split(':')[1] for line in source if line.startswith('Frame Time:')))
        bpy.ops.import_anim.bvh(filepath=str(source_file),axis_forward='-Z',axis_up='Y')
        arm = bpy.context.object
        samples = []
        for i in range(192):
            time = 1+i*source_fps/24
            scene.frame_set(int(time),subframe=time%1)
            samples.append({b.name:arm.matrix_world@b.head for b in arm.pose.bones})
        contacts = detect_contacts(samples)
        shoes = sorted((o for o in bpy.data.objects[name].children if o.name.startswith('Dancing sneaker')),key=lambda o:o.name)
        knees = sorted((o for o in bpy.data.objects[name].children if o.name.startswith(name+' knee')),key=lambda o:o.name)
        for side,shoe,knee in zip(('right','left'),shoes,knees):
            spans,_ = contacts[side]
            assert sum(b-a+1 for a,b in spans) >= 50, 'Insufficient detected stance coverage'
            centers,rotations,corners,knee_points = [],[],[],[]
            for frame in range(1,193):
                scene.frame_set(frame)
                centers.append(shoe.matrix_world.translation.copy())
                rotations.append(shoe.matrix_world.to_quaternion())
                corners.append([shoe.matrix_world@Vector(v) for v in shoe.bound_box])
                knee_points.append(knee.matrix_world.translation.copy())
            drift = 0.
            for start,end in spans:
                confidence = gaussian([1. if start<=i<=end else 0. for i in range(192)])
                core = [i for i in range(start,end+1) if confidence[i]>.995]
                if core:
                    drift = max(drift,max((centers[i]-centers[core[0]]).length for i in core))
            minimum = min(p.z for frame in corners for p in frame)
            turn = max(math.degrees(2*math.acos(min(1,abs(a.dot(b))))) for a,b in zip(rotations,rotations[1:]))
            acceleration = max((knee_points[i+1]-2*knee_points[i]+knee_points[i-1]).length for i in range(1,191))
            assert drift < .01, (title,name,side,'deep-stance shoe-center drift',drift)
            assert ground-1e-4 <= minimum < ground+.01, (title,name,side,'sole height',minimum)
            assert turn < 20, (title,name,side,'foot yaw discontinuity',turn)
            assert acceleration < .08, (title,name,side,'knee acceleration spike',acceleration)
            report[title+'/'+name+'/'+side] = {
                'max_deep_stance_center_drift_m':drift,
                'minimum_sole_height_m':minimum,
                'max_foot_turn_degrees_per_frame':turn,
                'max_knee_acceleration_m_per_frame_squared':acceleration,
            }
    if title=='after-hours':
        for shoe in (o for o in bpy.data.objects['DOT'].children if o.name.startswith('Dancing sneaker')):
            positions=[]
            for frame in range(1,193):
                scene.frame_set(frame)
                positions.append(shoe.matrix_world.translation.copy())
            assert max((p-positions[0]).length for p in positions)<1e-4, 'DJ foot moved'
print(json.dumps(report,indent=2))
print('PASS: contact easing, stable knee poles, foot yaw, floor clearance, and pose continuity')
