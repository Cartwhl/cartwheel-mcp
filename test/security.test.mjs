import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { definitions, createServer } from '../src/server.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

test('the public tool surface cannot change accounts, callbacks, or arbitrary routes', () => {
  assert.equal(definitions.length, 22);
  assert.deepEqual(definitions.filter(t => !t.annotations.readOnlyHint).map(t => t.name), ['generate_motion','create_media_upload','generate_motion_from_video','create_scene','loop_motion','stitch_motions','edit_motion','edit_key_poses','apply_motion_edit']);
  for (const tool of definitions) {
    if (tool.handler) assert.equal(tool.handler, 'analyze_motion');
    else { assert.ok(tool.path.startsWith('/')); assert.ok(['GET', 'POST'].includes(tool.method)); }
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

test('package allowlist includes workflow sources and excludes secrets and rendered outputs', t => {
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.deepEqual(manifest.files,['src','LICENSE','README.md','examples/blender/*.py','examples/blender/README.md','examples/blender/assets/*.bvh','examples/comic4/*.mjs','examples/comic4/*.py','examples/comic4/README.md','examples/game/*.mjs','examples/game/*.html','examples/game/*.css','examples/game/*.json','examples/game/README.md','examples/game/ASSETS.md','examples/game/assets/*.glb','examples/game/assets/*.bvh','examples/game/assets/*.json']);
  const cache = mkdtempSync(join(tmpdir(), 'cartwheel-package-test-'));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  const [pack]=JSON.parse(execFileSync('npm',['pack','--dry-run','--json','--ignore-scripts'],{cwd:new URL('../',import.meta.url),encoding:'utf8',env:{...process.env,npm_config_cache:cache}}));
  for(const file of pack.files) assert.ok(/^(src\/|LICENSE$|README.md$|package.json$|examples\/blender\/[^/]+\.py$|examples\/blender\/README\.md$|examples\/blender\/assets\/[^/]+\.bvh$|examples\/comic4\/[^/]+\.(mjs|py)$|examples\/comic4\/README\.md$|examples\/game\/[^/]+\.(mjs|html|css|json)$|examples\/game\/(README|ASSETS)\.md$|examples\/game\/assets\/[^/]+\.(bvh|glb|json)$)/.test(file.path),file.path);
  for (const path of ['src/workflows/blender.md','src/workflows/comic4.md','examples/comic4/upload-video.mjs','examples/comic4/import_capture.py','examples/comic4/mhr_knees.py','examples/blender/motion.py','examples/blender/verify_motion.py','examples/blender/assets/dance_0.bvh']) assert.ok(pack.files.some(file => file.path === path), path);
  for (const path of ['src/workflows/game.md','src/game-tools.mjs','src/motion-analysis.mjs','src/motion-download.mjs','examples/game/serve.mjs','examples/game/prepare-game.mjs','examples/game/sample-poses.mjs','examples/game/assets/character.glb','examples/game/assets/run.motion.json']) assert.ok(pack.files.some(file => file.path === path), path);
  for (const file of pack.files.filter(f => f.path.startsWith('examples/game/assets/') && f.path.endsWith('.json'))) {
    const text = readFileSync(new URL(`../${file.path}`, import.meta.url), 'utf8');
    assert.equal(JSON.parse(text).schemaVersion, 1);
    assert.doesNotMatch(text, /https?:\/\/|X-Amz-|createdBy|x-api-key|staging|\/Users\//i);
  }
});
