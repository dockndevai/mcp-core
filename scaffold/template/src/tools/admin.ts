import { type ToolDef, jsonResult, textResult } from "@dockndevai/mcp-core";
import { z } from "zod";
import type { ToolContext } from "../context.js";

/**
 * Admin tools — registered only in admin mode, and this one is further gated: it stays unadvertised
 * until the delete flag is on (`enabledWhen`), needs that flag at call time (`destructive` +
 * `destructiveFlag`), and asks the human to confirm via elicitation.
 */
export const adminTools: ToolDef<ToolContext>[] = [
  {
    name: "delete___RESOURCE__",
    capability: "admin",
    destructive: true,
    enabledWhen: (policy) => policy.isFlagEnabled("delete"),
    config: {
      title: "Delete a __RESOURCE__",
      description: "Permanently delete a __RESOURCE__. Requires admin mode AND __ENV_PREFIX___ALLOW_DELETE=true.",
      inputSchema: { name: z.string().min(1).describe("The __RESOURCE__ name to delete.") },
    },
    handler: async (args, { client, policy, confirm }) => {
      const name = args.name as string;
      const { dryRun } = policy.guard({
        tool: "delete___RESOURCE__",
        capability: "admin",
        destructive: true,
        resources: { __RESOURCE__: { value: name, mutation: true } },
      });
      if (dryRun) return textResult(`[dry-run] Would delete __RESOURCE__ '${name}'.`);
      const ok = await confirm.confirm({ action: "delete __RESOURCE__", target: name });
      if (!ok.approved) return textResult(`Delete cancelled — ${ok.reason}.`);
      client.delete(name);
      return jsonResult({ deleted: true, name });
    },
  },
];
