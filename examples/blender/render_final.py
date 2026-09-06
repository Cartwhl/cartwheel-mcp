import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy,os
s=bpy.context.scene;from scene_utils import configure_device
configure_device(s);s.cycles.samples=64;s.cycles.use_denoising=True;s.render.use_persistent_data=True
s.render.resolution_x=1920;s.render.resolution_y=1200;s.render.resolution_percentage=100
s.render.image_settings.file_format='PNG';s.render.filepath=os.path.join(os.path.dirname(bpy.data.filepath),'frames','frame_')
s.render.fps=24;s.frame_start=1;s.frame_end=192
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
bpy.ops.render.render(animation=True)
