"""Final image quality, shared by the scene builder and frame renderer."""


def configure_render(scene, samples=256):
    scene.render.engine = 'CYCLES'
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1440
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '16'
    scene.render.film_transparent = False
    scene.render.use_persistent_data = True
    scene.render.use_file_extension = True
    cycles = scene.cycles
    cycles.samples = samples
    cycles.use_adaptive_sampling = True
    cycles.adaptive_min_samples = min(64, samples)
    cycles.adaptive_threshold = .005
    cycles.use_denoising = True
    cycles.denoiser = 'OPENIMAGEDENOISE'
    cycles.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    cycles.denoising_prefilter = 'ACCURATE'
    cycles.denoising_quality = 'HIGH'
    cycles.max_bounces = 10
    cycles.diffuse_bounces = 4
    cycles.glossy_bounces = 4
    cycles.transmission_bounces = 8
    cycles.volume_bounces = 2
