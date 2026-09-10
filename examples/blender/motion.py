"""Retarget native joint motion while preserving travel and planted-foot contact."""
import bpy
import math
from mathutils import Vector, Matrix
from contact_math import gaussian, detect_contacts, foot_headings, knee_poles, solve_knee, pelvis_offsets

FPS = 24
FRAMES = 192
SCALE = 1.15


def key(obj, frame):
    for prop in ('location', 'rotation_quaternion' if obj.rotation_mode == 'QUATERNION' else 'rotation_euler', 'scale'):
        obj.keyframe_insert(data_path=prop, frame=frame)


def place(obj, a, b):
    obj.location = (a + b) / 2
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (b - a).to_track_quat('Z', 'Y')
    obj.scale.z = (b - a).length


def shoe_offset(angle):
    return Vector((.095*math.sin(angle),-.095*math.cos(angle),0))


def lock_feet(points, headings, spans, ground):
    """Gaussian contact confidence blends shoe-center anchors, preserving pivots."""
    angles = gaussian(headings)
    centers = [p+shoe_offset(angle) for p,angle in zip(points,angles)]
    correction = [Vector() for _ in points]
    for start,end in spans:
        anchor = sum((centers[i] for i in range(start,end+1)),Vector())/(end-start+1)
        anchor.z = ground
        weights = gaussian([1. if start<=i<=end else 0. for i in range(len(points))])
        for i,weight in enumerate(weights):
            correction[i] += (anchor-centers[i])*weight
    result = [center+offset-shoe_offset(angle) for center,offset,angle in zip(centers,correction,angles)]
    for point in result:
        point.z = max(point.z,ground)
    return result,angles


