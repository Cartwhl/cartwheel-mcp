# Asset provenance

The character is **Cartwheel MHR** (`char-upload-MHR`). The native GLB’s bone hierarchy, bind transforms, skin weights and vertex ordering are retained. Its default static body/head shape settings are baked into the surface before unused identity/facial targets are removed. Materials are recolored for this example.

Pose deformation uses the released [MHR v1.0.1](https://github.com/facebookresearch/MHR/releases/tag/v1.0.1) corrective model from Meta, distributed under [Apache-2.0](assets/MHR-LICENSE.txt). `prepare-mhr.py` verifies the reference surface and facial-target correspondence, compiles the complete sparse pose model, including shoulders, elbows, torso and knees. The browser evaluates corrections after animation blending. Each clone shares the source data but owns its deformation buffer. The example does not animate facial expressions.

All four performances were generated for this MCP reference using **Cartwheel Swing**, with four-second requests. They were subsequently retargeted to MHR BVH at 30 fps, Y up, preserving root travel. Idle/walk/run were requested with looping; signal was not. Loop processing can change the returned sample count.

Each `assets/*.motion.json` records the exact prompt, source motion ID, character ID, source/prepared hashes, skeleton identity, contact assumptions and source-derived measurements. Walk/run also record a reviewed interior cycle. Playback removes net travel while preserving hip motion and uses a short boundary blend. The full retargeted source performance remains available in the BVH for inspection. See [AUDIT.md](AUDIT.md) for the curation rationale.

The former consumer-side shoulder adjustment has been removed after failed visual review. Rotation tracks now follow the exported MHR pose, subject to the documented root centering, cycle and layer operations. The original retarget still has shoulder/contact defects; the bundled MHR motion assets remain unapproved. See [AUDIT.md](AUDIT.md).

The signal event at source frame 35 is **authored for the example**, not a frame-accurate timing promise from the model. Footfall events are kinematic estimates. The controller, scene and effects are not generated motion data. No raw API records, account identifiers, credentials, or signed URLs are included.

Code is covered by the repository’s MIT license. MHR material derived from the released model retains its Apache-2.0 license; Cartwheel-provided character assets and generated outputs remain subject to the applicable Cartwheel account terms described in the repository README.
