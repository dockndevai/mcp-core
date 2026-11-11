# @dockndevai/mcp-core

The shared **governance library** for the [dockndevai](https://github.com/dockndevai) MCP server suite. It is the single audited implementation of the suite's safe-by-default security model, extracted so every server imports it instead of each carrying a near-identical copy.

> This is a **library**, not an MCP server. It has no `server.json`, no `mcpName`, and is not listed in any MCP registry. Node >= 22, ESM, TypeScript types included.

## Why

Every server in the suite shares one philosophy — **safe by default, least privilege, never leak secrets** — and had near-identical `security.ts`, `elicit.ts`, path canonicalization, and config helpers. Divergence is a security risk: a fix to the symlink allowlist-bypass or the guard flow had to be applied N times. `mcp-core` makes it one audited, unit-tested implementation. Domains supply only what is genuinely domain-specific (the resource label, which gates apply, the client); core owns the capability ranking, the guard flow, dry-run, elicitation, path safety, and the JSON audit line.

## Install

```bash
npm install @dockndevai/mcp-core
# peers (your server already depends on these):
npm install @modelcontextprotocol/sdk zod
```

## The model in one minute

- **Capabilities** — every tool is `read` | `write` | `admin`.
- **Access modes** — `read-only` (0) → `read-write` (1) → `admin` (2). A tool is registered only when its capability rank ≤ the mode rank, so over-privileged tools are never advertised.
- **Resources** — a named, scoped domain (a filesystem `path`, a Kafka `connector`, a `realm`, a `topic`, a `command`…). Each has an **allowlist** (empty = all) and a **protected** list (readable forever, never mutable), matched either by `prefix` (segment-aware, for hierarchical paths) or `exact` (for flat names).
- **Opt-in flags** — high-impact powers (exec, delete, input…) each need a second explicit flag on top of the mode.
- **Dry-run** — mutating ops can be validated + audited without executing.
- **Audit** — every decision emits one JSON line to **stderr** (never stdout — stdout belongs to the MCP transport).

## API overview

```ts
import {
  // policy engine
  SecurityPolicy, PolicyError,
  type Capability, type AccessMode, type PolicyConfig, type ResourceRule, type FlagRule, type GuardContext,
  isUnder,
  // human-in-the-loop confirmation
  makeConfirmer, type Confirmer, type ConfirmRequest, type ConfirmOutcome,
  // path safety (the audited symlink-bypass fix)
  resolvePath, resolveRealPath, canonicalize,
  // env parsing
  envBool, envList, envCsv, envNum, envEnum,
  // tool types + result helpers
  type ToolDef, type BaseToolContext, type ToolResult, type ContentBlock,
  jsonResult, textResult, imageResult,
  // annotations + server assembly
  annotationsFor, type ToolAnnotations,
  buildServer, defaultErrorMapper, type BuildServerOptions,
} from "@dockndevai/mcp-core";
```

### `SecurityPolicy`

```ts
const policy = new SecurityPolicy({
  mode: "read-only",
  auditTag: "my-server",          // the "audit" field of each JSON audit line
  dryRun: false,
  auditLog: true,
  resources: {
    path: {                        // key referenced from guard() contexts
      label: "path",
      match: "prefix",             // "prefix" (isUnder) | "exact"
      allowlist: ["/work"],        // empty = all allowed
      protected: ["/work/.secrets"],
      allowlistEnv: "MYSRV_PATH_ALLOWLIST",   // surfaced in denial messages
      protectedEnv: "MYSRV_PROTECTED_PATHS",
    },
  },
  flags: {
    exec: { enabled: false, env: "MYSRV_ALLOW_EXEC", describe: "runs arbitrary code" },
    delete: { enabled: false, env: "MYSRV_ALLOW_DELETE" },
  },
  destructiveFlag: "delete",       // optional: a `destructive` op also requires this flag
});

policy.isCapabilityEnabled("write");            // mode gate (use when registering)
policy.isFlagEnabled("exec");                   // flag state (use in enabledWhen)
policy.isResourceAllowed("path", "/work/a");    // allowlist check
policy.isResourceProtected("path", "/work/x");  // protected check
```

### `guard(ctx)` — call first in every handler

```ts
const { dryRun } = policy.guard({
  tool: "write_file",
  capability: "write",
  resources: { path: { value: abs, mutation: true } }, // mutation => protected refused
  requires: ["exec"],       // opt-in flags that must be enabled
  bypasses: ["command"],    // rule names whose allowlist this op could evade (e.g. shell -c)
  destructive: false,       // records in audit; gates destructiveFlag
});
if (dryRun) return textResult("[dry-run] Would …");
```

`guard()` throws `PolicyError` on any denial (capability, flag, bypass, allowlist, protected) and emits the matching audit line. It returns `{ dryRun }` — `true` only for mutating ops when `dryRun` is configured, never for reads.

### Path safety — `resolveRealPath` / `canonicalize`

The audited fix for the symlink allowlist-bypass: a symlink planted inside an allowlisted directory (or pointing at a protected one) must resolve to its **real** target before `guard()` sees it, because `fs` follows symlinks. Always guard on the canonical value and perform the op on it.

```ts
const abs = resolveRealPath(args.path);  // sync: ~-expand + realpath, parent-dir fallback for new leaves
policy.guard({ tool, capability: "read", resources: { path: { value: abs } } });
// or, async, when you resolvePath first:
const canon = await canonicalize(resolvePath(args.path));
```

### `makeConfirmer(server, options?)` — human-in-the-loop

Returns a `Confirmer`. When the client advertises elicitation, destructive tools pause for the **human** to approve the exact action:

- **Bound to the action.** `buildServer` gives each handler `confirm.forCall(tool, args)`, so the prompt shows the tool, the full (secret-redacted) arguments and a fingerprint (`sha256(tool + canonical args)`), and the approval receipt is written to the audit log (`"audit":"approval"`).
- **Bound to the target's version.** Pass `probe: () => Promise<string | undefined>` (etag, `resourceVersion`, `updated_at`, a content hash …). It is read before the prompt and again after the human answers; a different value refuses the action.
- **Fully reviewable.** Arguments are shown in full up to 16 000 chars; a longer action is refused (a human cannot approve what they cannot read) unless the call sets `summarizeLargeArgs: true` for an unreadable payload such as file contents.
- **Honest wording.** Pass `reversible: true` for actions that can be undone (moves, config changes) so the prompt does not claim they are irreversible. With `requireHuman`, a failed version read refuses the action instead of approving it unpinned.
- **Typed confirmation.** `typed: true` also requires the human to type the target name.
- **A prompt nobody answers is a refusal.** The wait defaults to 5 minutes (`approvalTimeoutMs`); a timeout never approves.
- **No human, no flags-only fallback — if you ask.** By default, when the client can't elicit the call falls back to `{ approved: true, interactive: false }` (the policy gate was the real control). With `requireHuman: true` (wire it to `<PREFIX>_REQUIRE_HUMAN_APPROVAL`) it is refused instead.

```ts
const ok = await confirm.confirm({
  action: "delete dashboard",
  target: uid,
  typed: true,
  probe: () => client.dashboardVersion(uid),
});
if (!ok.approved) return textResult(`Cancelled — ${ok.reason}.`);
```

### `buildServer(opts)` — register the enabled tools

```ts
const ctx: MyCtx = { policy, client, confirm: undefined as never };
const { server, enabled } = buildServer<MyCtx>({
  name: "my-server",
  version: "0.1.0",
  tools: [...readTools, ...writeTools, ...adminTools],
  context: ctx,
});
ctx.confirm = makeConfirmer(server);   // confirmer needs the server
```

A tool is registered only when `policy.isCapabilityEnabled(tool.capability)` **and** its optional `enabledWhen(policy)` passes (use it to keep the most dangerous tools hidden until an opt-in flag is on). Handlers are wrapped so thrown errors (including `PolicyError`) become a clean `isError` result via `defaultErrorMapper` (override with `mapError`).

## Scaffold a new server — `create-mcp-server`

A generator ships with the package. It copies a minimal, working server built on `mcp-core` (config + security wiring + server + index + one read/write/admin tool each + a test) and substitutes the name/resource.

```bash
npm create @dockndevai/mcp-server -- mcp-widget --resource widget
# or, once installed:
npx create-mcp-server mcp-widget --resource widget --dir ./mcp-widget
```

| Arg | Meaning |
| --- | --- |
| `<name>` | Server name, e.g. `mcp-widget` (an `mcp-` prefix is added if missing). |
| `--resource <label>` | The resource the server scopes (singular), e.g. `widget`. Default `item`. |
| `--dir <path>` | Target directory. Default `./<name>`. |

It derives the package name (`@dockndevai/<name>`), the env prefix (`WIDGET_`), and the tool names (`get_widget`, `update_widget`, `delete_widget`). Then:

```bash
cd mcp-widget && npm install
npm run typecheck && npm test && npm run build
```

Replace the in-memory stub in `src/client.ts` with your backend, adjust the resource rule in `src/security.ts`, and flesh out the tools. The governance primitives stay in `mcp-core` — never reimplement them.

## Migrating an existing server

See [MIGRATION.md](./MIGRATION.md) for the step-by-step: how a server replaces its local `security.ts` / `elicit.ts` / `canonicalize` / config helpers with `mcp-core` imports, and what stays domain-specific. Adoption is incremental — one server at a time, no big-bang.

## License

MIT
