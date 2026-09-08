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
const workflows = [
  { uri: workflowUri, prompt: workflowPrompt, name: 'grounded_blender_workflow',
    title: 'Grounded Cartwheel → Blender',
    description: 'Generate text motion, retarget with Gaussian contact easing, and verify a Blender scene.',
    file: 'blender.md', directory: 'blender' },
  { uri: comicWorkflowUri, prompt: comicWorkflowPrompt, name: 'comic4_blender_workflow',
    title: 'Comic 4 → editable Blender performance',
    description: 'Upload a video, capture up to four actors with faces, preserve their shared placement, and reveal a new camera angle.',
    file: 'comic4.md', directory: 'comic4' },
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
    arguments: [{ name: 'scene', description: 'Optional description of the intended scene or performance.', required: false }],
  })) }));
  server.setRequestHandler(GetPromptRequestSchema, async ({ params }) => {
    const w = workflows.find(w => w.prompt === params.name);
    if (!w) throw invalid('Unknown Cartwheel prompt');
    const args = params.arguments ?? {};
    if (Object.keys(args).some(key => key !== 'scene')) throw invalid('Unknown Blender workflow argument');
    if (args.scene !== undefined && (typeof args.scene !== 'string' || args.scene.length > 4000)) {
      throw invalid('Scene description must be a string of at most 4000 characters');
    }
    return { description: w.description, messages: [
      { role: 'user', content: { type: 'text', text: w.text } },
      ...(args.scene ? [{ role: 'user', content: { type: 'text', text: `Requested scene:\n${args.scene}` } }] : []),
    ] };
  });
}
