# Asset provenance

The character is **Cartwheel MHR** (`char-upload-MHR`). The native GLB’s bone hierarchy, bind transforms, skin weights and vertex ordering are retained. Its default static body/head shape settings are baked into the surface before unused identity/facial targets are removed. Materials are recolored for this example.

Pose deformation uses the released [MHR v1.0.1](https://github.com/facebookresearch/MHR/releases/tag/v1.0.1) corrective model from Meta, distributed under [Apache-2.0](assets/MHR-LICENSE.txt). `prepare-mhr.py` verifies the reference surface and facial-target correspondence, compiles the complete sparse pose model, including shoulders, elbows, torso and knees. The browser evaluates corrections after animation blending. Each clone shares the source data but owns its deformation buffer. The example does not animate facial expressions.

All four body performances were generated with **Cartwheel Hermes** through the Motion Editor. Idle, walk and signal use text-only generation. The run uses text plus 13 authored full-body pose guides to keep its arms clear of the torso; Hermes regenerates the motion between those guides. Each take contains 150 samples (5 seconds at 30 fps). Hermes exports through the source skeleton and is then retargeted to MHR; it is not a native MHR-output model. The current set uses the existing retargeter without the experimental shoulder-direction patch.

The source BVHs' unmapped finger channels were replaced with official Cartwheel static hand presets before retargeting: both hands `relaxed` for idle/walk, `fist_relaxed` for run; left `relaxed`, right `open_loose` for signal. No finger motion from the seed clips is carried into this set. Static presets do not claim generated finger animation. Body and wrist motion remain the Hermes performance.

Each `assets/*.motion.json` records the exact prompt, Hermes editor job ID, seed, character ID, hand-pose choice, source/prepared hashes, skeleton identity, contact assumptions and source-derived measurements. The run also records its pose-guide count. [run.hermes-poses.json](assets/run.hermes-poses.json) contains the exact native Axel guide poses, joint order, units, prompt and seed. These are editor job IDs, not motion-library IDs. Raw API responses and source download URLs remain private.

| Clip | Reviewed playback |
| --- | --- |
| Idle | Complete 150-sample performance, centered for gameplay. |
| Walk | Frames 60–93, phase marker 85, 3-frame seam blend; 1.10 s cycle and about 1.274 m net travel. |
| Run | Frames 78–103, phase marker 99, 3-frame seam blend; about 0.833 s cycle and 2.386 m net travel. |
| Signal | Complete right-arm gesture layer; authored signal event at source frame 55. |

Cycle endpoints are boundary samples: duration is `(endFrame - startFrame) / fps`. Full traveling MHR performances remain in the BVHs for inspection. The run uses a reviewed interior stride; the complete five-second take is not treated as a seamless loop. Playback removes net travel while retaining hip sway and applies only the short reviewed seam blend. See [AUDIT.md](AUDIT.md).

The signal event is **authored for the example**, not a timing promise from the model. Footfalls are kinematic estimates. The controller, scene, effects and right-arm masking are authored integration code. No credentials, account identifiers or signed URLs are included.

Code is covered by the repository’s MIT license. MHR material derived from the released model retains its Apache-2.0 license; Cartwheel-provided character assets and generated outputs remain subject to the applicable Cartwheel account terms described in the repository README.
