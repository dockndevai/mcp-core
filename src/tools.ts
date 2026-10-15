import type { ZodRawShape } from "zod";
import type { Confirmer } from "./elicit.js";
import type { Capability, SecurityPolicy } from "./security.js";

/**
 * The minimum a tool handler is handed. Domains extend this with their own client and any extras
 * (an AI risk gate, a cache, …) and pass the concrete type to `ToolDef`/`buildServer`.
 */
export interface BaseToolContext {
  policy: SecurityPolicy;
  /** Human-in-the-loop confirmation (no-op fallback when the client can't elicit). */
  confirm: Confirmer;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ContentBlock[];
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * A single MCP tool, tagged with the capability that governs whether it is registered.
 * Generic over the domain's `ToolContext` (which must at least be a `BaseToolContext`).
 */
export interface ToolDef<Ctx extends BaseToolContext = BaseToolContext, Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  capability: Capability;
  /** Marks a mutating tool as destructive (irreversible / high-impact). Defaults to `capability === "admin"`. */
  destructive?: boolean;
  /** Overrides the idempotency hint. Defaults to `true` for read tools, `false` otherwise. */
  idempotent?: boolean;
  /**
   * Extra registration gate beyond capability — e.g. only register when an opt-in flag is enabled.
   * Returning `false` keeps the tool unadvertised (the most dangerous tools stay hidden until opted in).
   */
  enabledWhen?: (policy: SecurityPolicy) => boolean;
  config: {
    title: string;
    description: string;
    inputSchema: Shape;
  };
  handler: (args: Record<string, unknown>, ctx: Ctx) => Promise<ToolResult>;
}

export function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function imageResult(base64: string, mimeType = "image/png", caption?: string): ToolResult {
  const content: ContentBlock[] = [{ type: "image", data: base64, mimeType }];
  if (caption) content.unshift({ type: "text", text: caption });
  return { content };
}
