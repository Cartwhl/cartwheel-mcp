import bpy, math, random, os
from mathutils import Vector
from math import sin,cos,pi
ROOT=os.path.dirname(os.path.abspath(__file__))
import sys
sys.path.insert(0,ROOT)
from scene_utils import mat,cube,uv,cyl,torus,text,empty,segment,place,key,light,configure_device
random.seed(12)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
sc=bpy.context.scene
sc.render.engine='CYCLES'; sc.cycles.samples=32; sc.cycles.use_denoising=True
sc.render.resolution_x=1440; sc.render.resolution_y=900; sc.render.resolution_percentage=100
sc.render.fps=24; sc.frame_start=1; sc.frame_end=192
sc.world.color=(.12,.12,.12)
sc.world.use_nodes=True; sc.world.node_tree.nodes['Background'].inputs[0].default_value=(.045,.067,.12,1); sc.world.node_tree.nodes['Background'].inputs[1].default_value=.35
sc.view_settings.view_transform='AgX'
navy=mat('Midnight enamel',(.025,.05,.085),.35); floor=mat('Indigo terrazzo',(.1,.17,.22),.25,.32); coral=mat('Guava lacquer',(.95,.16,.12),.25); cyan=mat('Lagoon lacquer',(.04,.65,.63),.3); yellow=mat('Marigold lacquer',(1,.58,.065),.25); ivory=mat('Warm porcelain',(.88,.82,.67),.1); chrome=mat('Brushed champagne',(.5,.36,.19),.8); dark=mat('Obsidian rubber',(.012,.018,.027),.15,.24); pink=mat('Hot pink light',(1,.045,.23),emit=4); mint=mat('Mint light',(.08,1,.74),emit=3); goldlight=mat('Honey light',(1,.6,.2),emit=3); green=mat('Plant green',(.045,.3,.16),.1); violet=mat('Lilac',(.45,.24,.67),.25)

# Floating architectural plinth, inlay and a tiled dance floor.
cyl('Floating rooftop base',(0,0,-.32),5.35,.65,navy);cyl('Champagne reveal',(0,0,-.08),5.38,.09,chrome);cyl('Dance terrace',(0,0,0),5.3,.15,floor)
torus('Perimeter LED',(0,0,.04),5.16,.024,mint)
for x in range(-4,5):
 for y in range(-4,5):
  if x*x+y*y<22: cube('Inset floor tile',(x,y,.09),(.96,.96,.026),navy if (x+y)%2 else floor,.02)
for x in [-3,-1,1,3]:cube('Dance floor luminous seam',(x,0,.112),(.014,5.5,.012),goldlight,.003)
# Backdrop/sign frame with luminous concentric arcs.
cube('Backlit sign slab',(0,3.32,3.45),(5.3,.19,1.28),navy,.3)
text('Main sign','AFTER HOURS',(0,3.19,3.48),.53,ivory)
text('Subline','THE LITTLE BIG GROOVE',(0,3.18,3.12),.145,goldlight)
for x in [-2.1,2.1]:segment('Sign support',(x,3.4,.1),(x,3.4,3.2),.045,chrome)
for r,m in [(3.2,pink),(3.45,chrome)]:torus('Halo portal',(0,3.65,2.25),r,.035,m,(pi/2,0,0))
# Speakers.
for x in [-3.65,3.65]:
 cube('Hi-fi cabinet',(x,2.2,.91),(.85,.65,1.6),navy,.12)
 for z,r in [(.65,.29),(1.25,.17)]:
  o=cyl('Woofer surround',(x,1.85,z),r,.05,chrome);o.rotation_euler.x=pi/2
  o=cyl('Speaker cone',(x,1.81,z),r*.82,.055,dark);o.rotation_euler.x=pi/2
  uv('Driver cap',(x,1.76,z),(r*.35,.04,r*.35),navy)
 for j in range(3):cube('Speaker status light',(x-.1+j*.1,1.845,1.56),(.04,.02,.025),mint,.005)
# Record console.
cube('DJ console',(1.8,1.6,1.01),(1.65,.9,.25),ivory,.09)
for x in [1.13,2.47]:
 for y in [1.3,1.9]:segment('Console leg',(x,y,.12),(x,y,.9),.045,chrome)
records=[]
for x in [1.34,2.25]:
 cyl('Turntable deck',(x,1.6,1.16),.31,.035,navy)
 records.append(cyl('Spinning vinyl',(x,1.6,1.19),.26,.018,dark));cyl('Record label',(x,1.6,1.21),.085,.01,coral)
 for r in [.14,.18,.22]:torus('Vinyl groove',(x,1.6,1.203),r,.0015,chrome)
 segment('Tonearm',(x+.25,1.81,1.22),(x+.11,1.59,1.25),.012,chrome)
