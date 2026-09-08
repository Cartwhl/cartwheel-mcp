"""Prepare the native Cartwheel MHR GLB for the body-motion game reference.

Run with Blender 5 in background mode. Native MHR v1.0.1 correctives are Apache-2.0.
Geometry mapping is checked against reference surface positions and facial deltas;
native bone transforms and skeletal weights are copied without modification.
"""
import argparse
import base64
import json
from pathlib import Path
import struct
import sys

import bpy
import numpy as np
from mathutils import Quaternion
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'comic4'))
from mhr_knees import coordinates, load_model, knee_mask, local_rotation

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--character', type=Path, required=True, help='Native MHR GLB from Cartwheel.')
parser.add_argument('--model-dir', type=Path, required=True, help='Official MHR v1.0.1 assets directory.')
parser.add_argument('--out', type=Path, required=True, help='Output asset directory.')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
character, model_dir, output = args.character.resolve(), args.model_dir.resolve(), args.out.resolve()
if not (model_dir/'LICENSE.txt').is_file():
    raise ValueError('Keep LICENSE.txt with the official MHR assets.')
output.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(character),merge_vertices=True)
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');body=max((o for o in bpy.context.scene.objects if o.type=='MESH'),key=lambda x:len(x.data.vertices))
model=load_model(model_dir)
if any(name not in rig.data.bones or local_rotation(rig.data.bones[name]).rotation_difference(model['rotations'][name]).angle > .001 for name in model['names'][1:]):
    raise ValueError('MHR native joint coordinate frames differ from the released model.')
old=set(bpy.data.objects);bpy.ops.import_scene.fbx(filepath=str(model_dir/'lod1.fbx'),use_anim=False,automatic_bone_orientation=False)
added=set(bpy.data.objects)-old;ref=max((o for o in added if o.type=='MESH'),key=lambda o:len(o.data.vertices));ref_basis=coordinates(ref.data.shape_keys.key_blocks[0].data)
# Facial targets certify topology, coordinate axes and unit scale after UV splitting.
basis=coordinates(body.data.shape_keys.key_blocks[0].data)
scale=(rig.data.bones['l_lowleg'].head_local-rig.data.bones['l_talocrural'].head_local).length / (next(o for o in added if o.type=='ARMATURE').data.bones['l_lowleg'].head_local-next(o for o in added if o.type=='ARMATURE').data.bones['l_talocrural'].head_local).length
kd=KDTree(len(ref_basis))
ref_to_body=np.array(body.matrix_world.inverted()@ref.matrix_world)[:3,:3]
for i,p in enumerate(ref_basis@ref_to_body.T):kd.insert(p,i)
kd.balance();matches=[kd.find(v.co) for v in body.data.vertices];indices=np.array([x[1] for x in matches]);max_dist=max(x[2] for x in matches)
face=np.stack([coordinates(k.data)-basis for k in list(body.data.shape_keys.key_blocks)[46:]])
error=float(np.linalg.norm(face-model['face_deltas'][:,indices]@ref_to_body.T)/np.linalg.norm(face))
if max_dist>.0001 or error>.01 or np.max(np.abs(ref_to_body/scale-np.array([[1,0,0],[0,0,-1],[0,1,0]]))) > 1e-5:raise ValueError(f'Unverified MHR correspondence: {max_dist}, {error}')
for obj in added:bpy.data.objects.remove(obj,do_unlink=True)
# Capture the exact exported bone coordinate basis used by native BVH tracks.
raw=(character).read_bytes();gltf=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
if len(gltf['meshes']) != 1 or len(gltf['skins']) != 1 or gltf.get('images') or gltf.get('animations'):
    raise ValueError('Use the standalone native MHR character GLB without animations or textures.')
a=gltf['accessors'][gltf['meshes'][0]['primitives'][0]['attributes']['POSITION']];v=gltf['bufferViews'][a['bufferView']]
if a['componentType'] != 5126 or a['type'] != 'VEC3' or v.get('byteStride', 12) != 12:
    raise ValueError('Expected native MHR float32 vertex positions.')
bin_start=20+struct.unpack_from('<I',raw,12)[0]+8
raw_pos=np.frombuffer(raw,dtype='<f4',count=a['count']*3,offset=bin_start+v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,3)
raw_z=raw_pos[:,[0,2,1]]*np.array([1,-1,1])
vertex_tree=KDTree(len(basis))
for i,p in enumerate(basis):vertex_tree.insert(p,i)
vertex_tree.balance();raw_matches=[vertex_tree.find(p) for p in raw_z]
if max(x[2] for x in raw_matches)>1e-5:raise ValueError('GLB surface does not match its Blender import')
raw_indices=np.array([x[1] for x in raw_matches])
# Keep the native character's static identity before removing morph targets.
# Blender's glTF loader supplies the decoded targets, including quantization.
mesh_node=next(n for n in gltf['nodes'] if 'mesh' in n)
weights=mesh_node.get('weights',gltf['meshes'][0].get('weights',[]))
keys=list(body.data.shape_keys.key_blocks)[1:]
if len(weights)!=len(keys):
    raise ValueError('MHR default morph weights do not match its targets.')
morphed=basis.copy()
for weight,key in zip(weights,keys):
    if weight:morphed+=float(weight)*(coordinates(key.data)-basis)
body.data.vertices.foreach_set('co',morphed.astype(np.float32).ravel())
mask=knee_mask(body,rig)
support=np.flatnonzero(mask>0)
components=np.flatnonzero(np.any(model['blends'][:,indices[support]]!=0,axis=(1,2)))
native_positions=(morphed[raw_indices][:,[0,2,1]]*np.array([1,1,-1])).astype('<f4')

