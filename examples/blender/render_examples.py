#!/usr/bin/env python3
"""Rebuild the gallery from the included Cartwheel motions. No API calls."""
import argparse
import os
from pathlib import Path
import subprocess
import sys

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--blender',required=True,help='Path to the Blender 5.2 executable')
parser.add_argument('--device',default='CPU',choices=['CPU','METAL','CUDA','OPTIX','HIP','ONEAPI'])
parser.add_argument('--example',default='all',choices=['all','after-hours','garden','moon'])
parser.add_argument('--preview-only',action='store_true',help='Build scenes and pose previews without rendering the movies')
args=parser.parse_args()
root=Path(__file__).resolve().parent
env={**os.environ,'CARTWHEEL_RENDER_DEVICE':args.device}

def blender(script,blend=None,extra=()):
 command=[args.blender,'--background']
 command += [str(blend)] if blend else ['--factory-startup']
 subprocess.run(command+['--python-exit-code','1','--python',str(root/script)]+list(extra),cwd=root,env=env,check=True)

def encode(directory,output,audio=None):
 command=['ffmpeg','-y','-framerate','24','-i',str(directory/'frames/frame_%04d.png')]
 if audio:command+=['-i',str(audio)]
 command+=['-c:v','libx264','-crf','17','-preset','slow','-pix_fmt','yuv420p']
 if audio:command+=['-c:a','aac','-b:a','192k','-shortest']
 subprocess.run(command+['-movflags','+faststart',str(output)],check=True)

(root/'frames').mkdir(exist_ok=True)
blender('build_scene.py')
base=root/'after_hours.blend'
blender('render_preview.py',base)
blender('retarget.py',base)
subprocess.run([sys.executable,str(root/'make_music.py')],check=True)
for style in ('garden','moon'):
 if args.example in ('all',style):
  blender('variants.py',base,['--',style])

# Contact and continuity checks are part of the default workflow, before movies.
blender('verify_motion.py',extra=['--','--example',args.example])
if not args.preview_only:
 if args.example in ('all','after-hours'):
  blender('render_final.py',base)
  encode(root,root/'after-hours.mp4',root/'after_hours_groove.wav')
 for style,title in [('garden','slow-morning'),('moon','moon-mail')]:
  if args.example in ('all',style):
   blender('render_variant.py',root/style/(style+'.blend'))
   encode(root/style,root/(title+'.mp4'))
