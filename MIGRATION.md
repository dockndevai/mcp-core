# Migrating a suite server onto `@dockndevai/mcp-core`

This guide shows how an existing server replaces its local `security.ts`, `elicit.ts`, path
canonicalization, config helpers, tool types, annotations, and server-assembly with `mcp-core`
imports — **incrementally**, one server at a time, with no behaviour change.

The golden rule is unchanged: **safe by default, least privilege, never leak secrets.** `mcp-core`
owns the capability ranking, the guard flow, dry-run, elicitation, path safety, and the audit line.
Your server keeps everything genuinely domain-specific.

## What moves to mcp-core vs. what stays

| Concern | Before (local file) | After |
| --- | --- | --- |
| Capability ranking + access-mode gating | `security.ts` | **mcp-core** `SecurityPolicy` |
| Resource allowlist / protected / opt-in flags / dry-run / audit | `security.ts` | **mcp-core** `SecurityPolicy` + `guard()` |
| Human-in-the-loop confirmation (bound to tool + args + resource version) | `elicit.ts` | **mcp-core** `makeConfirmer` / `Confirmer` |
| Path canonicalization (symlink-bypass fix) | `config.ts` `resolveRealPath` / `canonicalize` | **mcp-core** `resolveRealPath` / `canonicalize` / `resolvePath` |
| Env parsing (`bool`/`csv`/`num`) | `config.ts` | **mcp-core** `envBool` / `envList` / `envNum` / `envEnum` |
| Tool types + result helpers | `tools/types.ts` | **mcp-core** `ToolDef` / `BaseToolContext` / `jsonResult` / `textResult` / `imageResult` |
| Annotations | `tools/annotations.ts` | **mcp-core** `annotationsFor` |
| Tool registration + error wrapping | `server.ts` | **mcp-core** `buildServer` / `defaultErrorMapper` |
| **Domain client** (SDK/REST wrapper) | `src/<domain>/client.ts` | **stays** — unchanged |
| **Tool definitions** (the tools themselves) | `tools/{read,write,admin}.ts` | **stays** — re-pointed imports only |
| **Env var names + defaults** (incl. full-control inversion, SAFE_PROTECTED) | `config.ts` | **stays** — `config.ts` now builds a `PolicyConfig` |
| **Extra context** (e.g. laya-guard `GuardClient`) | `guard.ts`, context type | **stays** — add to your own `ToolContext` |
| **Error subclasses** (e.g. `MacError`) + redaction | domain files | **stays** — pass a custom `mapError` |

Net effect: `security.ts`, `elicit.ts`, `tools/types.ts`, and `tools/annotations.ts` are **deleted**;
`config.ts` and `server.ts` shrink to domain wiring.

## Step 1 — add the dependency

```bash
npm install @dockndevai/mcp-core
```

`@modelcontextprotocol/sdk` and `zod` are peer deps you already have.

## Step 2 — delete `elicit.ts`, import from core

`mcp-core`'s `elicit.ts` is byte-for-byte the suite's implementation. Delete the local file and:

```diff
- import { makeConfirmer, type Confirmer } from "./elicit.js";
+ import { makeConfirmer, type Confirmer } from "@dockndevai/mcp-core";
```

## Step 3 — move path canonicalization to core

Delete the local `resolveRealPath` / `canonicalize` from `config.ts` and import them. `resolvePath`,
`resolveRealPath` (sync) and `canonicalize` (async) all come from core and behave identically.

```diff
- import { resolveRealPath } from "../config.js";
+ import { resolveRealPath } from "@dockndevai/mcp-core";
```

## Step 4 — rewrite `config.ts` to build a `PolicyConfig`

Keep your env-var names and defaults (including any full-control-by-default inversion and the
`SAFE_PROTECTED` list). Replace the local `bool`/`csv`/`num` with core's `envBool`/`envList`/`envNum`,
and emit a `PolicyConfig` instead of the old `SecurityConfig`.

**Path-scoped server (mac-control / macos):**

