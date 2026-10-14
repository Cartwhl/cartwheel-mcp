# Humanoid robot retarget and export

Use this workflow when the user asks for motion on a physical robot (Unitree G1, Apptronik Apollo, Unitree H1, Rainbow RB-Y1, ToddlerBot) or asks for joint angles to replay in MuJoCo. Robots travel the same scene and export path as any other character; what differs is how you find them, which formats mean anything, the frame the deliverables arrive in, and how long the export takes.

## Find the robot

Robot characters are returned by `list_characters` like any other accessible character, so there is no separate catalog to query. They are hidden from the picker in the web app, which means a user may know a robot exists without being able to name its ID; list and match on name rather than asking them to supply one.

Identify a robot by its uploaded format, not by its name:

- `fileExtension` is `mjcf` on every robot. This is the only reliable signal.
- `extension` stays `glb`, because that is the format served for preview. Do not read it as the character's true type.

Do not hardcode robot IDs. Which robots are registered differs between environments and changes as new ones are brought up; `list_characters` is the source of truth.

## Retarget and export

Put the robot on a scene object with `set_scene_character`, then `export_scene`, exactly as for a human character. The retarget is not a rotation copy: the motion is solved against the robot's MJCF model so the result respects its real joint limits and stays physically valid, which is why a robot export costs far more time than the same motion on a human rig.

Choose the format deliberately:

- `qpos` is the MuJoCo joint vector as an `.npz`, and is **robot only**. It is what you want for replaying motion in simulation or on hardware. Requesting it for a non-robot character is rejected with "QPOS export is only available for MJCF-origin robot characters"; check `fileExtension` first rather than relying on the error.
- `bvh`, `glb`, `fbx-*`, `usd`, `usdz`, `ma` and `mb` all work on a robot. Each derives from the solved robot skeleton, so the joint names are the robot's own, not Cartwheel's 22-joint naming. Do not assume a downstream tool expecting a humanoid rig will accept them.

## Expect the robot's own frame, and a slow export

Robot deliverables arrive in the robot's native frame, metres and Z-up, rather than the centimetre convention human exports follow. The GLB is metres; the FBX is metres and declares that unit so DCC apps scale it on import; `qpos` is the raw joint vector and is never rescaled. BVH is the single exception and is converted to centimetres, because BVH carries no unit metadata and a metre-scale skeleton renders a hundred times too small in a viewer that expects centimetres.

The solve typically takes one to a few minutes, against a human export's seconds. Poll `get_scene_exports` patiently and do not treat a pending status as a failure or resubmit: a second export repeats the whole solve from the start. Report a robot export as still running until its status actually resolves.
