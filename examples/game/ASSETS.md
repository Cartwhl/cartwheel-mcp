# Asset provenance

The example’s single character is **Cartwheel Mani** (`char-upload-Mani`). The standalone GLB was exported without animation after removing the hidden skeleton-display meshes. Its skin, materials, native bone hierarchy and bind transforms are retained. The playable example shares this one character’s geometry and materials across clones.

All four performances were generated specifically for this MCP game reference using **Cartwheel Swing**, with 4-second requests, native Mani BVH retargets at 30 fps, Y up, and original root travel. Loop processing can change the returned duration; the metadata records the actual exported sample counts. Idle/walk/run were requested with looping; signal was not.

Each `assets/*.motion.json` records the exact prompt, source motion ID, character ID, source and prepared hashes, skeleton identity, contact assumptions, trim policy and source-derived measurements. No raw API responses, account identity, API keys or signed URLs are included.

The signal event at source frame 35 is **authored for the example**, not a frame-accurate timing promise from the model. Footfall events are explicitly labeled kinematic estimates. The character, scene renderer, controller and visual effects are not generated motion data.

Code is covered by the repository’s MIT license. Cartwheel character assets and generated outputs remain subject to the applicable Cartwheel account terms, as described in the repository README.
