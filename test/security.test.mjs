import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { definitions, createServer } from '../src/server.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

test('the public tool surface cannot change accounts, callbacks, or arbitrary routes', () => {
  assert.equal(definitions.length, 10);
  assert.deepEqual(definitions.filter(t => !t.annotations.readOnlyHint).map(t => t.name), ['generate_motion']);
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

test('package allowlist excludes credentials and demo assets', () => {
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.deepEqual(manifest.files,['src','LICENSE','README.md']);
  const [pack]=JSON.parse(execFileSync('npm',['pack','--dry-run','--json','--ignore-scripts'],{cwd:new URL('../',import.meta.url),encoding:'utf8'}));
  for(const file of pack.files) assert.ok(/^(src\/|LICENSE$|README.md$|package.json$)/.test(file.path),file.path);
});