```ts
import { type PolicyConfig, envBool, envEnum, envList, resolveRealPath } from "@dockndevai/mcp-core";

export function loadPolicyConfig(): PolicyConfig {
  const safeMode = envBool("MACCTL_SAFE_MODE", false);
  const protectedRaw = envList("MACCTL_PROTECTED_PATHS");
  return {
    mode: envEnum("MACCTL_MODE", ["read-only", "read-write", "admin"] as const, safeMode ? "read-only" : "admin"),
    auditTag: "mac-control",
    dryRun: envBool("MACCTL_DRY_RUN", false),
    auditLog: envBool("MACCTL_AUDIT_LOG", true),
    resources: {
      path: {
        label: "path",
        match: "prefix",
        allowlist: envList("MACCTL_PATH_ALLOWLIST").map(resolveRealPath),
        protected: (protectedRaw.length ? protectedRaw : safeMode ? SAFE_PROTECTED : []).map(resolveRealPath),
        allowlistEnv: "MACCTL_PATH_ALLOWLIST",
        protectedEnv: "MACCTL_PROTECTED_PATHS",
      },
      command: {
        label: "program",
        match: "exact",
        allowlist: envList("MACCTL_COMMAND_ALLOWLIST"),
        allowlistEnv: "MACCTL_COMMAND_ALLOWLIST",
      },
    },
    flags: {
      exec: { enabled: envBool("MACCTL_ALLOW_EXEC", !safeMode), env: "MACCTL_ALLOW_EXEC", describe: "runs arbitrary code or kills a process" },
      delete: { enabled: envBool("MACCTL_ALLOW_DELETE", !safeMode), env: "MACCTL_ALLOW_DELETE" },
      input: { enabled: envBool("MACCTL_ALLOW_INPUT", !safeMode), env: "MACCTL_ALLOW_INPUT", describe: "injects GUI input" },
    },
  };
}
```

**REST name-scoped server (debezium):**

```ts
import { type PolicyConfig, envBool, envEnum, envList } from "@dockndevai/mcp-core";

export function loadPolicyConfig(): PolicyConfig {
  return {
    mode: envEnum("DEBEZIUM_MODE", ["read-only", "read-write", "admin"] as const, "read-only"),
    auditTag: "debezium-mcp",
    dryRun: envBool("DEBEZIUM_DRY_RUN"),
    auditLog: envBool("DEBEZIUM_AUDIT_LOG", true),
    resources: {
      connector: {
        label: "connector",
        match: "exact",
        allowlist: envList("DEBEZIUM_CONNECTOR_ALLOWLIST"),
        protected: envList("DEBEZIUM_PROTECTED_CONNECTORS"),
        allowlistEnv: "DEBEZIUM_CONNECTOR_ALLOWLIST",
        protectedEnv: "DEBEZIUM_PROTECTED_CONNECTORS",
      },
    },
    flags: { delete: { enabled: envBool("DEBEZIUM_ALLOW_DELETE"), env: "DEBEZIUM_ALLOW_DELETE" } },
    destructiveFlag: "delete",   // preserves the `destructive && !allowDelete` shape
  };
}
```

## Step 5 — update `guard()` call sites in the tools

The guard context changes from flat fields to the `resources` / `requires` / `bypasses` shape. The
semantics are identical.

**Path-scoped:**

```diff
- policy.guard({ tool: "read_file", capability: "read", path: abs });
+ policy.guard({ tool: "read_file", capability: "read", resources: { path: { value: abs } } });

- policy.guard({ tool: "write_file", capability: "write", path: abs, pathMutation: true });
+ policy.guard({ tool: "write_file", capability: "write", resources: { path: { value: abs, mutation: true } } });

- policy.guard({ tool: "run_command", capability: "admin", command: basename(cmd),
-                shellEscape: isShellEscape(cmd, argv), requiresExec: true, destructive: true });
+ policy.guard({ tool: "run_command", capability: "admin",
+                resources: { command: { value: basename(cmd) } },
+                bypasses: ["command"],          // only matters when the command allowlist is set
+                requires: ["exec"], destructive: true });

- policy.guard({ tool: "delete_path", capability: "admin", requiresDelete: true, destructive: true, path: abs, pathMutation: true });
+ policy.guard({ tool: "delete_path", capability: "admin", requires: ["delete"], destructive: true,
+                resources: { path: { value: abs, mutation: true } } });

- policy.guard({ tool: "type_text", capability: "admin", requiresInput: true });
+ policy.guard({ tool: "type_text", capability: "admin", requires: ["input"] });
```

