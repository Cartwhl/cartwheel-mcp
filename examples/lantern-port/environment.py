"""Lantern Port: an authored miniature set for three Cartwheel characters.

Called by scene.py in Blender 5.2. Character imports and animation are separate
from the environment, machinery and cameras.
"""
import bpy
import math
import random
from pathlib import Path
from mathutils import Vector
from render_settings import configure_render

random.seed(23)

def material(name, color, rough=.45, metal=0, noise=0, emission=0, scale=30):
    mat=bpy.data.materials.new(name);mat.diffuse_color=(*color,1);mat.use_nodes=True
    n=mat.node_tree.nodes;l=mat.node_tree.links;p=n.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    if emission:
        p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
    if noise:
        tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=scale;tex.inputs['Detail'].default_value=3;tex.inputs['Roughness'].default_value=.7
        bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.28;bump.inputs['Distance'].default_value=noise
        l.new(tex.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs['Normal'],p.inputs['Normal'])
        ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.16;ramp.color_ramp.elements[0].color=(*(v*.66 for v in color),1)
        ramp.color_ramp.elements[1].position=.86;ramp.color_ramp.elements[1].color=(*(min(v*1.15,1) for v in color),1)
        l.new(tex.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs['Color'],p.inputs['Base Color'])
    return mat

def finish(obj,name,mat=None,parent=None):
    obj.name=name
    if mat:obj.data.materials.append(mat)
    if parent:obj.parent=parent
    if obj.type=='MESH':
        for poly in obj.data.polygons:poly.use_smooth=True
    return obj

def cube(name,loc,size,mat,bevel=.04,parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);obj=bpy.context.object;obj.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=obj.modifiers.new('Crafted edge radii','BEVEL');mod.width=bevel;mod.segments=3
        obj.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
    return finish(obj,name,mat,parent)

def ellipsoid(name,loc,scale,mat,parent=None,segments=48):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=24,radius=1,location=loc)
    obj=bpy.context.object;obj.scale=scale
    return finish(obj,name,mat,parent)

def cylinder(name,a,b,radius,mat,parent=None,vertices=24,radius2=None):
    a=Vector(a);b=Vector(b);delta=b-a
    if radius2 is None:bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=delta.length,location=(a+b)/2)
    else:bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=radius,radius2=radius2,depth=delta.length,location=(a+b)/2)
    obj=bpy.context.object;obj.rotation_euler=delta.to_track_quat('Z','Y').to_euler()
    return finish(obj,name,mat,parent)

def line(name,points,radius,mat,parent=None,cyclic=False):
    curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.resolution_u=16
    spl=curve.splines.new('POLY');spl.points.add(len(points)-1)
    for point,co in zip(spl.points,points):point.co=(*co,1)
    spl.use_cyclic_u=cyclic;curve.bevel_depth=radius;curve.bevel_resolution=3
    obj=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(obj)
    return finish(obj,name,mat,parent)

def ring(name,center,radius,mat,tube=.018,plane='XY',parent=None):
    points=[]
    for i in range(96):
        u=math.tau*i/96
        point={'XY':(radius*math.cos(u),radius*math.sin(u),0),'XZ':(radius*math.cos(u),0,radius*math.sin(u)),'YZ':(0,radius*math.cos(u),radius*math.sin(u))}[plane]
        points.append(tuple(center[k]+point[k] for k in range(3)))
    return line(name,points,tube,mat,parent,True)

def empty(name,loc=(0,0,0)):
    obj=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(obj);obj.location=loc;return obj

def light(name,loc,color,power,size=3,kind='AREA',target=None,parent=None):
    data=bpy.data.lights.new(name,kind);data.energy=power;data.color=color
    if kind=='AREA':data.shape='DISK';data.size=size
    else:data.shadow_soft_size=size
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);obj.location=loc
    if target:point_at(obj,target)
    if parent:obj.parent=parent
    return obj

def point_at(obj,target):obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()

def text_obj(text,loc,size,mat,rotation=(math.pi/2,0,0),name=None):
    data=bpy.data.curves.new(name or text,'FONT');data.body=text;data.align_x='CENTER';data.size=size;data.extrude=.0018;data.bevel_depth=.0008
    obj=bpy.data.objects.new(name or text,data);bpy.context.collection.objects.link(obj);obj.location=loc;obj.rotation_euler=rotation;data.materials.append(mat);return obj

