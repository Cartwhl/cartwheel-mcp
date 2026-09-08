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

## Current status: MHR visual review failed

The MHR demo is **not visually approved**. The previous shoulder correction was rejected in review and has been removed. The API tools and controller fixes above remain; none of those checks established acceptable character animation.

### What the controlled comparison established

1. **The defect exists in an untouched export.** `get_motion` returned self-contained animated MHR GLBs for the same idle and walk IDs. Playing the idle GLB directly, with its embedded rig and animation, reproduces the arms collapsing into the torso. No BVH preparation, game controller, pose correctives, body mask or shoulder adjustment is needed to reproduce it.
2. **BVH preparation preserves the exported pose closely.** Eight sampled poses across the two independent GLB/BVH downloads agree across 127 joints within 0.363 degrees and 0.000001 meters in local transforms. `test/fixtures/mhr-export-baseline.json` records the export hashes and observations. This bounds import fidelity at those samples; it is not a quality score or a complete temporal audit.
3. **The shoulder adjustment was not a valid general retarget repair.** It forced MHR's collar-to-shoulder direction to match the source character and compensated the arm rotation. That moved the arms outward but created raised, bulky shoulders. Different rigs' internal joint directions are not interchangeable anatomical targets. The test asserting that forced direction reproduced the adjustment's assumption, not a visually correct MHR pose. The adjustment, calibration, metadata opt-in and that test were removed.
4. **Hand contact did not survive the character change.** In the selected idle, the hands meet on the source Mani export but separate on MHR. Sampled palm orientation also differs by roughly 8–12 degrees. Copying rotations between different proportions does not guarantee clasped-hand contact. This is a poor idle to approve without reviewing the retargeted hands.
5. **The demo changes the performance further.** A right-arm-only signal mask discards the generated torso and opposite-arm follow-through. The locomotion preview repeats a single short stride. These are controller demonstrations, not evidence that the complete performances remain compelling after layering.
6. **The deformation pass has a performance cost.** The previous local Chrome run measured approximately 60 fps for one character and 22–25 fps for nine with full pose corrections. Low frame rate can add visible stutter. The fresh post-removal smoke check measured 60 fps for one and 53 fps for nine; the runs are not a controlled performance comparison. Removing or changing pose correctives in isolation did not repair the underlying shoulder/contact defect.

The stock MHR rest skeleton and inverse bind matrices agree to approximately 0.0000002 per matrix element. Rebinding the mesh or repainting weights is therefore not justified by the evidence gathered here. The remaining defect involves retargeted pose/body compatibility and contact preservation; the exact hosted-retargeter repair is unresolved. This comparison does **not** establish that Swing generation itself caused the problem, or certify the full MCP implementation as defect-free.

### Review order before promoting this demo

- Play the self-contained animated export before preparing animation-only files. Compare it with the same performance on the source character. Preserve both original files and their hashes privately.
- Review rest, arms down, arms raised, wrists, finger bends and contacts in front/side views. A skin that is correct at rest can still receive an unsuitable retargeted pose.
- Resolve the MHR retarget and select a performance that survives the change in proportions. Review the complete clip at source cadence before introducing trimming, cycles, speed matching or a body mask.
- Add each controller feature separately and compare with that baseline. Review gesture follow-through and hands as well as feet. Measure frame rate at the intended crowd size.
- Obtain visual approval of the resulting animation before treating the bundled MHR assets as recommended defaults.

### Automated coverage and its limits

Tests check MCP trust boundaries, preparation, units, root motion, phase clocks, event interruption, and the numerical corrective implementation. The replacement MHR import test compares prepared playback with the independently downloaded embedded-animation baseline, using a half-degree angular tolerance for the measured cross-format differences. It deliberately preserves the known bad source pose, so passing it cannot constitute visual approval.
