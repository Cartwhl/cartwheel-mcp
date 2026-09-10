"""Bake Gaussian-eased planted-foot IK on Cartwheel's generated character rigs."""
import json,math,sys
from pathlib import Path
from statistics import median
import bpy
import numpy as np
from mathutils import Matrix,Quaternion,Vector

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'blender'))
from contact_math import gaussian,detect_contacts,foot_headings,knee_poles,pelvis_offsets,solve_knee

SIDES=('left','right')


def world_vertices(obj,depsgraph):
    evaluated=obj.evaluated_get(depsgraph)
    values=np.empty(len(evaluated.data.vertices)*3,dtype=np.float32)
    evaluated.data.vertices.foreach_get('co',values)
    matrix=np.array(evaluated.matrix_world)
    return values.reshape(-1,3)@matrix[:3,:3].T+matrix[:3,3]


def foot_geometry(rig,meshes):
    """Measure the actual weighted boots in the rig's unchanged rest pose."""
    rig.data.pose_position='REST';bpy.context.view_layer.update()
    geometry={}
    for side in SIDES:
        ankle=rig.matrix_world@rig.data.bones[side+'_ankle'].matrix_local
        toe=rig.matrix_world@rig.data.bones[side+'_foot'].head_local
        forward=toe-ankle.translation;forward.z=0;forward.normalize()
        right=Vector((-forward.y,forward.x,0))
        reference=Matrix((right,-forward,Vector((0,0,1)))).transposed().to_quaternion()
        parts=[];points=[]
        for obj in meshes:
            groups={g.index for g in obj.vertex_groups if g.name in (side+'_ankle',side+'_foot')}
            vertices=world_vertices(obj,bpy.context.evaluated_depsgraph_get())
            indices=[v.index for v in obj.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>.4 and vertices[v.index,2]<ankle.translation.z+.08]
            if indices:parts.append((obj,indices));points.extend(vertices[indices])
        if not points:raise ValueError(f'{rig.name}: no weighted {side} boot geometry')
        points=np.array(points);low=float(points[:,2].min())
        sole=points[points[:,2]<low+.006].mean(axis=0)
        geometry[side]={'parts':parts,'center':ankle.inverted()@Vector(sole),'calibration':ankle.to_quaternion().inverted()@reference}
    rig.data.pose_position='POSE';bpy.context.view_layer.update()
    return geometry


