# Robot export examples

See `cartwheel://workflows/robots` (or `src/workflows/robots.md`) for the workflow itself.

Robots share the scene and export tools with every other character, but not the retarget:
their motion is solved against the robot's own MJCF model rather than retargeted onto a
humanoid rig, and that is what makes the deliverables, the coordinate frame and the timings
differ.

Only the mesh deliverables feed the Blender and game examples: `glb`, `fbx-*`, `usd`,
`usdz`, `ma`, `mb` and `bvh`. **`qpos` is not one of them.** It is a MuJoCo joint vector in
an `.npz`, and no DCC reads it: Blender, Maya, Unreal and Unity cannot open it. Use `qpos`
for simulation or hardware replay, and export a mesh format alongside it when the same
motion also has to be rendered or edited.
