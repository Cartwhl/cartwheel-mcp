"""Build the complete Lantern Port scene from the three included rigged assets."""
import argparse,json,sys
from pathlib import Path
import bpy
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from environment import build_scene
from art_direction import art_direct,frame_frog_closeup
from characters import import_characters

if bpy.app.version < (5,2,0):raise RuntimeError('This example requires Blender 5.2 or newer.')
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--assets',default=str(ROOT/'assets'))
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.output).resolve();out.mkdir(parents=True,exist_ok=True)
build_scene();art_direct();report=import_characters(Path(a.assets),ROOT/'cast.json')
frame_frog_closeup()
bpy.context.scene.frame_set(90)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'lantern-port.blend'))
(out/'character-import-report.json').write_text(json.dumps(report,indent=2))
print('LANTERN_PORT_READY',out/'lantern-port.blend')
