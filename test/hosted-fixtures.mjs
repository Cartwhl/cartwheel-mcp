export const slot = { sceneID: 'scene-1', referenceName: 'character', timelineIndex: 0 };
export const fakeCredentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'nonsecret-test-signing-key', sessionToken: 'nonsecret-test-session' };
export const credential = () => ({ apiKey: 'fixture-api-key', createdByUser: 'user-fixture', expiresAt: Date.now() / 1000 + 300 });
export function credentialTransport(upstream, resolver = async () => Response.json(credential())) {
  return async (url, init) => {
    if (String(url).endsWith('/mcp/credential')) return resolver(url, init);
    // A real executor preflight must scope edit detail to accessible history.
    if (String(url).endsWith('/motionEdits')) return Response.json(extensionOutputs.list_motion_edits);
    if (!upstream) throw new Error('Unexpected test network request');
    return upstream(url, init);
  };
}
export const exportSettings = { exportType: 'bvh', forward: 'Z', up: 'Y', frameRate: 30, frameStepSize: 1 };
export const realisticKeyPoses = (count, joints = 77) => Array.from({ length: count }, (_, frame) => ({
  frame, localJointRot: Array.from({ length: joints }, (_, joint) => [
    Number(((frame + 1) * (joint + 1) / 997).toFixed(6)), -0.123456, 0.654321,
  ]), rootPosition: [0.123456, 1.234567, -0.123456], smoothRoot2d: [0.123456, -0.123456],
}));
export const extensionArguments = {
  get_character: [{ characterID: 'character-1' }], list_scenes: [{}], get_scene: [{ sceneID: 'scene-1' }],
  get_motion: [{ motionID: 'motion-1' }], search_motions: [{ pageSize: 20, searchTerm: 'walking' }], list_motions: [{}],
  create_scene: [{ sceneName: 'Review', motions: [{ motionID: 'motion-1', variationNumber: 0 }] }],
  list_motion_edits: [slot], get_motion_edit: [{ ...slot, jobID: 'edit-1' }],
  save_key_poses: [{ ...slot, keyPoses: [] }], export_scene: [{ sceneID: 'scene-1', exportSettings }],
  get_scene_exports: [{ sceneID: 'scene-1', objectReferenceNames: ['character'] }],
};
const asset = 'https://assets.s3.amazonaws.com/asset.bvh?X-Amz-Signature=intentional';
const scene = { sceneID: 'scene-1', sceneName: 'Review', objects: { character: { objectID: 'character-1',
  referenceName: 'character', timeline: [{ jobID: 'motion-1', variationNumber: 0, bvhURL: asset, keyPoses: [] }] } } };
const edit = { jobID: 'edit-1', status: 'COMPLETED', outputBvhURL: asset };
const exports = { exports: [{ exportID: 'export-1', sceneID: 'scene-1', objectReferenceName: 'character', status: 'COMPLETED' }], downloadURL: asset };
export const extensionOutputs = {
  get_character: { characterID: 'character-1', uploadStatus: 'COMPLETE', baseFbxURL: asset },
  list_scenes: { scenes: [scene] }, get_scene: scene, get_motion: { jobID: 'motion-1', status: 'COMPLETED', variationID: 0, bvhURL: asset },
  search_motions: { items: [{ motionID: 'motion-1', title: 'Walk', mp4URL: asset }], pageSize: 20, hasMore: false, lastSort: [0, 'motion-1'] },
  list_motions: { items: [{ jobID: 'motion-1', variationID: 0, bvhURL: asset }] }, create_scene: scene,
  list_motion_edits: { jobs: [edit] }, get_motion_edit: edit, save_key_poses: { status: 204 },
  export_scene: exports, get_scene_exports: exports,
};
