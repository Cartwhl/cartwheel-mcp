import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy, os, math
from mathutils import Vector
s=bpy.context.scene
from scene_utils import configure_device
configure_device(s);s.cycles.samples=48
s.render.resolution_x=1600;s.render.resolution_y=1000;s.render.resolution_percentage=60
c=s.camera;c.data.ortho_scale=14.3
c.animation_data_clear()
for f in range(1,194):
 t=(f-1)/24;a=.045*math.sin(2*math.pi*t/8)
 c.location=(7*math.cos(a)+17*math.sin(a),7*math.sin(a)-17*math.cos(a),9.5)
 c.rotation_euler=(Vector((0,.65,2.2))-c.location).to_track_quat('-Z','Y').to_euler();c.keyframe_insert(data_path='location',frame=f);c.keyframe_insert(data_path='rotation_euler',frame=f)
s.frame_set(33)
s.render.filepath=os.path.join(os.path.dirname(bpy.data.filepath),'preview_v2.png')
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
bpy.ops.render.render(write_still=True)
