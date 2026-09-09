import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ListPromptsRequestSchema, GetPromptRequestSchema,
  ListResourcesRequestSchema, ReadResourceRequestSchema,
  McpError, ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';

export const workflowUri = 'cartwheel://workflows/blender';
export const workflowPrompt = 'grounded_blender_scene';
export const comicWorkflowUri = 'cartwheel://workflows/comic4';
export const comicWorkflowPrompt = 'comic4_blender_scene';
export const gameWorkflowUri = 'cartwheel://workflows/game';
export const gameWorkflowPrompt = 'game_ready_animation';
export const hermesWorkflowUri = 'cartwheel://workflows/hermes';
export const hermesWorkflowPrompt = 'hermes_motion';
export const characterWorkflowUri = 'cartwheel://workflows/characters';
export const characterWorkflowPrompt = 'create_rigged_character';
const workflows = [
  { uri: workflowUri, prompt: workflowPrompt, name: 'grounded_blender_workflow',
    title: 'Grounded Cartwheel → Blender',
    description: 'Generate text motion, retarget with Gaussian contact easing, and verify a Blender scene.',
    file: 'blender.md', directory: 'blender' },
  { uri: comicWorkflowUri, prompt: comicWorkflowPrompt, name: 'comic4_blender_workflow',
    title: 'Comic 4 → editable Blender performance',
    description: 'Upload a video, capture up to four actors with faces, preserve their shared placement, and reveal a new camera angle.',
    file: 'comic4.md', directory: 'comic4' },
  { uri: gameWorkflowUri, prompt: gameWorkflowPrompt, name: 'game_animation_workflow',
    title: 'Cartwheel Hermes → playable game animation',
    description: 'Generate with Hermes, prepare compatible clips and metadata, and run the complete Three.js game reference.',
    file: 'game.md', directory: 'game' },
  { uri: hermesWorkflowUri, prompt: hermesWorkflowPrompt, name: 'hermes_motion_workflow',
    title: 'Hermes → text generation and motion editing',
    description: 'Generate Hermes body motion from text, use paths, poses, hand/foot controls and curved repathing, then review and export.',
    file: 'hermes.md', directory: 'game' },
  { uri: characterWorkflowUri, prompt: characterWorkflowPrompt, name: 'character_workflow',
    title: 'Cartwheel → character creation and auto-rigging',
    description: 'Generate a character from text or an image, or upload and auto-rig a model, then retrieve the rigged assets and animate.',
    file: 'characters.md', directory: 'characters', argument: 'character' },
].map(w => ({ ...w, text: `${readFileSync(new URL(`./workflows/${w.file}`, import.meta.url), 'utf8')}\nInstalled example directory: ${fileURLToPath(new URL(`../examples/${w.directory}/`, import.meta.url))}\n` }));
const invalid = message => new McpError(ErrorCode.InvalidParams, message);

export function registerWorkflows(server) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: workflows.map(w => ({
    uri: w.uri, name: w.name, title: w.title, description: w.description, mimeType: 'text/markdown',
  })) }));
  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    const w = workflows.find(w => w.uri === params.uri);
    if (!w) throw invalid('Unknown Cartwheel resource');
    return { contents: [{ uri: w.uri, mimeType: 'text/markdown', text: w.text }] };
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: workflows.map(w => ({
    name: w.prompt, title: w.title, description: w.description,
    arguments: [{ name: w.argument ?? 'scene', description: 'Optional description of what you want to create.', required: false }],
  })) }));
  server.setRequestHandler(GetPromptRequestSchema, async ({ params }) => {
    const w = workflows.find(w => w.prompt === params.name);
    if (!w) throw invalid('Unknown Cartwheel prompt');
    const args = params.arguments ?? {};
    const argument = w.argument ?? 'scene';
    if (Object.keys(args).some(key => key !== argument)) throw invalid('Unknown workflow argument');
    if (args[argument] !== undefined && (typeof args[argument] !== 'string' || args[argument].length > 4000)) {
      throw invalid('Workflow description must be a string of at most 4000 characters');
    }
    return { description: w.description, messages: [
      { role: 'user', content: { type: 'text', text: w.text } },
      ...(args[argument] ? [{ role: 'user', content: { type: 'text', text: `Requested ${argument}:\n${args[argument]}` } }] : []),
    ] };
  });
}