def bake_contacts(scene,rig,parent,meshes,floor_z=.120):
    """Retain source motion and solve only the two legs during inferred contact."""
    if scene.render.fps!=24:raise ValueError('The shared contact solver expects a 24 fps review timeline.')
    frames=list(range(scene.frame_start,scene.frame_end+1));count=len(frames);sigma=24*.08
    scene.frame_set(frames[0]);geometry=foot_geometry(rig,meshes)
    names=['pelvis']+[side+'_'+part for side in SIDES for part in ('hip','knee','ankle','foot')]
    samples=[];world=[];basis=[];centers={s:[]for s in SIDES};boot_local={s:[]for s in SIDES}
    for frame in frames:
        scene.frame_set(frame);bpy.context.view_layer.update()
        matrices={name:(rig.matrix_world@rig.pose.bones[name].matrix).copy()for name in names}
        samples.append({name:matrix.translation.copy()for name,matrix in matrices.items()});world.append(matrices)
        basis.append({name:(rig.pose.bones[name].location.copy(),rig.pose.bones[name].scale.copy())for name in names})
        depsgraph=bpy.context.evaluated_depsgraph_get();vertices={obj.name:world_vertices(obj,depsgraph)for obj in meshes}
        for side in SIDES:
            ankle=matrices[side+'_ankle'];inverse=np.array(ankle.inverted())
            centers[side].append(ankle@geometry[side]['center'])
            points=np.concatenate([vertices[obj.name][indices]for obj,indices in geometry[side]['parts']])
            boot_local[side].append(points@inverse[:3,:3].T+inverse[:3,3])
    detector=[dict(sample,**{side+'_ankle':centers[side][i]for side in SIDES})for i,sample in enumerate(samples)]
    spans={side:value[0]for side,value in detect_contacts(detector).items()}
    targets={s:[]for s in SIDES};orientations={s:[]for s in SIDES};weights={s:[0.]*count for s in SIDES}
    for side in SIDES:
        if not spans[side]:raise ValueError(f'{rig.name}: no {side} stance intervals; inspect the source performance')
        calibration=geometry[side]['calibration']
        rotations=[matrix[side+'_ankle'].to_quaternion()for matrix in world]
        # Smooth the source ankle roll before contact blending; otherwise a fast
        # toe-off and the releasing lock can add their angular velocities.
        for i in range(1,count):
            if rotations[i].dot(rotations[i-1])<0:rotations[i].negate()
        rotations=[Quaternion(tuple(q)).normalized()for q in gaussian([np.array(tuple(q))for q in rotations],sigma=24*.045)]
        headings=foot_headings([rotation@calibration for rotation in rotations])
        anchors=[]
        for start,end in spans[side]:
            anchor=Vector(tuple(median(centers[side][i][axis]for i in range(start,end+1))for axis in range(3)))
            yaw=median(headings[start:end+1]);rotation=Quaternion((0,0,1),yaw)@calibration.inverted()
            confidence=gaussian([float(start<=i<=end)for i in range(count)],sigma)
            anchors.append((anchor,rotation,confidence))
        for i in range(count):
            source=world[i][side+'_ankle'];rotation=rotations[i].copy();center=centers[side][i].copy()
            total=sum(confidence[i]for _,_,confidence in anchors);weights[side][i]=total
            if total:
                accumulator=np.array(tuple(rotation))*max(0,1-total)
                for anchor,q,confidence in anchors:
                    weight=confidence[i];center+=(anchor-centers[side][i])*weight
                    q=q.copy()
                    if q.dot(rotation)<0:q.negate()
                    accumulator+=np.array(tuple(q))*weight
                rotation=Quaternion(tuple(accumulator)).normalized()
            scaled=rotation.to_matrix()@Matrix.Diagonal(source.to_scale())
            target=center-scaled@geometry[side]['center']
            # Measured boot geometry supplies ankle height, not a guessed offset.
            bottom=float((boot_local[side][i]@np.array(scaled).T)[:,2].min())
            target.z=source.translation.z*(1-total)+(floor_z-bottom)*total
            targets[side].append(target);orientations[side].append(rotation)
        for i,target in enumerate(targets[side]):
            scaled=orientations[side][i].to_matrix()@Matrix.Diagonal(world[i][side+'_ankle'].to_scale())
            minimum_ankle=floor_z-float((boot_local[side][i]@np.array(scaled).T)[:,2].min())
            # A smooth maximum clears the floor without spreading a swing-foot
            # lift into established stance. Its contact offset is a constant.
            difference=target.z-minimum_ankle
            target.z=.5*(target.z+minimum_ankle+math.sqrt(difference*difference+.0005**2))+.0005
    poles={side:knee_poles(samples,side)for side in SIDES};drops=pelvis_offsets(samples,targets)
    scene.frame_set(frames[0]);base_z=float(parent.location.z);previous={}
    for i,frame in enumerate(frames):
        scene.frame_set(frame);parent.location.z=base_z-drops[i];parent.keyframe_insert('location',index=2,frame=frame)
        bpy.context.view_layer.update();shift=Vector((0,0,-drops[i]))
        for side in SIDES:
            hip,knee,ankle=[samples[i][side+'_'+part]+shift for part in ('hip','knee','ankle')]
            target=targets[side][i];reach=(knee-hip).length+(ankle-knee).length
            if (target-hip).length>=reach:raise ValueError(f'{rig.name} {side}: unreachable foot at frame {frame}')
            solved=solve_knee(hip,knee,ankle,target,poles[side][i])
            for part,origin,rotation in [
                ('hip',hip,(knee-hip).rotation_difference(solved-hip)@world[i][side+'_hip'].to_quaternion()),
                ('knee',solved,(ankle-knee).rotation_difference(target-solved)@world[i][side+'_knee'].to_quaternion()),
                ('ankle',target,orientations[side][i]),
            ]:
                name=side+'_'+part;bone=rig.pose.bones[name];bone.rotation_mode='QUATERNION'
                desired=Matrix.LocRotScale(origin,rotation,world[i][name].to_scale())
                bone.matrix=rig.matrix_world.inverted()@desired
                bone.location,bone.scale=basis[i][name]
                q=bone.rotation_quaternion
                if name in previous and q.dot(previous[name])<0:q.negate()
                previous[name]=q.copy();bone.keyframe_insert('rotation_quaternion',frame=frame)
                bpy.context.view_layer.update()
    # Samples are a smooth baked curve; linear interpolation avoids Bézier overshoot.
    for obj in (parent,rig):
        action=obj.animation_data.action
        for layer in action.layers:
            for strip in layer.strips:
                for slot in action.slots:
                    bag=strip.channelbag(slot)
                    if bag:
                        for curve in bag.fcurves:
                            for key in curve.keyframe_points:key.interpolation='LINEAR'
    report={'method':'Gaussian-eased two-bone IK','sigma_seconds':.08,'ankle_orientation_sigma_seconds':.045,'floor_height_m':floor_z,'maximum_pelvis_lowering_m':max(drops),'contacts':{side:[[frames[a],frames[b]]for a,b in spans[side]]for side in SIDES}}
    rig['contact_review']=json.dumps(report)
    rig['contact_sole_centers']=json.dumps({side:list(geometry[side]['center'])for side in SIDES})
    print('CONTACT_IK_READY',rig.get('cast_member'),json.dumps(report))
    scene.frame_set(frames[0]);return report
