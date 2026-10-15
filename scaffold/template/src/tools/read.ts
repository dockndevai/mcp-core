import { type ToolDef, jsonResult } from "@dockndevai/mcp-core";
import { z } from "zod";
import type { ToolContext } from "../context.js";

/** Read tools — available in every mode. None mutate anything. */
export const readTools: ToolDef<ToolContext>[] = [
  {
    name: "get___RESOURCE__",
    capability: "read",
    config: {
      title: "Get a __RESOURCE__",
      description: "Fetch a single __RESOURCE__ by name. Honours the allowlist.",
      inputSchema: { name: z.string().min(1).describe("The __RESOURCE__ name.") },
    },
    handler: async (args, { client, policy }) => {
      const name = args.name as string;
      // guard() throws (mapped to an error result) if the name is outside the allowlist.
      policy.guard({ tool: "get___RESOURCE__", capability: "read", resources: { __RESOURCE__: { value: name } } });
      return jsonResult(client.get(name));
    },
  },
];
