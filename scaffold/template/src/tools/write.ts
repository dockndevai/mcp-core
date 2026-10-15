import { type ToolDef, jsonResult, textResult } from "@dockndevai/mcp-core";
import { z } from "zod";
import type { ToolContext } from "../context.js";

/** Write tools — registered in read-write mode and up. Reversible, scoped mutations. */
export const writeTools: ToolDef<ToolContext>[] = [
  {
    name: "update___RESOURCE__",
    capability: "write",
    config: {
      title: "Update a __RESOURCE__",
      description: "Create or update a __RESOURCE__'s value. Honours the allowlist and refuses protected names.",
      inputSchema: {
        name: z.string().min(1).describe("The __RESOURCE__ name."),
        value: z.string().describe("The new value."),
      },
    },
    handler: async (args, { client, policy }) => {
      const name = args.name as string;
      const value = args.value as string;
      const { dryRun } = policy.guard({
        tool: "update___RESOURCE__",
        capability: "write",
        resources: { __RESOURCE__: { value: name, mutation: true } },
      });
      if (dryRun) return textResult(`[dry-run] Would set __RESOURCE__ '${name}'.`);
      client.set(name, value);
      return jsonResult({ updated: true, name });
    },
  },
];