parents={child:i for i,node in enumerate(gltf['nodes']) for child in node.get('children',[])}
def world_rotation(i):
 n=gltf['nodes'][i];x,y,z,w=n.get('rotation',[0,0,0,1]);q=Quaternion((w,x,y,z))
 return world_rotation(parents[i])@q if i in parents else q
Y_to_Z=Quaternion((1,0,0),np.pi/2)
bone_data=[]
for name in model['names'][1:]:
 i=next(i for i,n in enumerate(gltf['nodes']) if n.get('name')==name)
 raw_world=Y_to_Z@world_rotation(i)
 basis_change=raw_world.inverted()@rig.data.bones[name].matrix_local.to_quaternion()
 n=gltf['nodes'][i];bone_data.append({'name':name,'rest':n.get('rotation',[0,0,0,1]),'basis':[basis_change.x,basis_change.y,basis_change.z,basis_change.w]})
recipe={'source':'MHR v1.0.1 native knee correctives','bones':bone_data,'components':[{'name':f'MHR_Knee_{c:04d}','features':[[int(f),float(model['activation'][c,f])] for f in np.flatnonzero(model['activation'][c])]} for c in components]}
recipe['schemaVersion']=1
z={'deltas':np.stack([(model['blends'][c,indices]*mask[:,None]*scale)[raw_indices] for c in components]),'names':np.array([f'MHR_Knee_{c:04d}' for c in components])}

raw=(character).read_bytes();jlen=struct.unpack_from('<I',raw,12)[0];j=json.loads(raw[20:20+jlen]);bin_start=20+jlen+8;binary=raw[bin_start:]
# Retain only buffers/accessors used by mesh geometry and native skinning.
used=set()
for mesh in j['meshes']:
 for p in mesh['primitives']:
  used.update(p['attributes'].values());used.add(p['indices']);p.pop('targets',None)
for skin in j['skins']:used.add(skin['inverseBindMatrices'])
views=set()
for a in used:
 x=j['accessors'][a]
 if 'sparse' in x:raise ValueError('Unexpected sparse base accessor')
 views.add(x['bufferView'])
newbin=bytearray();viewmap={};newviews=[]
for i in sorted(views):
 v=j['bufferViews'][i];start=v.get('byteOffset',0);data=binary[start:start+v['byteLength']]
 newbin.extend(b'\0'*(-len(newbin)%4));viewmap[i]=len(newviews);newviews.append({**v,'buffer':0,'byteOffset':len(newbin)})
 newbin.extend(data)
accessmap={};accessors=[]
for i in sorted(used):
 accessmap[i]=len(accessors);a=dict(j['accessors'][i]);a['bufferView']=viewmap[a['bufferView']];accessors.append(a)
for mesh in j['meshes']:
 for p in mesh['primitives']:
  p['attributes']={k:accessmap[v] for k,v in p['attributes'].items()};p['indices']=accessmap[p['indices']]
for s in j['skins']:s['inverseBindMatrices']=accessmap[s['inverseBindMatrices']]
# CPU sparse correctives avoid hundreds of GPU morph texture layers per mesh.
for component,d in zip(recipe['components'],z['deltas']):
 nz=np.flatnonzero(np.any(d!=0,axis=1)).astype('<u2')
 component['indices']=base64.b64encode(nz.tobytes()).decode()
 component['deltas']=base64.b64encode(d[nz].astype('<f4').tobytes()).decode()
recipe['vertexCount']=z['deltas'].shape[1]
for mesh in j['meshes']:
 mesh.pop('weights',None);mesh.pop('extras',None)
for n in j['nodes']:n.pop('weights',None)
colors={'body':([.57,.48,.34,1],.12,.42),'pants':([.035,.06,.067,1],0,.8),'shirt':([.035,.22,.24,1],0,.65)}
for m in j['materials']:
 color,metal,rough=colors[m['name']];m['pbrMetallicRoughness']={'baseColorFactor':color,'metallicFactor':metal,'roughnessFactor':rough};m['doubleSided']=False
# Bake the identity in the retained position buffer; keep its native ordering.
for index in {p['attributes']['POSITION'] for p in j['meshes'][0]['primitives']}:
    accessor=accessors[index]
    view=newviews[accessor['bufferView']]
    start=view.get('byteOffset',0)+accessor.get('byteOffset',0)
    newbin[start:start+native_positions.nbytes]=native_positions.tobytes()
    accessor['min']=native_positions.min(0).tolist()
    accessor['max']=native_positions.max(0).tolist()
j['accessors']=accessors;j['bufferViews']=newviews;j['buffers']=[{'byteLength':len(newbin)}]
j['asset']['extras']={'provenance':'Cartwheel MHR native rig. MHR v1.0.1 knee correctives (Apache-2.0), transferred with verified surface/face-target correspondence. Static identity baked into the surface; unused morph targets removed for this body-motion example.'}
encoded=json.dumps(j,separators=(',',':')).encode();encoded+=b' '*(-len(encoded)%4);newbin+=b'\0'*(-len(newbin)%4)
out=struct.pack('<III',0x46546C67,2,12+8+len(encoded)+8+len(newbin))+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+struct.pack('<II',len(newbin),0x004E4942)+newbin
(output/'character.glb').write_bytes(out)
(output/'mhr-correctives.json').write_text(json.dumps(recipe,separators=(',',':')))
print(json.dumps({'bytes':len(out),'correctives':len(recipe['components']),'base_accessors':len(used)}))
(output/'MHR-LICENSE.txt').write_bytes((model_dir/'LICENSE.txt').read_bytes())
print(json.dumps({'maximumVertexErrorMeters':max_dist,'faceDeltaRelativeError':error,'correctiveCount':len(components)}))
