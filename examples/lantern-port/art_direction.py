"""Final camera blocking and small environment detail, separate from body motion."""
import bpy,math
from mathutils import Vector

def art_direct():
 scene=bpy.context.scene
 # Keep the nose aligned with the airship's direction of travel.
 ship=bpy.data.objects['Airship animated arrival']
 ship.animation_data_clear()
 for frame,x,y,z,tilt in [(1,-5.5,5.3,5.45,-.03),(58,-2.4,4.55,4.85,-.018),(108,-.45,3.8,4.64,0),(158,-.1,3.6,4.55,.016),(192,0,3.6,4.60,0)]:
  ship.location=(x,y,z);ship.rotation_euler=(0,tilt,math.pi-.08)
  ship.keyframe_insert('location',frame=frame);ship.keyframe_insert('rotation_euler',frame=frame)
 # All cameras are physical scene cameras, including the two closer cutaways.
 def pose(name,frames,locations,targets,lens,focus,fstop):
  c=bpy.data.objects[name];c.animation_data_clear();c.data.lens=lens;c.data.dof.aperture_fstop=fstop
  c.data.dof.focus_object.location=focus
  for frame,loc,target in zip(frames,locations,targets):
   c.location=loc;c.rotation_euler=(Vector(target)-c.location).to_track_quat('-Z','Y').to_euler()
   c.keyframe_insert('location',frame=frame);c.keyframe_insert('rotation_euler',frame=frame)
 pose('01 Arrival / wide',[1,52],[(12,-18,10),(10.8,-17.3,9.4)],[(-.7,1.1,2.25),(-.4,1.2,2.3)],46,(0,0,2),6.3)
 pose('02 Crew / walking',[53,112],[(5.3,-8.5,3.4),(5.,-8.1,3.2)],[(-.2,-.1,1.1),(-.1,-.15,1.1)],52,(0,-.1,1.1),4.)
 pose('04 Lantern Port / hero',[157,192],[(11,-16.2,9.2),(12.6,-18,10.1)],[(0,1.0,2.1),(0,1.0,2.1)],46,(0,1,2.1),6.3)
 # Softer sources retain cloth texture and keep the windows from washing out faces.
 scene.view_settings.exposure=.1
 for name,energy in [('Large warm sunset key',1200),('Cool sky fill',850),('Soft face light',530),('Golden ship rim',2150)]:bpy.data.objects[name].data.energy=energy
 m=bpy.data.materials['Honey light inside the station'].node_tree.nodes.get('Principled BSDF');m.inputs['Emission Strength'].default_value=.75
 bpy.data.objects['Warm station spill'].data.energy=65
 # Readable fascia below the upper gunwale.
 for name in ['Port name on dock fascia','AIR MAIL  /  BERTH 03']:
  o=bpy.data.objects.get(name)
  if o:o.location.y=-2.87
 scene['skin_finishing']='Recomputed mesh normals; original generated normal maps at 0.3; volume-preserving skinning'
 scene.frame_set(90)
 print('ART_DIRECTED')


def frame_frog_closeup():
 """A stabilized portrait follows Pip after the walk settles."""
 from contacts import gaussian
 scene=bpy.context.scene
 rig=next(obj for obj in scene.objects if obj.type=='ARMATURE'and obj.get('cast_member')=='pip')
 targets=[]
 for frame in range(1,193):
  scene.frame_set(frame)
  targets.append(rig.matrix_world@rig.pose.bones['head'].head+Vector((0,0,.16)))
 targets=gaussian(targets,sigma=8)
 camera=bpy.data.objects['03 Pip / close-up'];camera.animation_data_clear()
 focus=camera.data.dof.focus_object;focus.animation_data_clear()
 camera.data.lens=65;camera.data.dof.aperture_fstop=3.2
 for frame in range(113,157):
  target=targets[frame-1];camera.location=target+Vector((2.1,-2.45,.23))
  camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
  camera.keyframe_insert('location',frame=frame);camera.keyframe_insert('rotation_euler',frame=frame)
  focus.location=target;focus.keyframe_insert('location',frame=frame)
