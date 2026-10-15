import { buildServer, makeConfirmer } from "@dockndevai/mcp-core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "./client.js";
import type { ToolContext } from "./context.js";
import { loadPolicy } from "./security.js";
import { adminTools } from "./tools/admin.js";
import { readTools } from "./tools/read.js";
import { writeTools } from "./tools/write.js";

export const ALL_TOOLS = [...readTools, ...writeTools, ...adminTools];

export function build(): { server: McpServer; enabled: string[] } {
  const policy = loadPolicy();
  const client = new Client();
  // makeConfirmer needs the McpServer, so build the server first, then hand it the full context.
  const context = { policy, client } as ToolContext;
  const built = buildServer<ToolContext>({
    name: "__SERVER_NAME__",
    version: "0.1.0",
    tools: ALL_TOOLS,
    context,
  });
  context.confirm = makeConfirmer(built.server);
  return built;
}
