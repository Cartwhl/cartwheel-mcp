import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { definitions, createServer } from '../src/server.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

test('the public tool surface cannot change accounts, callbacks, or arbitrary routes', () => {
  assert.equal(definitions.length, 13);
  assert.deepEqual(definitions.filter(t => !t.annotations.readOnlyHint).map(t => t.name), ['generate_motion','create_media_upload','generate_motion_from_video']);
  for (const tool of definitions) {
    assert.ok(tool.path.startsWith('/'));
    assert.ok(['GET', 'POST'].includes(tool.method));
    assert.equal(tool.inputSchema.additionalProperties, false);
    const schema=JSON.stringify(tool.inputSchema);
    for (const hidden of ['createdByUser','callbackURL','subscribers','s3Key','requestedByUser']) assert.ok(!schema.includes(hidden));
  }
});

test('only the production origin receives credentials', async t => {
  const seen=[];
  const server=createServer({apiKey:'test-key', baseUrl:'https://attacker.example', fetchImpl:async(url, options)=>{
    seen.push({url,options}); return Response.json({characters:[]});
  }});
  const client=new Client({name:'security-test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
  t.after(async()=>{await client.close();await server.close();});
  await client.callTool({name:'list_characters',arguments:{}});
  assert.equal(seen[0].url.origin,'https://external-mogen.api.getcartwheel.com');
  assert.equal(seen[0].options.redirect,'error');
});

test('package allowlist includes workflow sources and excludes secrets and rendered outputs', () => {
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.deepEqual(manifest.files,['src','LICENSE','README.md','examples/blender/*.py','examples/blender/README.md','examples/blender/assets/*.bvh','examples/comic4/*.mjs','examples/comic4/*.py','examples/comic4/README.md']);
  const [pack]=JSON.parse(execFileSync('npm',['pack','--dry-run','--json','--ignore-scripts'],{cwd:new URL('../',import.meta.url),encoding:'utf8'}));
  for(const file of pack.files) assert.ok(/^(src\/|LICENSE$|README.md$|package.json$|examples\/blender\/[^/]+\.py$|examples\/blender\/README\.md$|examples\/blender\/assets\/[^/]+\.bvh$|examples\/comic4\/[^/]+\.(mjs|py)$|examples\/comic4\/README\.md$)/.test(file.path),file.path);
  for (const path of ['src/workflows/blender.md','src/workflows/comic4.md','examples/comic4/upload-video.mjs','examples/comic4/import_capture.py','examples/comic4/mhr_knees.py','examples/blender/motion.py','examples/blender/verify_motion.py','examples/blender/assets/dance_0.bvh']) assert.ok(pack.files.some(file => file.path === path), path);
});
