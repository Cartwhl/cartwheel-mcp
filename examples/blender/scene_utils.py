import bpy, math
from mathutils import Vector
from math import pi
sc=bpy.context.scene
def mat(n,c,metal=0,rough=.35,emit=0):
 m=bpy.data.materials.new(n); m.diffuse_color=(*c,1); m.use_nodes=True; p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*c,1); p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 if emit:p.inputs['Emission Color'].default_value=(*c,1);p.inputs['Emission Strength'].default_value=emit
 return m

def finish(o,n,m,parent=None):
 o.name=n
 if m:o.data.materials.append(m)
 if parent:o.parent=parent
 return o

def cube(n,loc,scale,m,bevel=.1,parent=None):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=finish(bpy.context.object,n,m,parent);o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel: b=o.modifiers.new('Soft manufactured edges','BEVEL');b.width=bevel;b.segments=3;o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
 return o

def uv(n,loc,scale,m,parent=None):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,location=loc);o=finish(bpy.context.object,n,m,parent);o.scale=scale
 for p in o.data.polygons:p.use_smooth=True
 return o

def cyl(n,loc,r,depth,m,parent=None):
 bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=r,depth=depth,location=loc);o=finish(bpy.context.object,n,m,parent)
 b=o.modifiers.new('Edge glints','BEVEL');b.width=.035;b.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o

def torus(n,loc,r,t,m,rot=(0,0,0),parent=None):
 bpy.ops.mesh.primitive_torus_add(major_segments=80,minor_segments=12,location=loc,major_radius=r,minor_radius=t,rotation=rot);o=finish(bpy.context.object,n,m,parent)
 for p in o.data.polygons:p.use_smooth=True
 return o

def text(n,body,loc,size,m):
 cu=bpy.data.curves.new(n,'FONT');cu.body=body;cu.align_x='CENTER';cu.size=size;cu.extrude=.006;cu.bevel_depth=.002
 o=bpy.data.objects.new(n,cu);sc.collection.objects.link(o);o.location=loc;o.rotation_euler=(pi/2,0,0);cu.materials.append(m);return o

def empty(n,loc=(0,0,0)):
 o=bpy.data.objects.new(n,None);sc.collection.objects.link(o);o.location=loc;return o

def segment(n,a,b,r,m,parent=None):
 o=cyl(n,(0,0,0),r,1,m,parent); place(o,a,b);return o

def place(o,a,b):
 a,b=Vector(a),Vector(b);o.location=(a+b)/2;o.rotation_mode='QUATERNION';o.rotation_quaternion=(b-a).to_track_quat('Z','Y');o.scale.z=(b-a).length

def key(o):
 o.keyframe_insert(data_path='location');o.keyframe_insert(data_path='rotation_quaternion' if o.rotation_mode=='QUATERNION' else 'rotation_euler');o.keyframe_insert(data_path='scale')

def light(n,loc,power,color,size,target):
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=n;o.data.energy=power;o.data.color=color;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()


def configure_device(scene):
 import os
 device=os.environ.get('CARTWHEEL_RENDER_DEVICE','CPU').upper()
 if device=='CPU':
  scene.cycles.device='CPU'
  return
 preferences=bpy.context.preferences.addons['cycles'].preferences
 preferences.compute_device_type=device
 preferences.get_devices()
 enabled=False
 for item in preferences.devices:
  item.use=item.type==device
  enabled=enabled or item.use
 if not enabled:
  raise RuntimeError('Requested Cycles device is unavailable: '+device)
 scene.cycles.device='GPU'
