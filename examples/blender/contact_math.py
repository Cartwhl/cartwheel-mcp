"""Shared contact detection, Gaussian easing and stable two-bone IK math."""
import math
from statistics import median
from mathutils import Vector

FPS = 24


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
