#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import { gameDefinitions } from '../../src/game-tools.mjs';
import { inspectBVH, prepareMotion } from '../../src/motion-analysis.mjs';

const analysis = gameDefinitions.find(t => t.name === 'analyze_motion').inputSchema;
const { motionID, characterID, bodyIndex, fps, ...properties } = analysis.properties;
export const preparationSchema = {
  type: 'object', additionalProperties: false,
  required: analysis.required.filter(k => k !== 'motionID'),
  properties: { ...properties,
    rootMotion: { enum: ['preserve', 'in_place'] },
    authoredEvents: { type: 'array', maxItems: 1000, items: { type: 'object', additionalProperties: false, required: ['name', 'frame'], properties: { name: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,80}$' }, frame: { type: 'integer', minimum: 0 } } } },
    provenance: { type: 'object', additionalProperties: false, properties: { motionID, characterID, bodyIndex, prompt: { type: 'string', maxLength: 4000 }, model: { type: 'string', enum: ['swing', 'scoot', 'comic4'] } } },
  },
};
const validate = new Ajv({ strict: false }).compile(preparationSchema);

export async function prepareFile(input, options, output) {
  if (!validate(options)) throw Error(`Invalid preparation options: ${JSON.stringify(validate.errors)}`);
  const { metadata, bvh } = prepareMotion(await readFile(input, 'utf8'), options);
  if (options.provenance) metadata.source.provenance = options.provenance;
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(`${output}.bvh`, bvh);
  await writeFile(`${output}.motion.json`, `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

async function main() {
  const { values } = parseArgs({ options: { input: { type: 'string' }, options: { type: 'string' }, out: { type: 'string' }, inspect: { type: 'boolean' } } });
  if (!values.input || (!values.inspect && (!values.options || !values.out))) throw Error('Usage: node prepare-game.mjs --input motion.bvh --inspect | --options preparation.json --out public/walk');
  if (values.inspect) {
    const b = inspectBVH(await readFile(values.input, 'utf8'));
    console.log(JSON.stringify({ frameCount: b.frameCount, fps: 1 / b.frameTime, joints: b.joints }, null, 2));
    return;
  }
  const m = await prepareFile(values.input, JSON.parse(await readFile(values.options, 'utf8')), values.out);
  console.log(JSON.stringify({ bvh: `${values.out}.bvh`, metadata: `${values.out}.motion.json`, timing: m.timing, referenceSpeed: m.rootMotion.referenceSpeedMetersPerSecond, setupFrame: m.setupFrame, warnings: m.warnings }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
