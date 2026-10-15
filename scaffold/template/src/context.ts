import type { BaseToolContext } from "@dockndevai/mcp-core";
import type { Client } from "./client.js";

/** What every __SERVER_NAME__ tool handler receives: the mcp-core base plus the domain client. */
export interface ToolContext extends BaseToolContext {
  client: Client;
}
