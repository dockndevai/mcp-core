#!/usr/bin/env node
/**
 * MCP server for __RESOURCE__s — built on @dockndevai/mcp-core.
 *
 * Safe by default: starts in read-only mode, every mutation gated behind access mode, the resource
 * allowlist, protected resources, and the __ENV_PREFIX___ALLOW_DELETE flag. Every guarded op emits a
 * JSON audit line to stderr. See src/security.ts.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { build } from "./server.js";

async function main(): Promise<void> {
  const { server, enabled } = build();
  process.stderr.write(`[__SERVER_NAME__] Started. ${enabled.length} tools enabled: ${enabled.join(", ")}\n`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[__SERVER_NAME__] Fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