for j in range(5):cube('Mixer fader',(1.8,1.38+j*.085,1.16),(.12,.025,.022),dark,.01)
# Plants, drinks, party objects.
for x,y in [(-4,-.7),(4,.2),(-2.9,3.1)]:
 cyl('Stoneware planter',(x,y,.31),.29,.46,coral if x<0 else ivory)
 for j in range(7):
  a=j*2.4;end=(x+.33*cos(a),y+.33*sin(a),.9+random.random()*.6)
  segment('Botanical stem',(x,y,.43),end,.016,green)
  leaf=uv('Sculptural leaf',end,(.13,.055,.36),green);leaf.rotation_euler=(.4*cos(a),.5*sin(a),a)
# Foreground cocktail table and a tiny boombox.
cyl('Side table top',(-3,-2,.87),.54,.08,ivory);segment('Pedestal',(-3,-2,.12),(-3,-2,.85),.065,chrome);cyl('Pedestal foot',(-3,-2,.16),.28,.06,navy)
for x,y in [(-3.18,-2),(-2.8,-1.95)]:
 cyl('Party cup',(x,y,1.06),.09,.28,coral if x<-3 else cyan);segment('Striped straw',(x,y,1.1),(x+.045,y,1.39),.012,ivory)
cube('Portable boombox',(2.85,-2.15,.48),(1.08,.34,.62),yellow,.08)
for x in [2.52,3.18]:
 o=cyl('Boombox speaker',(x,-2.34,.48),.22,.035,dark);o.rotation_euler.x=pi/2
 torus('Boombox ring',(x,-2.37,.48),.17,.015,chrome,(pi/2,0,0))
cube('Boombox handle',(2.85,-2.15,.89),(.62,.06,.08),chrome,.025)
for x in [2.57,3.13]:cube('Handle riser',(x,-2.15,.79),(.06,.06,.22),chrome,.02)
# Characters: articulated enamel toy robots with lit faces and headphones.
bots=[]
for idx,(name,pos,size,color) in enumerate([('PIP',(-1.85,-.35,.13),.86,cyan),('MOMO',(.0,-1.05,.13),1.05,coral),('DOT',(1.9,2.05,.103),.79,yellow)]):
 root=empty(name,pos);root.scale=(size,)*3
 body=cube(name+' torso',(0,0,1.29),(.68,.43,.68),color,.15,root)
 torso=empty(name+' chest assembly');torso.parent=root
 cube('Chest inset',(0,-.232,0),(.38,.04,.28),dark,.065,torso)
 for j in range(3):cube('Heartbeat bars',(-.105+j*.105,-.259,0),(.055,.013,.08+j*.04),mint,.013,torso)
 head=empty(name+' head');head.parent=root
 cube('Rounded helmet',(0,0,0),(.84,.59,.63),color,.18,head)
 cube('Dark glass face',(0,-.286,-.025),(.69,.08,.38),dark,.12,head)
 eyes=[]
 for x in [-.18,.18]:eyes.append(uv('Friendly luminous eye',(x,-.338,.025),(.047,.016,.076),mint,head))
 # Smiling three-part pixel mouth.
 for x,z in [(-.07,-.105),(0,-.125),(.07,-.105)]:cube('Pixel smile',(x,-.335,z),(.047,.018,.025),goldlight,.01,head)
 for x in [-.47,.47]:
  o=cyl('Headphone cushion',(x,0,0),.19,.12,dark,head);o.rotation_euler.y=pi/2
  o=cyl('Headphone shell',(x*1.12,0,0),.15,.08,chrome,head);o.rotation_euler.y=pi/2
 torus('Headphone band',(0,0,.02),.46,.035,chrome,(pi/2,0,0),head)
 segment('Antenna',(0,0,.3),(0,0,.51),.022,chrome,head);uv('Antenna pearl',(0,0,.54),(.065,)*3,pink,head)
 limbs={}
 for side in [-1,1]:
  limbs[side]={}
  for joint in ['shoulder','elbow','wrist','hip','knee','ankle']:
   limbs[side][joint]=uv(name+' '+joint,(0,0,0),(.105,)*3,chrome,root)
  for limb in ['upperarm','forearm','thigh','shin']:
   limbs[side][limb]=cyl(name+' '+limb,(0,0,0),.105 if 'arm' in limb else .13,1,color,root)
  limbs[side]['hand']=uv('Mitten hand',(0,0,0),(.14,.115,.15),ivory,root)
  limbs[side]['shoe']=cube('Dancing sneaker',(0,0,0),(.31,.48,.21),ivory,.085,root)
 bots.append((root,body,torso,head,eyes,limbs,idx))
# Floating mirrored disco ornament and decorative satellites.
disco=empty('Orbiting disco ball',(-2.8,1.9,3.6));uv('Disco core',(0,0,0),(.47,)*3,chrome,disco)
for i in range(10):
 lat=pi*(i+.5)/10
 for j in range(20):
  a=2*pi*j/20;v=Vector((sin(lat)*cos(a),sin(lat)*sin(a),cos(lat)))
  o=cube('Mirror mosaic',v*.48,(.115,.012,.115),chrome if (i+j)%3 else ivory,.006,disco);o.rotation_euler=v.to_track_quat('Y','Z').to_euler()
