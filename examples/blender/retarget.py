import sys
from pathlib import Path
import bpy
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from motion import animate_bot
from scene_utils import configure_device
s=bpy.context.scene
for idx,name in enumerate(('PIP','MOMO')):
 root=bpy.data.objects[name]
 root.animation_data_clear()
 root.rotation_euler=(0,0,0)
 root.scale=(1.02,)*3 if idx==0 else (1.12,)*3
 root.location=(-1.4,-.35,.103) if idx==0 else (.15,-1.05,.103)
 animate_bot(name,ROOT/'assets'/f'dance_{idx}.bvh')
s.camera.data.ortho_scale=15.2
s.render.fps=24;s.render.fps_base=1;s.frame_start=1;s.frame_end=192
configure_device(s);s.cycles.samples=48;s.cycles.use_denoising=True;s.render.resolution_percentage=100
s['motion_provenance']='Cartwheel Swing motion with preserved root travel and stance-foot IK.'
s.frame_set(48);bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'after_hours.blend'))
s.render.resolution_percentage=50;s.cycles.samples=24
s.frame_set(120);s.render.filepath=str(ROOT/'pose_120.png');bpy.ops.render.render(write_still=True)