`bypasses: ["command"]` replaces the `shellEscape` boolean: pass it when the op (a shell `-c`) could
run outside the named allowlist; core refuses it only while that rule's allowlist is non-empty.

**REST name-scoped:** the old code refused mutation of a protected connector when
`capability !== "read"`. Express that as `mutation`:

```diff
- policy.guard({ tool: "delete_connector", capability: "admin", connector: name, destructive: true });
+ policy.guard({ tool: "delete_connector", capability: "admin", destructive: true,
+                resources: { connector: { value: name, mutation: true } } });

- policy.guard({ tool: "get_connector", capability: "read", connector: name });
+ policy.guard({ tool: "get_connector", capability: "read", resources: { connector: { value: name } } });
```

Also replace helper calls: `policy.isPathAllowed(p)` → `policy.isResourceAllowed("path", p)`,
`policy.isPathProtected(p)` → `policy.isResourceProtected("path", p)`,
`policy.isCommandAllowed(c)` → `policy.isResourceAllowed("command", c)`.

## Step 6 — tool types, results, annotations

Delete `tools/types.ts` and `tools/annotations.ts`. In your tool files:

```diff
- import { type ToolDef, jsonResult, textResult, imageResult } from "./types.js";
+ import { type ToolDef, jsonResult, textResult, imageResult } from "@dockndevai/mcp-core";
```

Define your own context by extending `BaseToolContext` (this is where extra context such as the
laya-guard `GuardClient` stays):

```ts
import type { BaseToolContext } from "@dockndevai/mcp-core";
import type { MacClient } from "../mac/client.js";
import type { GuardClient } from "../guard.js";

export interface ToolContext extends BaseToolContext {
  client: MacClient;
  guard: GuardClient;   // domain-specific — stays
}
```

Tool definitions become `ToolDef<ToolContext>`. Keep the `capability` tag honest and set
`destructive` where it applied. Use `enabledWhen: (p) => p.isFlagEnabled("exec")` to keep the most
dangerous tools unregistered until their flag is on (replacing any manual filtering in `server.ts`).

## Step 7 — rewrite `server.ts` with `buildServer`

```ts
import { buildServer, makeConfirmer, defaultErrorMapper, type ToolResult } from "@dockndevai/mcp-core";
import { MacError } from "./mac/client.js";

export function build() {
  const policy = new SecurityPolicy(loadPolicyConfig());
  const client = new MacClient(loadLimits());
  const guard = new GuardClient(loadGuardConfig());
  const context = { policy, client, guard } as ToolContext;  // confirm set below

  const built = buildServer<ToolContext>({
    name: "mac-control",
    version: "0.4.0",
    tools: [...readTools, ...writeTools, ...adminTools],
    context,
    mapError,   // keep domain error handling (e.g. MacError) — see below
  });
  context.confirm = makeConfirmer(built.server);
  return built;
}

// Keep domain-specific error mapping (and redaction) by wrapping the default.
function mapError(err: unknown): ToolResult {
  if (err instanceof MacError) return { content: [{ type: "text", text: err.message }], isError: true };
  return defaultErrorMapper(err);
}
```

## Step 8 — port the tests, verify

Point the server's `test/security.test.ts` at the new `PolicyConfig` shape (mcp-core already carries
the exhaustive guard/elicit/path-canonicalization tests, so the server's own suite can shrink to
domain wiring smoke tests — mirroring the generated scaffold's `test/security.test.ts`). Then:

```bash
npm run typecheck && npm test && npm run build
npm audit   # expect 0 vulnerabilities
```

Nothing about the operator-facing env vars, defaults, or guarantees changes — only where the code
lives. Bump the server's version, keep `server.json` in sync, and cut a release as usual.