segment('Disco suspension',(-2.8,1.9,4.15),(-2.8,1.9,5),.012,chrome)
floaters=[]
for i in range(22):
 a=random.uniform(0,2*pi);r=random.uniform(3.5,4.7);z=random.uniform(1.8,4.8)
 o=uv('Floating party pearl',(r*cos(a),r*sin(a),z),(.06+random.random()*.07,)*3,[coral,cyan,yellow,violet][i%4]);floaters.append((o,o.location.copy(),i))
# Lighting and camera.
light('Warm softbox',(-5,-6,9),1600,(1,.78,.56),7,(0,0,1))
light('Cool fill',(6,-2,6),1300,(.32,.7,1),6,(0,0,1))
light('Pink rim',(-1,5,6),2000,(1,.13,.35),5,(0,0,1))
light('Top silk',(0,0,10),900,(1,.91,.76),5,(0,0,0))
# Infinite matte background beneath the floating set.
cube('Backdrop',(0,0,-.85),(200,200,.1),mat('Backdrop ink',(.018,.035,.055),rough=.65),0)
bpy.ops.object.camera_add(location=(9,-16,10));cam=bpy.context.object;sc.camera=cam;cam.data.type='ORTHO';cam.data.ortho_scale=13.8;cam.data.lens=48
# Timeline: continuous dance with individually posed arms and planted alternate feet.
for f in range(1,194):
 sc.frame_set(f);t=(f-1)/24;w=2*pi*t
 for root,body,torso,head,eyes,limbs,i in bots:
  phase=w+ i*1.7; bounce=.07*(1-cos(2*phase));sway=.10*sin(phase)
  root.rotation_euler.z=.08 if i==2 else .07*sin(phase*.5)+(-.1 if i==0 else 0);key(root)
  if i==2:bounce=.025*(1-cos(2*phase))
  body.location=(sway,0,1.29+bounce);body.rotation_euler=(.04*sin(phase),.1*sin(phase),0);key(body)
  torso.location=(sway,0,1.29+bounce);torso.rotation_euler=body.rotation_euler;key(torso)
  head.location=(sway+.025*sin(phase),0,1.94+bounce);head.rotation_euler=(.04*cos(phase),.11*sin(phase+.4),.13*sin(phase*.5));key(head)
  for eye in eyes:eye.scale.z=.076*(.18 if (f+i*23)%91 in [0,1,2] else 1);key(eye)
  for side,L in limbs.items():
   p=phase+(pi if side<0 else 0);lift=max(0,sin(p))*.16
   hip=(sway+side*.23,0,1.03+bounce);ankle=(side*.28+.06*sin(p),-.05-.09*max(0,sin(p)),.16+lift);knee=((hip[0]+ankle[0])/2,-.11-.10*max(0,sin(p)),.60+lift*.4)
   if i==2:
    lift=0;ankle=(side*.28,-.05,.145);knee=((hip[0]+ankle[0])/2,-.18,.58+bounce*.4)
   shoulder=(sway+side*.43,0,1.54+bounce)
   if i==2:
    elbow=(sway+side*.49,-.22,1.32+bounce);wrist=(side*.3,-.58,1.28+.10*sin(p))
   else:
    elbow=(sway+side*(.64+.09*sin(p)),-.06,1.26+.22*sin(p)+bounce)
    wrist=(sway+side*(.79+.1*cos(p)),-.2,1.50+.44*sin(p)+bounce)
   points=dict(hip=hip,knee=knee,ankle=ankle,shoulder=shoulder,elbow=elbow,wrist=wrist)
   for n,v in points.items():L[n].location=v;key(L[n])
   for n,a,b in [('thigh',hip,knee),('shin',knee,ankle),('upperarm',shoulder,elbow),('forearm',elbow,wrist)]:place(L[n],a,b);key(L[n])
   L['hand'].location=wrist;key(L['hand']);L['shoe'].location=(ankle[0],ankle[1]-.095,ankle[2]-.04);L['shoe'].rotation_euler.x=0 if i==2 else -.17*max(0,sin(p));key(L['shoe'])
 for o,loc,i in floaters:o.location=loc+Vector((.06*sin(t+i),.06*cos(t+i),.12*sin(w*.25+i)));key(o)
 disco.rotation_euler.z=t*.32;key(disco)
 for o in records:o.rotation_euler.z=t*3.5;key(o)
 a=.045*sin(2*pi*t/8);cam.location=(9*cos(a)-(-16)*sin(a),9*sin(a)-16*cos(a),10+.22*sin(2*pi*t/8));cam.rotation_euler=(Vector((0,.5,1.8))-cam.location).to_track_quat('-Z','Y').to_euler();key(cam)
sc.frame_end=192;sc.frame_set(33)
sc.render.image_settings.file_format='PNG';sc.render.filepath=os.path.join(ROOT,'preview.png')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'after_hours.blend'))
import sys
sys.path.insert(0,ROOT)
from scene_utils import configure_device
configure_device(sc)
sc.render.resolution_percentage=65
bpy.ops.render.render(write_still=True)
print('SCENE_READY')
