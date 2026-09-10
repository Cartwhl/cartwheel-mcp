"""Localized surface and material cleanup for Saffron's generated face."""
import math
import bpy
import bmesh


def clean_captain_face(obj):
    # Weld duplicated UV-seam vertices before smoothing so surface seams cannot
    # pull apart. BMesh retains corner UVs and vertex deformation weights.
    mesh=obj.data;bm=bmesh.new();bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000002)
    bm.verts.ensure_lookup_table();bm.verts.index_update()
    original=[vertex.co.copy() for vertex in bm.verts]
    region=[vertex for vertex in bm.verts if abs(vertex.co.x)<.082 and 1.455<vertex.co.z<1.515 and vertex.co.y<-.075]
    for _ in range(35):bmesh.ops.smooth_vert(bm,verts=region,factor=.55,use_axis_x=True,use_axis_y=True,use_axis_z=True)
    for vertex in bm.verts:
        x,y,z=original[vertex.index]
        mask=math.exp(-((x/.061)**4+((z-1.488)/.022)**4))*max(0,min(1,(-y-.08)/.025))
        vertex.co=original[vertex.index].lerp(vertex.co,mask)
    bm.to_mesh(mesh);bm.free();mesh.update()
    # The generated UV atlas contains a second painted nose below the geometric
    # nose. Blend that small region to the adjacent cheek's sampled skin tone.
    # A vertex attribute follows the original rig and leaves eye/lip paint intact.
    name='Saffron nose texture cleanup'
    attr=obj.data.color_attributes.new(name=name,type='FLOAT_COLOR',domain='POINT')
    for vertex in obj.data.vertices:
        x,y,z=vertex.co
        tip=math.exp(-((x/.055)**4+((z-1.487)/.011)**4))
        front=max(0,min(1,(-y-.076)/.018))
        mask=min(1,tip*front)
        attr.data[vertex.index].color=(mask,mask,mask,1)
    def linear(c):return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
    skin=tuple(linear(c) for c in (.716,.436,.289))
    for material in obj.data.materials:
        if not material or not material.use_nodes:continue
        nodes=material.node_tree.nodes;links=material.node_tree.links
        shader=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
        old=shader.inputs['Base Color'].links[0].from_socket
        attribute=nodes.new('ShaderNodeVertexColor');attribute.layer_name=name
        mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MIX';mix.inputs[2].default_value=(*skin,1)
        links.new(attribute.outputs['Color'],mix.inputs[0]);links.new(old,mix.inputs[1]);links.new(mix.outputs[0],shader.inputs['Base Color'])
        normal=next((n for n in nodes if n.type=='NORMAL_MAP'),None)
        if normal:
            strength=nodes.new('ShaderNodeMath');strength.operation='MULTIPLY_ADD';strength.inputs[1].default_value=-.30;strength.inputs[2].default_value=.30
            links.new(attribute.outputs['Color'],strength.inputs[0]);links.new(strength.outputs[0],normal.inputs['Strength'])
    obj['face_finishing']='Welded seam vertices; local muzzle-crease smoothing and material cleanup; UV layout and rig retained'
