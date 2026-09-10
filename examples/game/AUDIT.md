# swing-edit game quality audit

The game now uses **swing-edit for all four body performances**: idle, walk, run and signal. The MHR character, native skin weights and full-body pose corrective model are unchanged. The previous consumer shoulder adjustment and experimental shoulder-direction retarget patch are not enabled.

## What changed

The earlier Swing/MHR set showed collapsed shoulders and poor hand contact even in untouched animated exports. Importing those exports faithfully did not make their poses suitable for this character. Changing prompt wording did not establish a reliable repair. A geometric patch that forced source and target collarbone directions to agree also produced raised shoulders on other poses and was rejected.

The swing-edit text-only comparison produced more suitable body poses using the existing retargeter. The current game retains that idle and walk, adds a pose-guided run and a newly generated signal, and uses explicit static hand poses. swing-edit generates the body through its source/export skeleton before MHR retargeting; this is not a native MHR-output model. This set does not establish a general fix for every Swing retarget or every swing-edit prompt.

Unmapped finger channels can survive from the editor's source clip. To avoid inheriting that old finger animation, this set replaces them with official static hand poses before retargeting: relaxed hands for idle/walk, loose fists for run, relaxed left and open right for signal. Body and wrist tracks remain swing-edit motion. See [ASSETS.md](ASSETS.md) and the per-clip metadata for provenance.

## Playback selection and review

| Clip | Selection and review |
| --- | --- |
| Idle | The complete five-second swing-edit take, with gameplay centering. Arms hang beside the body. Review the repeated wrap; this is a short idle, not a full behavior system. |
| Walk | One steady interior stride, frames 60–93, aligned at phase frame 85. About 1.274 m in 1.10 s. A three-frame boundary blend closes the cycle while preserving hip sway. |
| Run | Frames 78–103, aligned at phase frame 99. About 2.386 m in 0.833 s, with a three-frame boundary blend. swing-edit regenerates the take around 13 authored pose guides. The complete source remains available for inspection. |
| Signal | The right arm rises to greet, waves and returns. The source frame 55 event was selected for the visible raised hand. Front-facing playback, moving playback and interruption were inspected. The right-arm mask omits the original torso follow-through. |

The local browser review exercised idle/walk/run, repeated gait samples, the complete signal, signal while walking, cancellation, keyboard running, crowd controls and a narrow phone layout. It produced no page errors or horizontal page overflow; all four loaded sidecars identified swing-edit. Those checks cover the reference and selected takes, not arbitrary generated replacements or all devices. Review the interactive result before publishing it as a showcase.

## Running arms

The first swing-edit run kept the elbows tightly folded and the upper arms pulled behind the torso. This was visible in its source-skeleton playback and untouched MHR export; game preparation reproduced it. Multiple text-only replacements varied in quality and did not reliably remove the cramped posture. This is not evidence of a universal rest-pose or retargeting repair.

The replacement uses 13 authored poses derived from a swing-edit run, retaining its body/leg performance while placing the hands beside and ahead of the waist. Those poses were submitted through `edit_motion.keyPoses`; swing-edit regenerated the performance between them. The published body tracks are the resulting MHR export. No runtime arm rotation offset or hand IK is applied. The guide data is included in [run.swing-edit-poses.json](assets/run.swing-edit-poses.json).

On the reviewed stride, mean elbow flexion changed from approximately 127–129° to 86–94°, and mean upper-arm angle from vertical changed from approximately 37° to 17–18°. These measurements describe this take; they are not acceptance thresholds for every running style. The source, untouched export, corrected game mesh and gameplay loop were compared from the front and side. Inspect the complete stride and walk/run transitions, including the wrists, rather than approving a single constrained frame.

## Playback direction correction

The first swing-edit game preview moved backward. The generated source traveled forward, but the game computed its heading from pelvis-local displacement under an animated `body_world` bone rotated 180 degrees. That local displacement pointed opposite to world travel. The original import-fidelity test stopped before gameplay centering, so it did not catch this integration defect.

Travel removal now samples the animated hierarchy in world space, removes net travel and aligns heading there, then bakes the result back through the parent transform at each key. Parent animation and the generated body performance are retained. No motion regeneration or fixed 180-degree character offset is involved. The obsolete bind-pose parent conversion was removed.

Regression tests check anatomical facing throughout both bundled gait cycles and centering under a translated, rotating parent. The browser review compares body facing with actual displacement for keyboard directions, walk/run orbits and crowd actors.

## Import and deformation checks

Independent animated GLB exports were sampled before BVH preparation at **28 poses across the four takes, with 127 joints per pose**. The prepared BVH playback differed by at most about **0.0343 degrees** and **0.00000135 meters** in the sampled local transforms. The latter is consistent with float32 precision for the traveling run root. `test/fixtures/mhr-export-baseline.json` records the independent export hashes and sampled poses; the test bounds differences to 0.1 degrees and 0.000005 meters. Agreement bounds import fidelity at those samples, not visual quality or contact accuracy.

Separate tests compare the MHR corrective implementation with official dense reference poses, verify rest skinning, and check that cloned characters own their deformation buffers. Correctives deform the mesh from the final blended pose; they do not rotate the shoulders to compensate for an unsuitable source performance.

The swing-edit MCP scene lifecycle was also exercised against an authorized isolated scene: generate and poll, apply a reviewed edit, change the character to MHR, save/clear pose state, request an export and retrieve its completed self-contained GLB. Constraint schemas and request contracts are covered by automated tests. This is not a claim that every constraint combination has received a visual model-output review.

## Controller corrections retained

| Integration defect | Current behavior |
| --- | --- |
| Split contacts caused uneven playback speed. | Contact estimates do not drive the clock. Reviewed walk/run cycles use measured net travel and constant phase speed. |
| Crowd actors chased rapidly moving targets. | Continuous steering around a larger orbit with bounded heading changes. |
| Root centering removed hip sway. | Subtract net cycle travel and heading while retaining residual pelvis motion. |
| A wave was added to a complete locomotion arm swing. | Complementary right-arm replacement weights. Interruption cancels future events and fades the held pose. |
| Loop duration held an extra endpoint frame. | Actual key times and an explicit boundary sample; short symmetric cycle blending. |
| Split contacts biased stride averages. | Keep and label questionable candidates; average only candidates containing one opposite-foot contact start. |
| Slider focus suppressed keyboard movement. | Movement works after range/checkbox controls while text editing and range arrow keys retain their normal behavior. |

The scene is flat and has no terrain IK, navigation, collision-aware generation or contact-preserving hand solve. Speed matching reduces integration errors but does not guarantee planted feet during every blend. The crowd shares assets but each character still incurs animation, deformation and rendering work. Frame rate depends on the device and crowd size. Test the intended target rather than treating a local frame-rate reading as a benchmark.
