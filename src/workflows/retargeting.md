# Character retargeting: how it works and how to set a character up for it

Use this guide when a user asks why their character moves the way it does, how to prepare a model so Cartwheel motion plays well on it, what a rig mapping should look like, or how to work out what is wrong with a retarget. It explains the process rather than listing fixes: reason from how the retarget works to what the character needs, and from there to what a given result means.

## What retargeting does

Every Cartwheel motion is authored on Cartwheel's own skeleton: generated motion, library motion and video capture all use it. Playing that motion on any other character is a retarget. Cartwheel's retargeter, forge, does not copy joint rotations from one skeleton to the other; skeletons differ too much in bone count, proportions and axis conventions for that to work. It works in world space instead:

1. Each bone of the source skeleton is matched to a **role**: Pelvis, Spine, Chest, Neck, Head, and per side the clavicle, upper arm, lower arm, hand, upper leg, lower leg, foot, toe and finger joints. The character's mapping says which of its bones plays each role.
2. Roles are grouped into **chains**: the spine, each arm, each leg, the neck and head, each finger. A chain runs from a start bone to an end bone and includes the unmapped bones in between, so a spine with four vertebrae between pelvis and chest still bends as one.
3. Every frame, forge poses each chain of the character so it points where the source's chain points, scaled to the character's own proportions, and solves the joints in between with that chain's **solver**. Limbs use an IK solver that keeps the elbow or knee bending the way it bent in the source.
4. Afterwards it applies per-joint corrections from the mapping: rotation offsets, rotation limits, and twist distribution along limbs.

Two consequences matter more than anything else when advising a user:

- **Only mapped bones and the bones inside chains are driven.** Every other bone keeps its rest pose relative to its parent and simply follows. A helper, corrective or accessory bone that the mesh depends on but nothing maps stays rigid.
- **Directions come from the character's rest pose.** Forge learns which way each of the character's limbs points, which way it faces and which way is up from the pose its skeleton is in when loaded. A rest pose that does not match how the mesh was skinned, or a skeleton that says it faces one way while the mesh faces another, shows up in every motion.

Robots (characters whose `fileExtension` is `mjcf`) do not use this retarget; see `cartwheel://workflows/robots`.

## What a character needs

### A clean rest pose

The skeleton should rest in a T-pose or A-pose: standing upright, legs straight under the hips, arms out to the sides, elbows and knees straight or very slightly bent, hands flat with fingers extended, feet flat. The mesh must be skinned in that same pose, so the skeleton's rest (bind) pose and the skin's bind pose agree. Characters exported from a scene with a pose or animation applied, or rigs whose skin was bound in a different pose from the one the skeleton rests in, give the retarget a wrong starting point.

### One skeleton, one root, a readable hierarchy

A single root with the pelvis (hips) under it, the spine and both legs under the pelvis, the neck and both clavicles under the top of the spine, and each limb a continuous parent-child line from shoulder to hand and hip to toe. Extra bones are fine anywhere, as long as the main line of each limb is unbroken.

### Left and right that mean the character's own left and right

Side names (`Left`/`Right`, `L`/`R`, `_l`/`_r` and the like) should match the side of the body the bone is on, from the character's point of view. Forge works out which way the character faces from where its left and right hips are, so swapped side labels turn the character around as well as swapping its limbs.

### Facing and up

Cartwheel handles both Y-up and Z-up characters and characters facing any horizontal direction, as long as the file's axis and unit metadata are true. A character that faces a direction other than forward in its own file is turned to face forward for the retarget and turned back for the result, so its exports keep the orientation it was uploaded with.

### Real units

Scale comes from the file's unit metadata. A model authored in metres but declared in centimetres (or the reverse) reaches the retarget a hundred times too small or too large; proportions are relative, but grounding, root travel and export scale are not.

### Main bones that carry the skin, or skin that follows them

Map the bones that actually pose each body part: the upper arm, forearm, hand and so on. Many production rigs split a limb into a main bone that the animator rotates and helper bones that carry the skin (twist bones, offset bones, deltoid or knee correctives). Map the main bone, not the helpers. If the skin sits on child bones that follow the main bone, the mesh follows the retarget. If the skin sits on bones that need to be driven separately, those bones need their own handling, as twist joints do below.

## Twist joints

A real forearm rotates along its length: turning the palm over is shared between the wrist and the whole forearm. Cartwheel's source skeleton has no forearm twist bones, so that rotation arrives on the wrist. On a character whose forearm skin rides on separate twist joints, forge spreads the roll along the limb using the mapping's **twist chains**: for each limb segment (upper arm, forearm, thigh, shin), the twist joints the segment's roll is ramped across, from none at one end to all of it at the other. Without twist chains, every bit of that roll lands at the wrist joint and the skin there pinches like a candy wrapper.

Cartwheel derives twist chains automatically from the mapping: for each mapped limb segment, the bones directly under it whose names contain `twist` or `roll` and that lie along the segment. The forearm is driven by the hand and the shin by the foot; the upper arm and thigh roll with themselves. In Cartographer the user can add or remove twist joints, switch a segment's twist chain off, and tune each chain's `damping` (how much of the roll the joints take) and other settings. A chain the user edits, or one supplied in their own config, is kept as it is.

## The mapping

A character's mapping (its Cartographer config, `config.json`) is what the retarget reads besides the model itself:

| Field | What it holds |
|---|---|
| `role_to_bone` | Which bone plays each role. |
| `chains` | The bones in each chain, start to end. |
| `chain_config` | Each chain's solver and its settings. |
| `excluded_bones` | Bones left out of mapping and recognition. |
| `forward`, `up` | The character's facing and up axes as labelled in the config. |
| `joint_offsets` | Constant per-joint rotation corrections, in degrees, applied after the retarget. |
| `bone_properties` | Per-bone rotation limits and preferred angles. |
| `twist_chains`, `twist_chains_excluded` | Twist joints per limb segment, and segments whose twist chain is switched off. |

When a rigged model is uploaded without a config, Cartwheel recognizes the skeleton and builds the mapping itself; when the upload includes a config, that mapping is used. An unrigged mesh is auto-rigged with Cartwheel's own skeleton, so it needs no mapping. Users review and edit a mapping in **Cartographer**, which shows each bone's role and chain, previews motion on the character as they edit, and saves the config with the character. Do not write a mapping for a user from guesses about their bone names; recognition and Cartographer are the way to produce one.

## Working out what is wrong

Diagnose from the process above rather than matching symptoms to fixes:

1. **Look at the character first.** `get_character` gives its processing status, file type and asset URLs. A character that has not finished processing, or that needs validation, will not retarget correctly yet. Check its rest pose and orientation before any motion is involved.
2. **Compare against the source.** Play the same motion on Cartwheel's default character and on the user's. Note which body parts differ, on which frames, and whether the difference is constant (a whole limb or the whole body off by a fixed amount) or grows with the motion (a joint that bends or rolls the wrong way when the source moves).
3. **Ask which input drives that body part.** A limb that does nothing is unmapped or excluded. A limb that moves like the other side's is mapped to the wrong side. A whole body that leans, faces or bends the wrong way points to facing, up axis or rest pose rather than to any one bone. Skin that tears or pinches while the bones look right points to skinning or to twist joints. Wrong size or sinking points to units or proportions.
4. **Change one input and look again.** Fix the mapping in Cartographer, adjust a chain's solver, add a joint offset, or edit a twist chain, and compare on the same frames. If the rest pose or the skin bind is the problem, the model has to be fixed and uploaded again; no mapping change can correct it.

When an answer depends on something the user has not shown you, such as their rig's bone names or how it was skinned, ask for it rather than assuming.
