"""Retarget native joint motion while preserving travel and planted-foot contact."""
import bpy
import math
from statistics import median
from mathutils import Vector, Matrix

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


def contact_spans(points, speed_limit=.38):
    """Low, slow source ankles identify stance; short gaps do not split a plant."""
    floor = sorted(p.z for p in points)[int(len(points) * .05)]
    speed = [(points[min(i+1, len(points)-1)] - points[max(0, i-1)]).length * FPS / (1 if i in (0,len(points)-1) else 2) for i in range(len(points))]
    planted = [p.z < floor + .065 and v < speed_limit for p, v in zip(points, speed)]
    for i in range(1, len(points)-1):
        if planted[i-1] and planted[i+1]:
            planted[i] = True
    spans = []
    start = None
    for i, value in enumerate(planted + [False]):
        if value and start is None:
            start = i
        if not value and start is not None:
            if i-start >= 3:
                spans.append((start, i-1))
            start = None
    return spans, floor


def gaussian(values, sigma=FPS*.06):
    """Symmetric offline easing, with constant extension at clip boundaries."""
    radius = math.ceil(3*sigma)
    weights = [math.exp(-.5*(i/sigma)**2) for i in range(-radius,radius+1)]
    total = sum(weights)
    return [sum((values[min(max(j+i,0),len(values)-1)]*w for i,w in zip(range(-radius,radius+1),weights)), values[0]*0)/total for j in range(len(values))]


def detect_contacts(samples):
    # The same detector handles stationary actions and travelling locomotion.
    speed = median(math.hypot(b['pelvis'].x-a['pelvis'].x,b['pelvis'].y-a['pelvis'].y)*FPS for a,b in zip(samples,samples[1:]))
    limit = max(.38,.6*speed)
    return {side:contact_spans([p[side+'_ankle'] for p in samples], speed_limit=limit) for side in ('left','right')}


def foot_headings(rotations):
    """Extract vertical-axis twist, so foot pitch cannot masquerade as yaw."""
    reliable = []
    for i,q in enumerate(rotations):
        # Swing/twist decomposition about Z: discard the horizontal quaternion
        # components. Only an almost upside-down foot has an ambiguous twist.
        if math.hypot(q.w,q.z) < .15:
            continue
        angle = 2*math.atan2(q.z,q.w)
        if reliable:
            angle = reliable[-1][1]+(angle-reliable[-1][1]+math.pi)%(2*math.pi)-math.pi
        reliable.append((i,angle))
    if not reliable:
        return [0.]*len(rotations)
    angles = [reliable[0][1]]*len(rotations)
    for (start,a),(end,b) in zip(reliable,reliable[1:]):
        for i in range(start,end+1):
            angles[i] = a+(b-a)*(i-start)/(end-start)
    for i in range(reliable[-1][0],len(rotations)):
        angles[i] = reliable[-1][1]
    return angles


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


def knee_poles(points, side):
    """Keep the source bend plane independent of the corrected ankle target."""
    poles = []
    for p in points:
        hip,knee,ankle = [p[side+'_'+part] for part in ('hip','knee','ankle')]
        axis = (ankle-hip).normalized()
        pole = knee-hip-axis*(knee-hip).dot(axis)
        if pole.length < .02:
            across = p['left_hip']-p['right_hip']
            pole = poles[-1].copy() if poles else Vector((across.y,-across.x,0)).normalized()
        else:
            pole.normalize()
        poles.append(pole)
    return [p.normalized() for p in gaussian(poles)]


def solve_knee(hip, knee, ankle, target, pole):
    """Two-bone IK with a stable source pole and unchanged segment lengths."""
    upper,lower = (knee-hip).length,(ankle-knee).length
    delta = target-hip
    distance = delta.length
    axis = delta.normalized()
    bend = pole-axis*pole.dot(axis)
    bend.normalize()
    along = (upper*upper-lower*lower+distance*distance)/(2*distance)
    height = math.sqrt(max(0,upper*upper-along*along))
    return hip+axis*along+bend*height


def pelvis_offsets(points, feet):
    required = []
    for i,p in enumerate(points):
        drop = 0.
        for side in feet:
            hip,knee,ankle = [p[side+'_'+part] for part in ('hip','knee','ankle')]
            target = feet[side][i]
            # A slight bend reserve avoids the straight-leg IK singularity.
            reach = .985*((hip-knee).length+(knee-ankle).length)
            horizontal = math.hypot(hip.x-target.x,hip.y-target.y)
            allowed = math.sqrt(max(.01,reach*reach-horizontal*horizontal))
            drop = max(drop,hip.z-target.z-allowed)
        required.append(drop)
    # A maximum filter followed by Gaussian smoothing stays above every reach
    # constraint, while easing the pelvis into and out of the required lowering.
    radius = math.ceil(3*FPS*.06)
    envelope = [max(required[max(0,i-radius):min(len(required),i+radius+1)]) for i in range(len(required))]
    return gaussian(envelope)


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
