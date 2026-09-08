# Motion quality audit

The first game reference used Mani and four generated Swing clips. Review exposed real integration defects, as well as an uneven transition in the generated run loop. A small first/last pose difference had not established that the whole performance was suitable for gameplay.

| Finding in the first reference | Correction |
| --- | --- |
| A split running contact at frames 118–125 was treated as a complete stride. Constant ground speed produced approximately 1.13× → 0.34× → 1.33× source playback speed. | Contact estimates no longer drive the clock. Walk/run each use an explicitly reviewed steady cycle, its measured net travel, and a constant phase rate. |
| The crowd chased points moving around small ellipses. A 60-second controller replay measured heading changes up to about 1,717°/s. | Continuous steering around a larger orbit; regression checks sustained speed and bounded heading changes. |
| Centering zeroed every horizontal pelvis sample, removing hip sway along with travel. | Remove the cycle’s net travel and heading while retaining the residual pelvis performance. Remove idle drift without changing its facing. |
| A full waving performance was added to the existing walking arm swing. | Complementary upper-body replacement weights. The base legs keep moving; interruption fades the held upper-body pose. |
| Playback duration was extended beyond the final key, holding the last pose for an extra frame. | Use actual key times and an explicit cycle boundary. Reviewed cycle endpoints match through a short symmetric blend. |
| Stride averages included non-alternating contact candidates. | Preserve those candidates with warnings, and exclude them from alternating-stride averages. |
| Keyboard movement was suppressed after interacting with the crowd slider. | Text editing retains focus protection; movement keys work after range/checkbox controls. Range arrow keys retain their normal behavior. |

## Character and source review

The reference now uses **MHR**, retargeted through MCP from the same four source performances. It preserves the character’s static identity and original native skeletal weights. The released MHR knee corrections run on the final blended pose, including during transitions, rather than being baked for a single animation.

The approved source region for walking is frames **57–93**, with phase marker **85**; running uses **68–91**, with phase marker **72**. Both use a symmetric blend spanning three frames on either side of the boundary. These choices are specific to these performances, recorded with the source hash in each `.motion.json`. New performances require their own review. No global motion filter or foot-lock IK is applied.

The preparation comparison found **zero changes to source joint rotation channels**. The MCP did not create the demonstrated contact-driven time warping; the game controller did. The uneven generated loop ending is excluded from the playable cycle. This does not establish whether that source defect originated in generation, loop processing, or retargeting.

## Verification and limits

Tests cover constant phase rate across wraps, matching cycle endpoint keys, preservation of hip motion, travel/heading alignment, upper-body replacement, crowd steering, source-bound preparation, frame/unit/root conventions, interruption, and the production API/asset trust boundaries. MHR deformations are checked against independent evaluations of the released model, with separate buffers for character clones.

Visual review also covers repeated walk/run cycles, signaling while moving, cancellation, keyboard input, the full small crowd, and a phone viewport. This remains a flat-ground integration reference. It does not guarantee contact locking on turns, arbitrary transition poses, navigation, or terrain-aware motion. A curated cycle demonstrates the integration; it does not certify every generated performance.