def lantern(name,pos,scale,mats,parent=None,lit=True):
    x,y,z=pos;metal=mats['brass'];glass=mats['glow']
    cylinder(name+' base',(x,y,z-.16*scale),(x,y,z-.12*scale),.12*scale,metal,parent)
    ellipsoid(name+' luminous glass',(x,y,z),(.095*scale,.095*scale,.15*scale),glass,parent,32)
    cylinder(name+' cap',(x,y,z+.12*scale),(x,y,z+.19*scale),.13*scale,metal,parent,radius2=.08*scale)
    for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]:cylinder(name+' guard',(x+dx*.107*scale,y+dy*.107*scale,z-.13*scale),(x+dx*.107*scale,y+dy*.107*scale,z+.14*scale),.009*scale,metal,parent,12)
    ring(name+' handle',(x,y,z+.23*scale),.065*scale,metal,.007*scale,'XZ',parent)
    if lit:light(name+' warm pool',(x,y,z),(1,.46,.15),10*scale,scale*.13,'POINT',parent=parent)

def cliff(name,loc,scale,mat):
    n=40;levels=[(0,1),(-.35,1.015),(-1.05,.92),(-1.75,.77),(-2.5,.53),(-3.25,.28),(-3.7,.11)]
    verts=[];faces=[]
    noise=[random.uniform(.82,1.12) for _ in range(n)]
    for j,(z,radius) in enumerate(levels):
        for i in range(n):
            a=i*math.tau/n;r=radius*noise[i]*random.uniform(.96,1.04)
            verts.append((loc[0]+scale[0]*r*math.cos(a),loc[1]+scale[1]*r*math.sin(a),loc[2]+scale[2]*(z+random.uniform(-.09,.09))))
    for j in range(len(levels)-1):
        for i in range(n):
            a=j*n+i;b=j*n+(i+1)%n;c=b+n;d=a+n
            if (i+j)%2:faces.extend([(a,b,d),(b,c,d)])
            else:faces.extend([(a,b,c),(a,c,d)])
    faces.append(tuple(range(n-1,-1,-1)));faces.append(tuple((len(levels)-1)*n+i for i in range(n)))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj);obj.data.materials.append(mat)
    bevel=obj.modifiers.new('Eroded basalt edges','BEVEL');bevel.width=.09*scale[2];bevel.segments=2
    obj.modifiers.new('Cliff weighted normals','WEIGHTED_NORMAL')
    return obj

