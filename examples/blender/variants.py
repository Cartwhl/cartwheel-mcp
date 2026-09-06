import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy,math,random,os,sys
from mathutils import Vector
from math import pi,sin,cos
ROOT=os.path.dirname(os.path.abspath(__file__));sys.path.insert(0,ROOT)
from scene_utils import mat,cube,uv,cyl,torus,text,empty,segment,light,key
from motion import animate_bot
random.seed(91);s=bpy.context.scene
STYLE=sys.argv[-1] if sys.argv[-1] in ['garden','moon'] else 'garden'
# Reuse the original procedural character, with entirely new sets and lighting.
root=bpy.data.objects['MOMO'];keep=set()
def retain(o):
 keep.add(o)
 for c in o.children:retain(c)
retain(root)
for o in list(bpy.data.objects):
 if o not in keep:bpy.data.objects.remove(o,do_unlink=True)
root.location=(0,0,.14)
for o in root.children:
 if o.name.startswith('MOMO'):o.hide_render=False

# Materials shared by the artist-made sets.
cream=mat('Ivory clay',(.86,.79,.64),rough=.6);dark=mat('Soft charcoal',(.035,.045,.06),rough=.55);gold=mat('Satin brass',(.6,.35,.1),metal=.6);mint=mat('Celadon',(.32,.63,.52),rough=.72);peach=mat('Peach paper',(.94,.43,.31),rough=.8);pink=mat('Sakura paper',(.9,.43,.55),rough=.85)
if STYLE=='garden':
 # Warm paper-and-clay miniature, arranged around a reflective pond.
 s.world.node_tree.nodes['Background'].inputs[0].default_value=(.55,.47,.4,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.55
 backdrop=mat('Peach cyclorama',(.57,.33,.28),rough=.82)
 cube('Cyclorama',(0,0,-.65),(200,200,.1),backdrop,0)
 base=cyl('Garden diorama',(0,0,-.2),4.3,.45,cream)
 soil=mat('Sand',(.68,.60,.40),rough=.85);cyl('Raked sand',(0,0,.04),4.23,.08,soil)
 water=mat('Jade water',(.045,.27,.24),metal=.35,rough=.13);pond=cyl('Still pond',(1.6,.55,.10),1.55,.055,water);pond.scale.y=.73
 for j in range(8):
  r=.8+j*.11;torus('Ripples',(1.55,.3,.133),r,.005,mint).scale.y=.73
 for x,y,r in [(2.4,.6,.27),(1.8,1.05,.19),(1.1,.1,.21)]:
  cyl('Lily pad',(x,y,.145),r,.018,mint)
  for j in range(5):
   a=j*2*pi/5;o=uv('Paper lotus petal',(x+.07*cos(a),y+.07*sin(a),.2),(.07,.12,.035),pink);o.rotation_euler.z=a
 for i in range(7):
  x=-2.8+i*.73;y=-2.0+.12*sin(i)
  o=cyl('Stepping stone',(x,y,.12),.35,.12,cream);o.scale.y=.62
 wood=mat('Warm cedar',(.33,.13,.065),rough=.65)
 for x,y,height in [(-2.7,1.3,2.5),(2.6,2.2,2.25)]:
  segment('Tree trunk',(x,y,.1),(x+.12,y,height),.095,wood)
  for j in range(7):
   a=j*2.4;end=Vector((x+.72*cos(a),y+.55*sin(a),height+.3*sin(a)))
   segment('Branch',(x,y,height*.68),end,.035,wood)
   for k in range(4):
    p=end+Vector((random.uniform(-.28,.28),random.uniform(-.25,.25),random.uniform(-.15,.28)))
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.36,location=p);o=bpy.context.object;o.name='Folded cherry blossom';o.data.materials.append(pink if k%2 else peach);o.scale=(1,.8,.64)
 for x,y in [(-3,-.3),(3,-.8)]:
  cyl('Lantern footing',(x,y,.15),.22,.12,dark);segment('Lantern stem',(x,y,.1),(x,y,.8),.055,wood)
  cube('Paper lantern',(x,y,.9),(.38,.38,.45),cream,.025)
  for dx in [-.2,.2]:
   for dy in [-.2,.2]:segment('Lantern frame',(x+dx,y+dy,.65),(x+dx,y+dy,1.15),.012,wood)
  cube('Lantern roof',(x,y,1.18),(.53,.53,.08),dark,.04)
 # A large matte sun, bamboo screen and little banner.
 o=cyl('Peach sun',(0,3.1,2.8),1.0,.12,peach);o.rotation_euler.x=pi/2
 for j in range(12):segment('Bamboo backdrop',(-2+j*.35,3.4,.1),(-2+j*.35,3.4,1.5),.025,wood)
 text('Garden title','SLOW MORNING',(0,3.0,3.00),.27,cream)
 text('Garden subtitle','MOTION  /  IN  BALANCE',(0,3.0,2.7),.10,cream)
 root.location=(-.55,-.15,.08);root.rotation_euler.z=-pi/2;root.scale=(1.2,)*3
 # Clay finish on the hero, with softer face lights.
 for m in [bpy.data.materials.get('Guava lacquer'),bpy.data.materials.get('Warm porcelain')]:
  p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.72;p.inputs['Metallic'].default_value=0
 bpy.data.materials['Guava lacquer'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.48,.7,.58,1)
 light('Large warm window',(-4,-5,8),1200,(1,.83,.66),7,(0,0,0))
 light('Sky fill',(4,1,6),650,(.65,.87,1),6,(0,0,1))
 camloc=(7,-13,9);target=(0,.4,1.65);ortho=12.2
