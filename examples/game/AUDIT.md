# Motion quality audit

The first game reference used Mani and four generated Swing clips. Review exposed real integration defects, as well as an uneven transition in the generated run loop. A small first/last pose difference had not established that the whole performance was suitable for gameplay.

| Finding in the first reference | Correction |
| --- | --- |
| A split running contact at frames 118–125 was treated as a complete stride. Constant ground speed produced approximately 1.13× → 0.34× → 1.33× source playback speed. | Contact estimates no longer drive the clock. Walk/run each use an explicitly reviewed steady cycle, its measured net travel, and a constant phase rate. |
| The crowd chased points moving around small ellipses. A 60-second controller replay measured heading changes up to about 1,717°/s. | Continuous steering around a larger orbit; regression checks sustained speed and bounded heading changes. |
| Centering zeroed every horizontal pelvis sample, removing hip sway along with travel. | Remove the cycle’s net travel and heading while retaining the residual pelvis performance. Remove idle drift without changing its facing. |
| A full waving performance was added to the existing walking arm swing. | Complementary gesture replacement weights. The base body keeps moving; interruption fades the held gesture pose. |
| Playback duration was extended beyond the final key, holding the last pose for an extra frame. | Use actual key times and an explicit cycle boundary. Reviewed cycle endpoints match through a short symmetric blend. |
| Stride averages included non-alternating contact candidates. | Preserve those candidates with warnings, and exclude them from alternating-stride averages. |
| Keyboard movement was suppressed after interacting with the crowd slider. | Text editing retains focus protection; movement keys work after range/checkbox controls. Range arrow keys retain their normal behavior. |

## Character and source review

The reference now uses **MHR**, using native MCP exports of four Swing performances. It preserves the character’s static identity and original native skeletal weights. The released MHR full-body pose corrections run on the final blended pose, including during transitions, rather than being baked for a single animation.

The approved source region for walking is frames **57–93**, with phase marker **85**; running uses **68–91**, with phase marker **72**. Both use a symmetric blend spanning three frames on either side of the boundary. These choices are specific to these performances, recorded with the source hash in each `.motion.json`. New performances require their own review. No global motion filter or foot-lock IK is applied.

The prepared BVHs retain the source joint rotation channels. The MCP did not create the demonstrated contact-driven time warping; the game controller did. The uneven generated loop ending is excluded from the playable cycle. This does not establish whether that source defect originated in generation, loop processing, or retargeting.

## Follow-up: shoulder reference poses

The initial review missed a real shoulder defect. MHR's native rest transforms and inverse bind matrices agree, but the raw Swing-to-MHR exports pull the collarbones inward and backward. Matching names and offsets did not catch this. Inspection of the retargeter and source performances showed that it transfers collarbone rotation deltas between different anatomical reference directions: the source collarbone points outward and upward, while MHR's reference points outward and backward.

`rest-pose.mjs` applies a constant reference-frame correction to each clavicle and the inverse correction to its upper-arm child. The anatomical frame is derived from collar-to-shoulder geometry and projected world up; no animation frame is selected as an assumed rest pose. The child compensation preserves world-space arm rotations, including twist bones. Lower-body tracks, root motion and key timing remain unchanged. This runs once before cycle preparation and blending.

`assets/swing-mhr-reference.json` records the reference rotations and reviewed BVH hashes. Each sidecar opts into that calibration. It is specific to these exports; it must not be applied automatically to native Comic MHR captures or a different retarget reference. This corrects the bundled consumer, **not the hosted retarget service**. New source/target rigs require their own verified reference frames.

The original idle also put the hands through MHR's hips. Two replacement idles and one new greeting were generated through MCP; the clearer idle was selected. The greeting mask now includes only the right clavicle and arm, preserving the left arm's base pose instead of replacing it with the greeting take's unused left-arm pose.

The earlier knee-only deformation model also omitted MHR's shoulder and torso volume corrections. The browser now evaluates all 2,184 nonzero native LOD1 corrective components on the final blended pose.

## Verification and limits

Tests cover constant phase rate across wraps, matching cycle endpoint keys, preservation of hip motion, travel/heading alignment, upper-body replacement, crowd steering, source-bound preparation, frame/unit/root conventions, interruption, and the production API/asset trust boundaries. MHR tests check actual skinned rest positions and inverse binds, five poses against independently evaluated official dense blendshapes, and 20 real clip poses against source collar-to-shoulder directions. They also verify preserved arm/twist orientations and lower-body positions, and reject a changed native rest rig. Clones keep separate deformation buffers.

Visual review also covers repeated walk/run cycles, signaling while moving, cancellation, keyboard input, the full small crowd, and a phone viewport. This remains a flat-ground integration reference. It does not guarantee contact locking on turns, arbitrary transition poses, navigation, or terrain-aware motion. A curated cycle demonstrates the integration; it does not certify every generated performance.

Measured on the local Chrome review: one corrected character plays at about 60 fps; all nine full-detail MHR characters run at roughly 22–25 fps. Complete native pose deformation costs more CPU time than the former knee-only model. Front/side close views, the new idle/greeting, locomotion, interruptions and a phone viewport were reviewed without browser errors.
