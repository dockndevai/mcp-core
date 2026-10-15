import type { BaseToolContext, ToolDef } from "./tools.js";

/**
 * MCP tool annotations — machine-readable behaviour hints the host reads to decide what to
 * auto-approve versus prompt on. See https://modelcontextprotocol.io/docs/concepts/tools#tool-annotations
 */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * Derive annotations from a tool's declared capability, so the safe-by-default access model is
 * exposed to the host rather than hidden in the description.
 *
 * - `read`  ⇒ read-only, non-destructive, idempotent.
 * - `write` ⇒ mutating; non-destructive unless the tool sets `destructive`.
 * - `admin` ⇒ mutating and destructive (data loss possible) unless the tool overrides it.
 *
 * `openWorldHint` defaults to true (these servers act on live external systems); pass `false` for a
 * server whose effects are fully local and closed.
 */
export function annotationsFor(tool: ToolDef<BaseToolContext>, openWorld = true): ToolAnnotations {
  const readOnly = tool.capability === "read";
  const destructive = tool.destructive ?? tool.capability === "admin";
  return {
    title: tool.config.title,
    readOnlyHint: readOnly,
    destructiveHint: readOnly ? false : destructive,
    idempotentHint: tool.idempotent ?? readOnly,
    openWorldHint: openWorld,
  };
}
