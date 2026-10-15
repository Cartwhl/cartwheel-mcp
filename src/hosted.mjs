#!/usr/bin/env node
import { createHostedServer, hostedConfig } from './hosted-server.mjs';

try {
  const config = hostedConfig();
  const server = createHostedServer(config);
  server.on('error', () => {
    console.error('Hosted MCP failed to listen. Check HOST and PORT.');
    process.exitCode = 1;
  });
  server.listen(config.port, config.listenHost, () => {
    console.log(`${config.motion ? 'Motion-enabled' : 'Profile-only'} MCP listening on ${config.listenHost}:${config.port}; public URL ${config.resource}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.close();
    setTimeout(() => server.closeAllConnections(), 5000).unref();
  });
} catch {
  console.error('Hosted MCP configuration is invalid. See docs/HOSTED.md; no credentials are printed.');
  process.exitCode = 1;
}
