import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { annotationsFor } from "./annotations.js";
import { PolicyError } from "./security.js";
import type { BaseToolContext, ToolDef, ToolResult } from "./tools.js";

export interface BuildServerOptions<Ctx extends BaseToolContext> {
  name: string;
  version: string;
  /** Every tool the server defines; only the enabled ones are registered. */
  tools: ToolDef<Ctx>[];
  /** The context handed to every handler — includes `policy`, `confirm`, the domain client, etc. */
  context: Ctx;
  /** Whether tools act on live external systems (annotation hint). Default true. */
  openWorld?: boolean;
  /** Map a thrown error to a tool result. Defaults to `defaultErrorMapper`. */
  mapError?: (err: unknown) => ToolResult;
}

/**
 * Register the enabled tools on a fresh `McpServer` and return it alongside the enabled names.
 *
 * A tool is registered only when its capability is <= the server's access mode AND its optional
 * `enabledWhen(policy)` gate passes — this is the suite's primary guarantee: over-privileged tools
 * are never advertised. Every handler is wrapped so thrown errors (policy denials included) become a
 * clean `isError` result instead of crashing the transport.
 */
export function buildServer<Ctx extends BaseToolContext>(
  opts: BuildServerOptions<Ctx>,
): { server: McpServer; enabled: string[] } {
  const { tools, context, name, version } = opts;
  const policy = context.policy;
  const server = new McpServer({ name, version });
  const mapError = opts.mapError ?? defaultErrorMapper;
  const openWorld = opts.openWorld ?? true;

  const enabled: string[] = [];
  for (const tool of tools) {
    if (!policy.isCapabilityEnabled(tool.capability)) continue;
    if (tool.enabledWhen && !tool.enabledWhen(policy)) continue;
    enabled.push(tool.name);
    server.registerTool(
      tool.name,
      { ...tool.config, annotations: annotationsFor(tool as ToolDef<BaseToolContext>, openWorld) },
      async (args: Record<string, unknown>) => {
        try {
          // Bind every approval prompt in this call to this tool + these exact arguments.
          const confirm = context.confirm?.forCall ? context.confirm.forCall(tool.name, args ?? {}) : context.confirm;
          return await tool.handler(args ?? {}, { ...context, confirm });
        } catch (err) {
          return mapError(err);
        }
      },
    );
  }

  return { server, enabled };
}

/** Standard error mapping: policy denials are prefixed; everything else is named-and-messaged. */
export function defaultErrorMapper(err: unknown): ToolResult {
  let message: string;
  if (err instanceof PolicyError) {
    message = `Policy denied: ${err.message}`;
  } else if (err instanceof Error) {
    message = `${err.name}: ${err.message}`;
  } else {
    message = String(err);
  }
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
