import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy, os, math
from mathutils import Vector,Matrix
s=bpy.context.scene;ROOT=os.path.dirname(bpy.data.filepath)
def key(o,f):
 for p in ['location','rotation_quaternion' if o.rotation_mode=='QUATERNION' else 'rotation_euler','scale']:o.keyframe_insert(data_path=p,frame=f)
def place(o,a,b):
 o.location=(a+b)/2;o.rotation_mode='QUATERNION';o.rotation_quaternion=(b-a).to_track_quat('Z','Y');o.scale.z=(b-a).length
for idx,name in enumerate(['PIP','MOMO']):
 root=bpy.data.objects[name];root.animation_data_clear();root.rotation_euler=(0,0,0)
 root.scale=(1.02,)*3 if idx==0 else (1.12,)*3
 root.location.x=-1.9 if idx==0 else .15
 body=bpy.data.objects[name+' torso'];chest=bpy.data.objects[name+' chest assembly'];head=bpy.data.objects[name+' head']
 bpy.ops.import_anim.bvh(filepath=os.path.join(ROOT,'assets',f'dance_{idx}.bvh'),axis_forward='-Z',axis_up='Y',use_fps_scale=False,update_scene_fps=False)
 arm=bpy.context.object;arm.name='Cartwheel source - '+name;arm.hide_render=True
 for o in [body,chest,head]:o.animation_data_clear();o.rotation_mode='QUATERNION'
 limbs={}
 for j,side in enumerate([-1,1]):
  limbs[side]={}
  for part in ['shoulder','elbow','wrist','hip','knee','ankle','upperarm','forearm','thigh','shin']:
   limbs[side][part]=sorted([o for o in root.children if o.name.startswith(name+' '+part)],key=lambda o:o.name)[j]
  for part,prefix in [('hand','Mitten hand'),('shoe','Dancing sneaker')]:limbs[side][part]=sorted([o for o in root.children if o.name.startswith(prefix)],key=lambda o:o.name)[j]
  for o in limbs[side].values():o.animation_data_clear()
 for f in range(1,193):
  source=1+(f-1)*30/24;s.frame_set(int(source),subframe=source%1)
  P={b.name:arm.matrix_world@b.head for b in arm.pose.bones}
  across=(P['left_shoulder']-P['right_shoulder']).normalized();up=(P['neck']-P['pelvis']).normalized();back=up.cross(across).normalized();across=back.cross(up).normalized()
  orient=Matrix((across,back,up)).transposed().to_quaternion()
  # Retain the source's body movement and limb directions, with widened toy proportions.
  offset=Vector((-.8*P['pelvis'].x*1.15,-.8*P['pelvis'].y*1.15,.16-min(P['left_ankle'].z,P['right_ankle'].z)*1.15))
  def p(n):return P[n]*1.15+offset
  body.location=p('pelvis')+up*.22;body.rotation_quaternion=orient
  chest.location=body.location;chest.rotation_quaternion=orient
  head.location=p('neck')+up*.26;head.rotation_quaternion=orient
  for o in [body,chest,head]:key(o,f)
  for side,L in limbs.items():
   prefix='left' if side>0 else 'right'
   hip=p(prefix+'_hip')+across*side*.12;knee=p(prefix+'_knee')+across*side*.12;ankle=p(prefix+'_ankle')+across*side*.12
   shoulder=p(prefix+'_shoulder')+across*side*.23;elbow=p(prefix+'_elbow')+across*side*.23;wrist=p(prefix+'_wrist')+across*side*.23
   for n,v in dict(hip=hip,knee=knee,ankle=ankle,shoulder=shoulder,elbow=elbow,wrist=wrist).items():L[n].location=v;key(L[n],f)
   for n,a,b in [('thigh',hip,knee),('shin',knee,ankle),('upperarm',shoulder,elbow),('forearm',elbow,wrist)]:place(L[n],a,b);key(L[n],f)
   L['hand'].location=wrist;key(L['hand'],f)
   shoe=L['shoe'];shoe.location=ankle+Vector((0,-.095,-.04));shoe.rotation_euler=(0,0,math.atan2(across.y,across.x));key(shoe,f)
 arm.hide_set(True)
s.camera.data.ortho_scale=15.2
s.render.fps=24;s.render.fps_base=1;s.frame_start=1;s.frame_end=192
from scene_utils import configure_device
configure_device(s);s.cycles.samples=48;s.cycles.use_denoising=True;s.render.resolution_percentage=100
s['motion_provenance']='Cartwheel Swing text-to-motion, retargeted to procedural toy robots.'
s.frame_set(48);bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'after_hours.blend'))
s.render.resolution_percentage=50;s.cycles.samples=24
for frame in [120]:
 s.frame_set(frame);s.render.filepath=os.path.join(ROOT,f'pose_{frame:03}.png');bpy.ops.render.render(write_still=True)
