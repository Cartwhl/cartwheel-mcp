"""Render selected frames or a range from a saved Lantern Port scene."""
import bpy,sys,argparse,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from render_settings import configure_render
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--frames',default='');p.add_argument('--start',type=int,default=1);p.add_argument('--end',type=int,default=192);p.add_argument('--samples',type=int,default=256);p.add_argument('--scale',type=int,default=100);p.add_argument('--engine',default='CYCLES');p.add_argument('--device',default='METAL')
args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(args.output);out.mkdir(parents=True,exist_ok=True);scene=bpy.context.scene
configure_render(scene,args.samples)
scene.render.engine=args.engine;scene.render.resolution_percentage=args.scale
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB';scene.render.use_persistent_data=True
if args.engine=='CYCLES':
    scene.cycles.samples=args.samples;scene.cycles.use_denoising=True
    prefs=bpy.context.preferences.addons['cycles'].preferences
    if args.device!='CPU':prefs.compute_device_type=args.device
    prefs.get_devices()
    for d in prefs.devices:d.use=d.type==args.device
    scene.cycles.device='GPU' if args.device!='CPU' else 'CPU'
    print('RENDER_DEVICES',[(d.name,d.type,d.use) for d in prefs.devices],flush=True)
frames=[int(v) for v in args.frames.split(',')] if args.frames else range(args.start,args.end+1)
started=time.monotonic()
for frame in frames:
    output=out/f'{frame:04}.png'
    if output.exists() and output.stat().st_size>1000:continue
    scene.frame_set(frame)
    markers=[m for m in scene.timeline_markers if m.camera and m.frame<=frame]
    if markers:scene.camera=max(markers,key=lambda m:m.frame).camera
    scene.render.filepath=str(output);bpy.ops.render.render(write_still=True)
    print('FRAME_DONE',frame,round(time.monotonic()-started,2),flush=True)
