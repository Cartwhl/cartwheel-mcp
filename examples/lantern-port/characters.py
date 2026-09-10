"""Import the selected body performances, retaining timing and horizontal travel."""
import json,math
from pathlib import Path
import bpy
from mathutils import Vector
from face_material import clean_captain_face
from contacts import bake_contacts,world_vertices


def finish_boot_soles(rig,meshes):
    """Keep these three work-boot soles rigid, with a soft blend into the uppers."""
    rig.data.pose_position='REST';bpy.context.view_layer.update();changed=0
    for obj in meshes:
        vertices=world_vertices(obj,bpy.context.evaluated_depsgraph_get())
        for side in ('left','right'):
            ankle=obj.vertex_groups[side+'_ankle'];foot=obj.vertex_groups[side+'_foot']
            selected=[v for v in obj.data.vertices if sum(g.weight for g in v.groups if g.group in (ankle.index,foot.index))>.4]
            low=min(vertices[v.index,2]for v in selected)
            for vertex in selected:
                t=max(0,min(1,(vertices[vertex.index,2]-low-.015)/.035));alpha=1-t*t*(3-2*t)
                if alpha<=0:continue
                old={g.group:g.weight for g in vertex.groups}
                for index,weight in old.items():
                    value=weight*(1-alpha)+(alpha if index==ankle.index else 0)
                    if value:obj.vertex_groups[index].add([vertex.index],value,'REPLACE')
                    else:obj.vertex_groups[index].remove([vertex.index])
                if ankle.index not in old:ankle.add([vertex.index],alpha,'REPLACE')
                changed+=1
        obj['boot_sole_finishing']='Rigid ankle weights below 15 mm, smooth blend to original weights by 50 mm above the sole'
    rig.data.pose_position='POSE';bpy.context.view_layer.update();return changed


def action_curves(action):
    for layer in action.layers:
        for strip in layer.strips:
            for slot in action.slots:
                bag=strip.channelbag(slot)
                if bag:
                    yield from bag.fcurves


def import_characters(asset_dir, cast_file):
    scene=bpy.context.scene;scene.render.fps=24
    cast=json.loads(Path(cast_file).read_text())
    reports=[]
    for spec in cast:
        slug=spec['slug'];file=Path(asset_dir)/spec['file']
        if not file.is_file():raise FileNotFoundError(f'Missing reviewed character animation: {file}')
        before=set(scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(file))
        imported=set(scene.objects)-before
        rigs=[obj for obj in imported if obj.type=='ARMATURE']
        if len(rigs)!=1:raise ValueError(f'{slug}: expected one generated character rig, got {len(rigs)}')
        rig=rigs[0]
        # glTF also creates a hidden icosphere for bone display. It is not skin
        # geometry and must not enter the character's height or floor bounds.
        meshes=[obj for obj in imported if obj.type=='MESH' and any(mod.type=='ARMATURE' for mod in obj.modifiers)]
        if not meshes:raise ValueError(f'{slug}: no skinned mesh in the export')
        parent=bpy.data.objects.new(f'{slug} placement',None);scene.collection.objects.link(parent)
        parent['cast_member']=slug
        for obj in imported:
            obj['cast_member']=slug
            if obj.parent not in imported:obj.parent=parent
            if obj.type=='MESH' and obj not in meshes:obj.hide_render=True
        actions={obj.animation_data.action for obj in imported if obj.animation_data and obj.animation_data.action}
        if not actions:raise ValueError(f'{slug}: the selected GLB has no body animation')
        offset=spec['clip_start_seconds']*scene.render.fps
        for action in actions:
            if action.frame_range[1] < offset+scene.frame_end-1:
                raise ValueError(f'{slug}: requested eight-second excerpt extends beyond the captured performance')
            # A trim is a uniform time translation, not a change of playback rate.
            for curve in action_curves(action):
                for point in curve.keyframe_points:
                    point.co.x-=offset;point.handle_left.x-=offset;point.handle_right.x-=offset
                curve.update()
        rig.data.pose_position='REST';scene.frame_set(1);bpy.context.view_layer.update()
        corners=[obj.matrix_world@Vector(corner) for obj in meshes for corner in obj.bound_box]
        low=min(v.z for v in corners);high=max(v.z for v in corners)
        scale=spec['height']/(high-low)
        parent.scale=(scale,)*3;parent.rotation_euler.z=math.radians(spec['yaw_degrees'])
        rig.data.pose_position='POSE';bpy.context.view_layer.update()
        # These are independently selected takes cast into a new scene, not a
        # reconstruction of the original performers' spatial interaction.
        root=rig.matrix_world@rig.pose.bones['pelvis'].head
        parent.location.x=spec['position'][0]-root.x
        parent.location.y=spec['position'][1]-root.y
        bpy.context.view_layer.update()
        floor=min((obj.matrix_world@Vector(corner)).z for obj in meshes for corner in obj.bound_box)
        parent.location.z=spec['position'][2]-floor
        for obj in meshes:
            bpy.context.view_layer.objects.active=obj
            if obj.data.has_custom_normals:bpy.ops.mesh.customdata_custom_splitnormals_clear()
            for polygon in obj.data.polygons:polygon.use_smooth=True
            for modifier in obj.modifiers:
                if modifier.type=='ARMATURE':modifier.use_deform_preserve_volume=True
            for material in obj.data.materials:
                if not material or not material.use_nodes:continue
                for node in material.node_tree.nodes:
                    if node.type=='BSDF_PRINCIPLED':
                        node.inputs['Roughness'].default_value=.72
                        node.inputs['Specular IOR Level'].default_value=.25
                    elif node.type=='NORMAL_MAP':node.inputs['Strength'].default_value=.30
        if slug=='captain':
            for obj in meshes:clean_captain_face(obj)
        report={'character':slug,'asset':file.name,'bones':len(rig.data.bones),'skin_meshes':len(meshes),'rest_height':high-low,'scale':scale,'clip_start_seconds':spec['clip_start_seconds'],'source_duration_seconds':spec['source_duration_seconds'],'placement':list(parent.location),'volume_preserving_skinning':True,'recomputed_mesh_normals':True}
        report['finished_boot_vertices']=finish_boot_soles(rig,meshes)
        report['contact_ik']=bake_contacts(scene,rig,parent,meshes,.120)
        reports.append(report);print('CHARACTER_READY',json.dumps(report))
    return reports
