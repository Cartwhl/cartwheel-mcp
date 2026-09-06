# Cartwheel → Blender: three finished scenes

These examples show the same workflow in three art directions. Motion comes from Cartwheel Swing. Characters, sets, lighting, cameras, and the DJ performance are procedural Blender work.

| Film | Art direction | Generated motion |
| --- | --- | --- |
| [After Hours](../../docs/media/after-hours.mp4) | Glossy enamel robots, neon halo, speakers, turntables and floating party decorations | Disco and hip-hop dance |
| [Slow Morning](../../docs/media/slow-morning.mp4) | Pastel clay robot, faceted cherry blossoms, lotus pond and paper lanterns | Tai chi |
| [Moon Mail](../../docs/media/moon-mail.mp4) | Lunar courier, basalt rocks, craters, cargo and a ringed planet | Walking along a Blender curve |

Each film is eight seconds at 24 fps. After Hours is 1920 × 1200; the other two are 1600 × 1000. All use Cycles and denoising. After Hours includes an original synthesized stereo groove.

## Reproduce the renders

Requires **Blender 5.2**, Python 3, and FFmpeg. The four generated BVH files are included, so reproducing the gallery makes **no API requests** and consumes no credits.

From the repository root, on an Apple Silicon Mac:

```sh
python3 examples/blender/render_examples.py \
  --blender /Applications/Blender.app/Contents/MacOS/Blender \
  --device METAL \
  --example all
```

Supply your Blender executable on other platforms. Choose `CPU`, `CUDA`, `OPTIX`, `HIP`, or `ONEAPI` as appropriate for your installed Cycles device. Unsupported requested devices fail explicitly. CPU rendering works but takes longer.

Add `--preview-only` to build editable scenes, render pose previews, and run the grounding/continuity checks before spending time on the full movies. The same checks run automatically before every full render.

Use `--example after-hours`, `--example garden`, or `--example moon` to render just one film. The shared character scene is rebuilt first. Movies, `.blend` files, previews, and PNG frame sequences are written beside these scripts and ignored by Git.

The command overwrites the generated example outputs. Save your own edited scene under a different filename before rebuilding.

## What each file does

- `build_scene.py`: constructs the shared robot characters and After Hours set.
- `render_preview.py`: establishes the final wide composition.
- `retarget.py`: maps the two generated dances onto the lead robots.
- `motion.py`: retargets joints, preserves travel, matches path speed, detects stance, and solves planted feet.
- `verify_motion.py`: checks shoe drift, knee acceleration, foot yaw continuity, floor height, and the DJ's fixed feet.
- `variants.py`: builds the garden and lunar sets and applies their motions.
- `scene_utils.py`: geometry, materials, lighting and Cycles device setup.
- `render_final.py` / `render_variant.py`: render full PNG sequences.
- `make_music.py`: synthesizes the original After Hours groove.
- `render_examples.py`: runs the steps and encodes the MP4s.

## Generate your own performances

Use the MCP tools from the main README:

1. `list_characters` to choose a character ID available to your project.
2. `generate_motion` with a prompt, `requestedModel: "swing"`, `swingProperties: { "duration": 8 }`, and complete export settings.
3. `get_batch` until the job finishes.
4. `list_batch_motions` with the batch ID and `limit: 10`.
5. Download the returned `bvhURL` locally. Never commit the signed URL or raw response.

The supplied motion files are:

| File | Prompt |
| --- | --- |
| `assets/dance_0.bvh` | A person dances a playful bouncy hip hop groove in place, small alternating side steps and relaxed rhythmic arm swings, facing forward. |
| `assets/dance_1.bvh` | A happy person dances a funky disco groove in place, rhythmically stepping side to side with bent knees, swinging their arms and playfully pointing upward. Energetic joyful party dance, facing forward. |
| `assets/showcase_0.bvh` | A person performs slow flowing tai chi in place, gently shifting weight between their feet while sweeping both arms through broad graceful arcs, calm balanced movement. |
| `assets/showcase_1.bvh` | A person walks forward at a steady relaxed pace, natural alternating footsteps and relaxed arm swings, upright posture. |

The adapter expects the native Cartwheel BVH joint names (`pelvis`, `left_shoulder`, `left_knee`, etc.). It preserves source root travel, widens the arms for the toy proportions, and detects low, slow feet as stance intervals. Gaussian contact weights blend each shoe toward a floor anchor while allowing smooth pivots. Two-bone IK uses a stable source knee bend plane, and an eased pelvis height correction preserves leg reach. Foot yaw comes from the source ankle rotation using swing/twist decomposition, so foot pitch cannot turn into a yaw flip. Shoes cannot pass below the flat floor. It is a stylized example adapter, not a general retargeter for arbitrary character rigs. The bundled clips are 30 fps and are sampled at 24 fps for the films.

## Curved paths and pose constraints

Moon Mail uses the accumulated source travel distance to advance along a circular route in Blender, preserving walking stride speed. It turns the performance along the path tangent and blends stance-foot contact after the path transform. The walking performance is generated by Cartwheel; the travel path is scene animation. This is a flat-floor contact solve; the path is not sent to the motion model, and the solver does not handle arbitrary terrain. Props are placed clear of the walking route.

The public MCP tool does not expose path/pose conditioning. Keep custom staging, trajectory placement, camera moves, and prop animation in the Blender scene unless the public Cartwheel API explicitly documents the required constraint capability.

## Credits and license

Scene code, procedural character design, and synthesized music were created for this repository. The included motions were generated with Cartwheel Swing for these examples. No downloaded third-party character models, textures, or commercial music are required. Cartwheel-generated assets are subject to the applicable Cartwheel service terms; the software license covers the code.

## Check grounding

After building all scenes, run:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python-exit-code 1 --python examples/blender/verify_motion.py
```

The check samples the native motion to identify stance intervals, then independently measures the rendered shoe geometry in world space. It checks shoe-center drift during established stance, knee acceleration and foot rotation between frames, meaningful contact coverage, and sole height. Gaussian transitions intentionally permit small settling motion; a pivot is not treated as a frozen shoe rotation. Contact detection is heuristic; review the movies for natural weight transfer and contact transitions as well.

To verify just one built example, append `-- --example garden` (or `moon` / `after-hours`). To inspect scenes in a separate output directory, add `--scene-root /path/to/scenes` after `--`.