def animate_bot(name, motion_file, *, trajectory=None):
    scene = bpy.context.scene
    root = bpy.data.objects[name]
    root.animation_data_clear()
    bpy.ops.import_anim.bvh(filepath=str(motion_file), axis_forward='-Z', axis_up='Y', use_fps_scale=False, update_scene_fps=False)
    arm = bpy.context.object
    arm.name = 'Cartwheel source - '+name
    arm.hide_render = True
    samples = []
    foot_rotations = {'left':[], 'right':[]}
    foot_calibration = {}
    for side in foot_rotations:
        ankle = arm.data.bones[side+'_ankle']
        toe = arm.data.bones[side+'_foot']
        forward = arm.matrix_world.to_3x3()@(toe.head_local-ankle.head_local)
        forward.z = 0
        forward.normalize()
        right = Vector((-forward.y,forward.x,0))
        reference = Matrix((right,-forward,Vector((0,0,1)))).transposed().to_quaternion()
        rest = (arm.matrix_world@ankle.matrix_local).to_quaternion()
        foot_calibration[side] = rest.inverted()@reference
    with open(motion_file) as source_file:
        source_fps = 1 / float(next(line.split(':')[1] for line in source_file if line.startswith('Frame Time:')))
    for frame in range(FRAMES):
        source = 1+frame*source_fps/FPS
        scene.frame_set(int(source), subframe=source%1)
        samples.append({bone.name: arm.matrix_world@bone.head for bone in arm.pose.bones})
        for side in foot_rotations:
            pose = (arm.matrix_world@arm.pose.bones[side+'_ankle'].matrix).to_quaternion()
            foot_rotations[side].append(pose@foot_calibration[side])
    initial = samples[0]['pelvis'].copy()
    contacts = detect_contacts(samples)
    spans = {side:value[0] for side,value in contacts.items()}
    floors = {side:value[1] for side,value in contacts.items()}
    # Shoes are .21 tall, with their center .04 below the ankle.
    ankle_ground = .145
    floor = min(floors.values())
    transformed = []
    travel = 0.
    heading = math.atan2(samples[-1]['pelvis'].y-initial.y, samples[-1]['pelvis'].x-initial.x)
    for i, sample in enumerate(samples):
        offset = Vector((-initial.x*SCALE,-initial.y*SCALE,ankle_ground-floor*SCALE))
        points = {n:p*SCALE+offset for n,p in sample.items()}
        if trajectory == 'arc':
            if i:
                step = sample['pelvis']-samples[i-1]['pelvis']
                travel += math.hypot(step.x,step.y)*SCALE
            radius = 2.45
            angle = -math.pi/2 + travel/radius
            rotation = Matrix.Rotation(angle+math.pi/2-heading, 3, 'Z')
            center = Vector((radius*math.cos(angle),radius*math.sin(angle),0))
            pelvis_xy = Vector((points['pelvis'].x,points['pelvis'].y,0))
            points = {n:center+rotation@(p-pelvis_xy) for n,p in points.items()}
            for side in foot_rotations:
                foot_rotations[side][i] = rotation.to_quaternion()@foot_rotations[side][i]
        transformed.append(points)
    feet, foot_angles = {}, {}
    for side in ('left','right'):
        original = [p[side+'_ankle'] for p in transformed]
        headings = foot_headings(foot_rotations[side])
        feet[side], foot_angles[side] = lock_feet(original,headings,spans[side],ankle_ground)
    poles = {side:knee_poles(transformed,side) for side in feet}
    drops = pelvis_offsets(transformed,feet)
    body, chest, head = [bpy.data.objects[name+suffix] for suffix in (' torso',' chest assembly',' head')]
    limbs = {}
    for j,side in enumerate(('right','left')):
        limbs[side] = {}
        for part in ('shoulder','elbow','wrist','hip','knee','ankle','upperarm','forearm','thigh','shin'):
            limbs[side][part] = sorted([o for o in root.children if o.name.startswith(name+' '+part)],key=lambda o:o.name)[j]
        for part,prefix in (('hand','Mitten hand'),('shoe','Dancing sneaker')):
            limbs[side][part] = sorted([o for o in root.children if o.name.startswith(prefix)],key=lambda o:o.name)[j]
    for obj in [body,chest,head]+[o for limb in limbs.values() for o in limb.values()]:
        obj.animation_data_clear()
    for obj in (body,chest,head):
        obj.rotation_mode = 'QUATERNION'
    for i,p in enumerate(transformed):
        frame = i+1
        across = (p['left_shoulder']-p['right_shoulder']).normalized()
        up = (p['neck']-p['pelvis']).normalized()
        back = up.cross(across).normalized()
        across = back.cross(up).normalized()
        orient = Matrix((across,back,up)).transposed().to_quaternion()
        shift = Vector((0,0,-drops[i]))
        body.location = p['pelvis']+up*.22+shift
        chest.location = body.location
        head.location = p['neck']+up*.26+shift
        for obj in (body,chest,head):
            obj.rotation_quaternion = orient
            key(obj,frame)
        for side,limb in limbs.items():
            sign = 1 if side=='left' else -1
            hip = p[side+'_hip']+shift
            old_knee,old_ankle = p[side+'_knee']+shift,p[side+'_ankle']+shift
            ankle = feet[side][i]
            knee = solve_knee(hip,old_knee,old_ankle,ankle,poles[side][i])
            shoulder,elbow,wrist = [p[side+'_'+part]+across*sign*.23+shift for part in ('shoulder','elbow','wrist')]
            for part,value in dict(hip=hip,knee=knee,ankle=ankle,shoulder=shoulder,elbow=elbow,wrist=wrist).items():
                limb[part].location = value
                key(limb[part],frame)
            for part,a,b in (('thigh',hip,knee),('shin',knee,ankle),('upperarm',shoulder,elbow),('forearm',elbow,wrist)):
                place(limb[part],a,b)
                key(limb[part],frame)
            limb['hand'].location = wrist
            key(limb['hand'],frame)
            shoe = limb['shoe']
            angle = foot_angles[side][i]
            shoe.location = ankle+Vector((.095*math.sin(angle),-.095*math.cos(angle),-.04))
            shoe.rotation_euler = (0,0,angle)
            key(shoe,frame)
    arm.hide_set(True)
    scene.frame_set(1)
    return spans