def build_scene():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for c in list(bpy.data.collections):
        if not c.objects and c.name!='Collection':bpy.data.collections.remove(c)
    scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=192;scene.render.fps=24
    configure_render(scene)
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.7
    scene.world=bpy.data.worlds.new('Blue hour beyond the port');scene.world.use_nodes=True
    bg=scene.world.node_tree.nodes.get('Background');bg.inputs['Color'].default_value=(.12,.21,.32,1);bg.inputs['Strength'].default_value=.35
    m={}
    m['brass']=material('Hand-worked antique brass',(.40,.23,.07),.28,.72,.004,scale=22)
    m['dark']=material('Midnight blue painted iron',(.021,.045,.061),.32,.38,.006)
    m['teal']=material('Deep teal enamel',(.025,.20,.19),.31,.22,.003)
    m['cream']=material('Ivory painted lettering',(.82,.74,.51),.48,noise=.002)
    m['wood']=material('Oiled teak with weathered grain',(.18,.077,.028),.42,noise=.018,scale=16)
    m['rope']=material('Twisted hemp rope',(.37,.24,.095),.9,noise=.012,scale=110)
    m['rock']=material('Weathered basalt cliff',(.06,.086,.097),.9,noise=.085,scale=5)
    m['moss']=material('Velvet moss in stone cracks',(.052,.13,.085),.94,noise=.04,scale=22)
    m['glow']=material('Warm lantern glass',(1,.46,.12),.24,emission=3.4)
    m['window']=material('Honey light inside the station',(1,.52,.20),.26,emission=1.2)
    m['balloon']=material('Ivory aerostat linen',(.64,.57,.38),.71,noise=.018,scale=125)
    m['stripe']=material('Aged teal aerostat linen',(.026,.18,.18),.59,noise=.015,scale=115)
    m['red']=material('Oxide red pennant cloth',(.41,.055,.025),.72,noise=.009)
    cliff('Stratified floating basalt island',(0,.25,-.38),(5.58,2.95,1.0),m['rock'])
    cube('Dock structural ring',(0,0,-.18),(10.8,5.7,.38),m['dark'],.20)
    for i in range(38):
        x=-5.10+i*.276
        boardmat=material('Teak plank %02d'%i,tuple(c*random.uniform(.88,1.12) for c in (.146,.07008,.03285)),.56,noise=.012,scale=24)
        cube('Individual teak deck plank',(x,0,.045),(.257,5.38,.15),boardmat,.025)
        for y in [-2.43,2.43]:
            cylinder('Countersunk deck bolt',(x,y,.119),(x,y,.129),.014,m['brass'],vertices=12)
    for x in [-5.34,5.34]:cube('Rounded gunwale',(x,0,.13),(.12,5.5,.17),m['brass'],.045)
    for y in [-2.7,2.7]:cube('End gunwale',(0,y,.13),(10.7,.12,.17),m['brass'],.045)
    # Landing lane markings and an inset compass medallion.
    for x in [-2.35,2.35]:
        for y in [-1.9,-1.25,-.6,.05,.7,1.35]:cube('Docking lane dash',(x,y,.1200),(.09,.35,.0002),m['cream'],.00005)
    inlay=ring('Inlaid compass circle',(0,-1.10,0),.53,m['brass'],.016)
    inlay.location.z=.1199;inlay.scale.z=.025
    for a in range(8):
        u=a*math.pi/4
        spoke=line('Compass spoke',[(.13*math.cos(u),-1.10+.13*math.sin(u),0),(.44*math.cos(u),-1.10+.44*math.sin(u),0)],.009,m['brass'])
        spoke.location.z=.1199;spoke.scale.z=.025
    text_obj('LANTERN  PORT',(0,-2.777,-.19),.38,m['cream'],name='Port name on dock fascia')
    text_obj('AIR MAIL  /  BERTH 03',(0,-2.781,-.48),.105,m['cream'])
    # Railings leave an open front and a ship approach corridor.
    for x in [-5.05,5.05]:
        for y in [-2.3,-.9,.5,2.1]:
            cylinder('Turned railing post',(x,y,.14),(x,y,1.03),.045,m['dark'])
            ellipsoid('Brass railing finial',(x,y,1.055),(.07,.07,.07),m['brass'],segments=24)
        for z in [.50,.92]:line('Rail cable',[(x,-2.3,z),(x,-.9,z-.035),(x,.5,z-.035),(x,2.1,z)],.018,m['rope'])
    # Station hut: layered construction, warm windows, dimensional sign.
    bx,by=3.65,1.25
    cube('Station foundation',(bx,by,.21),(2.23,2.1,.2),m['dark'],.07)
    cube('Station body',(bx,by,1.50),(2.04,1.85,2.45),m['teal'],.065)
    for x in [bx-1.03,bx+1.03]:cube('Hut corner trim',(x,by-1,1.55),(.10,.12,2.55),m['brass'],.025)
    for z in [1.0,1.55,2.1]:
        cube('Horizontal siding seam',(bx,by-.934,z),(1.95,.012,.023),m['dark'],.003)
    for x in [bx-.55,bx+.55]:
        cube('Window surround',(x,by-.97,1.77),(.84,.10,.98),m['brass'],.05)
        cube('Glowing frosted window',(x,by-1.032,1.77),(.71,.035,.83),m['window'],.04)
        cube('Window mullion',(x,by-1.06,1.77),(.037,.025,.84),m['dark'],.008)
        cube('Window transom',(x,by-1.063,1.77),(.70,.025,.031),m['dark'],.008)
    cube('Window sill',(bx,by-1.07,1.25),(2.12,.22,.11),m['wood'],.025)
    cube('Roof cornice',(bx,by,2.78),(2.37,2.13,.18),m['dark'],.06)
    for side in [-1,1]:
        roof=cube('Patinated standing-seam roof',(bx+side*.62,by,3.0),(1.43,2.38,.12),m['dark'],.025);roof.rotation_euler.y=side*math.radians(19)
        for y in [by-1.03+i*.255 for i in range(9)]:
            a=(bx, y,3.25);b=(bx+side*1.27,y,2.82)
            cylinder('Roof copper standing seam',a,b,.014,m['brass'],vertices=10)
    cylinder('Roof ridge',(bx,by-1.18,3.25),(bx,by+1.18,3.25),.038,m['brass'])
    cube('Station sign backing',(bx,by-1.025,2.64),(1.9,.14,.42),m['dark'],.045)
    text_obj('POSTE AERIENNE',(bx,by-1.105,2.60),.15,m['cream'])
    light('Warm station spill',(bx,by-1.17,1.7),(1,.56,.26),105,1.6,target=(1,-1,1))
    cylinder('Chimney',(bx+.66,by+.44,3.0),(bx+.66,by+.44,3.95),.12,m['dark'])
    cylinder('Chimney rain cap',(bx+.66,by+.44,3.98),(bx+.66,by+.44,4.05),.20,m['brass'])
    # Small working objects make the dock feel inhabited.
    for x,y,s in [(-4.2,1.6,.75),(-3.45,1.65,.53),(2.55,-1.73,.40)]:
        cube('Riveted mail trunk',(x,y,.14+s*.47),(s,s*.68,s*.93),m['wood'],.06)
        for dx in [-.30,.30]:cube('Luggage brass band',(x+dx*s,y,.14+s*.47),(.045,s*.70,s*.95),m['brass'],.016)
        cube('Trunk latch',(x,y-s*.36,.14+s*.50),(.1,.025,.15),m['brass'],.013)
    for x,y in [(-4.4,-1.8),(4.3,-1.8)]:
        cylinder('Mooring bollard',(x,y,.14),(x,y,.42),.12,m['dark'])
        cylinder('Bollard crossbar',(x-.21,y,.39),(x+.21,y,.39),.061,m['brass'])
        for r in [.26,.29,.32,.35]:ring('Coiled dock line',(x+.25,y+.26,.151),r,m['rope'],.022)
    # Lantern arches give foreground depth without masking faces.
    for x,y,h in [(-4.7,-.7,3.5),(4.85,-1.0,3.3),(-4.8,2.3,3.3)]:
        cylinder('Lantern mast',(x,y,.16),(x,y,h),.062,m['dark'])
        points=[(x,y,h-.25),(x,y,h+.16),(x+.13,y,h+.31),(x+.47,y,h+.31),(x+.64,y,h+.15),(x+.64,y,h-.04)]
        line('Bent brass lamp arm',points,.035,m['brass'])
        lantern('Hanging dock lantern',(x+.64,y,h-.32),1.15,m)
    # Suspended electric bulbs across the back of the pier.
    points=[(-4.8+i*.24,2.4,3.43-.67*math.sin(math.pi*i/40)) for i in range(41)]
    line('Catenary festoon cable',points,.016,m['dark'])
    for i in range(1,40,3):
        x,y,z=points[i];cylinder('Bulb socket',(x,y,z),(x,y,z-.09),.03,m['dark'],vertices=12)
        ellipsoid('Amber festoon bulb',(x,y,z-.13),(.06,.06,.075),m['glow'],segments=24)
    # A hand-built linen airship, with real panels, ribs, rigging and a cabin.
    ship=empty('Airship animated arrival')
    length=3.8;rad=1.35;centerz=1.0
    for panel in range(16):
        verts=[];faces=[]
        for i in range(49):
            theta=.035+(math.pi-.07)*i/48
            xx=-length*math.cos(theta);rr=rad*math.sin(theta)**.73
            for j in range(5):
                angle=math.tau*(panel+j/4)/16
                verts.append((xx,rr*math.cos(angle),centerz+rr*math.sin(angle)))
        for i in range(48):
            for j in range(4):a=i*5+j;faces.append((a,a+1,a+6,a+5))
        mesh=bpy.data.meshes.new('Aerostat stitched panel');mesh.from_pydata(verts,[],faces);mesh.update()
        obj=bpy.data.objects.new('Ivory and teal envelope gore',mesh);bpy.context.collection.objects.link(obj);finish(obj,obj.name,m['stripe'] if panel in [2,3,10,11] else m['balloon'],ship)
        seam=[]
        angle=math.tau*panel/16
        for i in range(65):
            theta=.035+(math.pi-.07)*i/64;rr=rad*math.sin(theta)**.73
            seam.append((-length*math.cos(theta),rr*math.cos(angle),centerz+rr*math.sin(angle)))
        line('Raised linen seam',seam,.010,m['cream'],ship)
    for x in [-2.9,-1.7,0,1.7,2.9]:
        theta=math.acos(-x/length);r=rad*math.sin(theta)**.73
        ring('Aerostat copper hoop',(x,0,centerz),r+.012,m['brass'],.015,'YZ',ship)
    for x in [-3.81,3.81]:ellipsoid('Polished nose cap',(x,0,centerz),(.15,.16,.16),m['brass'],ship,32)
    # Tail fins are sculpted thick fabric vanes.
    for angle in [0,math.pi/2,math.pi,math.pi*1.5]:
        fin=cube('Tail stabilizer',(2.7,math.cos(angle)*1.05,centerz+math.sin(angle)*1.05),(1.6,.08,.76),m['stripe'],.13,ship)
        fin.rotation_euler.x=angle
    gondola=ellipsoid('Teak passenger gondola',(-.3,0,-.92),(1.72,.57,.40),m['wood'],ship)
    cube('Gondola cabin',(-.45,0,-.63),(2.4,.88,.57),m['teal'],.17,ship)
    cube('Cabin brass roof',(-.45,0,-.30),(2.55,1.01,.11),m['brass'],.08,ship)
    for x in [-1.32,-.76,-.20,.36]:
        for y in [-.448,.448]:
            cube('Ship cabin window rim',(x,y,-.61),(.40,.04,.37),m['brass'],.07,ship)
            cube('Ship luminous oval window',(x,y*1.05,-.61),(.30,.016,.27),m['window'],.06,ship)
    for x in [-1.1,.72]:
        for y in [-.9,.9]:cylinder('Tensioned gondola suspension',(x,y,0),(x,y*.43,-.39),.019,m['brass'],ship,12)
    for x in [-1.35,-.50,.35]:lantern('Airship hanging lantern',(x,-.52,-1.23),.78,m,ship,False)
    # Side propellers with visible hubs; rotation is authored machinery.
    for y in [-1.03,1.03]:
        cylinder('Propeller outrigger',(.76,y*.45,-.70),(.76,y,-.70),.052,m['brass'],ship)
        hub=empty('Propeller rotor');hub.parent=ship;hub.location=(.76,y,-.7)
        cylinder('Propeller axle',(-.10,0,0),(.10,0,0),.08,m['brass'],hub)
        for angle in [0,math.pi/2]:
            blade=ellipsoid('Carved wooden propeller blade',(0,0,0),(.034,.075,.58),m['wood'],hub,24);blade.rotation_euler.x=angle
        for frame in [1,192]:hub.rotation_euler.x=(frame-1)*.31;hub.keyframe_insert('rotation_euler',frame=frame)
    for frame,x,y,z,tilt in [(1,-5.7,5.3,6.1,-.03),(58,-2.4,4.55,5.45,-.018),(108,-.45,3.8,5.14,0),(158,-.1,3.6,5.05,.016),(192,0,3.6,5.10,0)]:
        ship.location=(x,y,z);ship.rotation_euler=(0,tilt,-.08);ship.keyframe_insert('location',frame=frame);ship.keyframe_insert('rotation_euler',frame=frame)
    # Beacon landing lights around the floating ledge.
    for i in range(13):
        a=math.pi+.92+3.14*i/12;x=5.7*math.cos(a);y=.5+3.0*math.sin(a)
        ellipsoid('Beacon rivet',(x,y,-.64),(.055,.055,.06),m['glow'],segments=20)
    # Distant islands and cloud banks create a complete world behind every cut.
    haze=material('Distant cloud blue',(.16,.27,.34),1)
    distant=material('Silhouetted distant islands',(.14,.22,.29),1)
    for x,y,z,s in [(-20,43,4,2.8),(23,49,3,3.4),(-8,63,7,2.3),(9,70,5,2.5)]:cliff('Distant fractured island',(x,y,z),(s,s*.6,s*.62),distant)
    # Soft procedural volumes rather than solid cloud spheres.
    cloud=bpy.data.materials.new('Soft layered cloud volume');cloud.use_nodes=True;n=cloud.node_tree.nodes;l=cloud.node_tree.links;n.clear()
    out=n.new('ShaderNodeOutputMaterial');vol=n.new('ShaderNodeVolumePrincipled');vol.inputs['Color'].default_value=(.46,.61,.70,1);vol.inputs['Anisotropy'].default_value=.22
    tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=2.1;tex.inputs['Detail'].default_value=3
    ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.43;ramp.color_ramp.elements[0].color=(0,0,0,1);ramp.color_ramp.elements[1].position=.77;ramp.color_ramp.elements[1].color=(.16,.16,.16,1)
    l.new(tex.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs[0],vol.inputs['Density']);l.new(vol.outputs['Volume'],out.inputs['Volume'])
    for i,(x,y,z,sx,sy,sz) in enumerate([(-11,2,-3.1,8,5,1.9),(9,4,-3,7,5,1.7),(0,8,-4,8,4,1.7),(-11,19,2,8,4,2.0),(14,22,1,9,5,2.3),(-28,37,8,11,4,2.5)]):
        ellipsoid('Cloud bank %02d'%i,(x,y,z),(sx,sy,sz),cloud,segments=24)
    light('Large warm sunset key',(-7,-6,11),(1,.76,.48),2000,8,target=(0,0,1.5))
    light('Cool sky fill',(5,-3,8),(.39,.69,1),1350,7,target=(0,0,2))
    light('Golden ship rim',(-4,9,11),(1,.59,.25),2800,6,target=(0,1,2.7))
    light('Soft face light',(0,-7,4),(1,.85,.68),650,5,target=(0,0,1.4))
    light('Cloud rim light',(-15,18,12),(.60,.78,1),3600,12,target=(0,5,-3))
    # Separate scene cameras provide actual cuts, with small physical dolly moves.
    cameras=[]
    def camera(name,start,end,loc1,loc2,target1,target2,lens,focus):
        data=bpy.data.cameras.new(name);obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj)
        data.lens=lens;data.sensor_width=36;data.clip_end=400;data.dof.use_dof=True;data.dof.aperture_fstop=7.1
        focusobj=empty(name+' focus',focus);data.dof.focus_object=focusobj
        for f,loc,target in [(start,loc1,target1),(end,loc2,target2)]:obj.location=loc;point_at(obj,target);obj.keyframe_insert('location',frame=f);obj.keyframe_insert('rotation_euler',frame=f)
        marker=scene.timeline_markers.new(name,frame=start);marker.camera=obj;cameras.append(obj);return obj
    camera('01 Arrival / wide',1,52,(11,-16,9),(9.5,-15,8.6),(-.7,1.1,2.4),(-.45,1.4,2.6),47,(0,0,2))
    camera('02 Crew / walking',53,112,(5.3,-8.5,3.4),(5.,-8.1,3.2),(-.2,-.1,1.1),(-.1,-.15,1.1),52,(0,-.1,1.1))
    camera('03 Pip / close-up',113,156,(3,-2.5,2),(2.9,-2.3,2),(0,0,1.4),(0,0,1.4),65,(0,0,1.4))
    camera('04 Lantern Port / hero',157,192,(10.3,-14.8,8.5),(13,-17.8,10.0),(0,1.0,2.1),(-.1,1.1,2.1),49,(0,1,2.1))
    scene.camera=cameras[0]
    # Gentle highlight bloom from physical emissive glass.
    comp=bpy.data.node_groups.new('Lantern Port highlight bloom','CompositorNodeTree')
    comp.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor')
    n=comp.nodes;l=comp.links;layers=n.new('CompositorNodeRLayers');glare=n.new('CompositorNodeGlare');glare.inputs['Type'].default_value='Fog Glow';glare.inputs['Quality'].default_value='High';glare.inputs['Strength'].default_value=.20
    out=n.new('NodeGroupOutput');l.new(layers.outputs['Image'],glare.inputs['Image']);l.new(glare.outputs['Image'],out.inputs['Image'])
    scene.compositing_node_group=comp
    scene['title']='LANTERN PORT';scene['character_count']=3;scene['body_animation_source']='Cartwheel Comic 4 and swing-edit';scene['set_and_camera']='Authored in Blender'
    return scene
