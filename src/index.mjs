#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.mjs';

try {
  const server = createServer({ apiKey: process.env.CARTWHEEL_API_KEY });
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
