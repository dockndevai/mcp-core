/**
 * @dockndevai/mcp-core — the shared governance library for the dockndevai MCP server suite.
 *
 * It provides the single audited implementation of the suite's safe-by-default security model
 * (capability ranking + access-mode gating, a generic resource allowlist / protected-resource /
 * opt-in-flag policy, human-in-the-loop confirmation, path canonicalization, env parsing, tool-result
 * helpers, and a `buildServer` that registers only the enabled tools). Domains supply the specifics;
 * core owns the ranking, the guard flow, dry-run, and the audit line.
 */

export {
  type AccessMode,
  type Capability,
  type FlagRule,
  type GuardContext,
  type PolicyConfig,
  PolicyError,
  type ResourceRule,
  SecurityPolicy,
  isUnder,
} from "./security.js";

export {
  type ApprovalReceipt,
  type ConfirmOutcome,
  type ConfirmRequest,
  type Confirmer,
  type ConfirmerOptions,
  canonicalArgs,
  fingerprint,
  makeConfirmer,
} from "./elicit.js";

export { canonicalize, resolvePath, resolveRealPath } from "./path.js";

export { envBool, envCsv, envEnum, envList, envNum } from "./env.js";

export {
  type BaseToolContext,
  type ContentBlock,
  type ToolDef,
  type ToolResult,
  imageResult,
  jsonResult,
  textResult,
} from "./tools.js";

export { type ToolAnnotations, annotationsFor } from "./annotations.js";

export { type BuildServerOptions, buildServer, defaultErrorMapper } from "./server.js";
