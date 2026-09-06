import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ListPromptsRequestSchema, GetPromptRequestSchema,
  ListResourcesRequestSchema, ReadResourceRequestSchema,
  McpError, ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';

export const workflowUri = 'cartwheel://workflows/blender';
export const workflowPrompt = 'grounded_blender_scene';
const guide = readFileSync(new URL('./workflows/blender.md', import.meta.url), 'utf8');
const examplesDirectory = fileURLToPath(new URL('../examples/blender/', import.meta.url));
const workflow = `${guide}\nInstalled example directory: ${examplesDirectory}\n`;
const invalid = message => new McpError(ErrorCode.InvalidParams, message);

export function registerBlenderWorkflow(server) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{
    uri: workflowUri, name: 'grounded_blender_workflow', title: 'Grounded Cartwheel → Blender',
    description: 'The default motion, Gaussian contact, validation, and rendering workflow.', mimeType: 'text/markdown',
  }] }));
  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    if (params.uri !== workflowUri) throw invalid('Unknown Cartwheel resource');
    return { contents: [{ uri: workflowUri, mimeType: 'text/markdown', text: workflow }] };
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{
    name: workflowPrompt, title: 'Create a grounded Blender scene',
    description: 'Use the approved retargeting, contact easing, and render checks with Cartwheel motion.',
    arguments: [{ name: 'scene', description: 'Optional description of the scene or motion to create.', required: false }],
  }] }));
  server.setRequestHandler(GetPromptRequestSchema, async ({ params }) => {
    if (params.name !== workflowPrompt) throw invalid('Unknown Cartwheel prompt');
    const args = params.arguments ?? {};
    if (Object.keys(args).some(key => key !== 'scene')) throw invalid('Unknown Blender workflow argument');
    if (args.scene !== undefined && (typeof args.scene !== 'string' || args.scene.length > 4000)) {
      throw invalid('Scene description must be a string of at most 4000 characters');
    }
    return { description: 'Grounded Blender scene workflow', messages: [
      { role: 'user', content: { type: 'text', text: workflow } },
      ...(args.scene ? [{ role: 'user', content: { type: 'text', text: `Requested scene:\n${args.scene}` } }] : []),
    ] };
  });
}