else:
 # Cinematic lunar courier miniature with craters, landing lights and a ringed planet.
 s.world.node_tree.nodes['Background'].inputs[0].default_value=(.012,.018,.035,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.15
 dust=mat('Powdered basalt',(.17,.21,.28),rough=.9);rock=mat('Moon rock',(.25,.3,.39),rough=.92)
 cube('Deep space ground',(0,0,-.6),(200,200,.1),mat('Deep space',(.009,.013,.025),rough=.9),0)
 cyl('Moon fragment',(0,0,-.12),4.7,.40,dust)
 for x,y,r in [(-3.5,1.5,.35),(3.55,1.5,.4),(.3,.7,.45),(-.8,-.6,.38)]:
  cyl('Crater floor',(x,y,.09),r,.025,dark);torus('Crater rim',(x,y,.12),r,.07,rock)
 for i in range(65):
  x=random.uniform(-4.2,4.2);y=random.uniform(-3.4,3.4)
  if x*x+y*y>19 or 1.9 < math.hypot(x,y) < 3.15:continue
  bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=random.uniform(.06,.25),location=(x,y,.16));o=bpy.context.object;o.name='Basalt shard';o.scale.z=random.uniform(.4,1.2);o.data.materials.append(rock)
 orange=mat('Mission orange',(.95,.31,.065),metal=.3);glow=mat('Landing light',(1,.5,.1),emit=4)
 for x,y in [(-3.5,-.65),(3.5,.2)]:
  cyl('Landing beacon',(x,y,.28),.11,.4,gold);uv('Beacon lamp',(x,y,.53),(.1,.1,.07),glow)
 for x,y in [(2.9,2.3),(2.2,2.5)]:
  cube('Cargo crate',(x,y,.4),(.55,.55,.6),orange,.06)
  for dx in [-.19,.19]:cube('Cargo strap',(x+dx,y-.283,.4),(.035,.01,.55),dark,.005)
 segment('Flag pole',(-2.5,2.1,.1),(-2.5,2.1,2.7),.025,gold)
 cube('Mission pennant',(-1.9,2.1,2.38),(1.15,.035,.55),orange,.02)
 text('Lunar label','MOON MAIL',(-1.9,2.07,2.35),.14,cream)
 # Planet hangs above the horizon; rings are modeled geometry.
 uv('Distant planet',(1.25,4.0,3.5),(1.04,)*3,mat('Planet ochre',(.55,.28,.095),rough=.7))
 for r in [1.35,1.42,1.5,1.57]:torus('Planetary ring',(1.25,4,3.5),r,.018,gold,(.3,.12,.1))
 for i in range(45):
  x=random.uniform(-5,5);z=random.uniform(2.3,6)
  uv('Distant star',(x,6,z),(.012,)*3,mat('Starlight '+str(i),(.7,.82,1),emit=2))
 bodymat=bpy.data.materials['Guava lacquer'].node_tree.nodes['Principled BSDF'];bodymat.inputs['Base Color'].default_value=(.72,.8,.84,1);bodymat.inputs['Metallic'].default_value=.28;bodymat.inputs['Roughness'].default_value=.28
 root.location=(0,0,.08);root.rotation_euler=(0,0,0);root.scale=(1.05,)*3
 light('Lunar sunlight',(-6,-4,8),1900,(.63,.77,1),3,(0,0,0))
 light('Golden planetary bounce',(3,4,6),2100,(1,.45,.12),4,(0,0,1))
 light('Suit fill',(1,-7,4),400,(.5,.75,1),4,(0,0,1))
 camloc=(8,-15,8);target=(0,.6,1.9);ortho=14.2
animate_bot('MOMO',os.path.join(ROOT,'assets','showcase_0.bvh' if STYLE=='garden' else 'showcase_1.bvh'),trajectory='arc' if STYLE=='moon' else None)
bpy.ops.object.camera_add(location=camloc);cam=bpy.context.object;s.camera=cam;cam.data.type='ORTHO';cam.data.ortho_scale=ortho;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
s.view_settings.view_transform='AgX';s.render.engine='CYCLES';s.cycles.samples=48;s.cycles.use_denoising=True
from scene_utils import configure_device
configure_device(s);s.render.resolution_x=1600;s.render.resolution_y=1000;s.render.resolution_percentage=100;s.render.fps=24;s.render.fps_base=1;s.frame_start=1;s.frame_end=192
out=os.path.join(ROOT,STYLE);os.makedirs(os.path.join(out,'frames'),exist_ok=True);s.frame_set(96)
s.render.image_settings.file_format='PNG';s.render.filepath=os.path.join(out,'preview.png')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,STYLE+'.blend'))
s.render.resolution_percentage=50;s.cycles.samples=24;bpy.ops.render.render(write_still=True)
