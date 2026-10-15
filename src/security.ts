/**
 * Generic policy engine for the dockndevai MCP server suite.
 *
 * This is the SINGLE audited implementation of the suite's safe-by-default security model,
 * extracted so every server shares it rather than each carrying a near-identical copy. It is
 * pure logic — no I/O beyond the JSON audit line to stderr — and fully unit-tested.
 *
 * The invariants it enforces (identical across every server):
 *   1. Capability vs. access mode — a tool's capability must be <= the server's mode. Combined
 *      with `isCapabilityEnabled`, over-privileged tools are never even registered.
 *   2. Resource allowlist — only named/rooted resources (paths, connectors, realms, topics, …)
 *      may be touched; empty allowlist = all.
 *   3. Protected resources — readable forever, never mutable.
 *   4. Opt-in flags — high-impact powers (exec, delete, input, …) each need a second explicit flag.
 *   5. Dry-run — mutating ops can be validated + audited without executing.
 *   6. Audit — every decision emits one JSON line to stderr (never stdout).
 *
 * The DOMAIN supplies the specifics via `PolicyConfig`: the resource rules (their label, env-var
 * names, and match strategy), the opt-in flags (their enabled state + env-var name), and the audit
 * tag. Core owns the ranking, the guard flow, dry-run, and the audit line.
 */

export type Capability = "read" | "write" | "admin";
export type AccessMode = "read-only" | "read-write" | "admin";

const MODE_RANK: Record<AccessMode, number> = { "read-only": 0, "read-write": 1, admin: 2 };
const CAPABILITY_RANK: Record<Capability, number> = { read: 0, write: 1, admin: 2 };

/** True when `p` is `root` or lives under it (segment-boundary aware — no partial-segment match). */
export function isUnder(p: string, root: string): boolean {
  if (root === "/") return p === "/" || p.startsWith("/");
  return p === root || p.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/**
 * A named resource domain the policy scopes — e.g. filesystem `path`, Kafka `connector`,
 * Keycloak `realm`, a Kafka `topic`, or a `command` name for an exec allowlist.
 */
export interface ResourceRule {
  /** Human label used in audit + error messages, e.g. "path", "connector", "realm". */
  label: string;
  /**
   * How an allowlist/protected entry matches a value:
   *   - "prefix": segment-aware containment (`isUnder`) — for hierarchical paths.
   *   - "exact":  strict equality — for flat names (connectors, realms, topics, commands).
   */
  match: "prefix" | "exact";
  /** Allowed roots/names. Empty = everything allowed (protected entries still apply). */
  allowlist: string[];
  /** Roots/names that may be read but never mutated or deleted. */
  protected?: string[];
  /** Env-var name surfaced when an allowlist check denies (e.g. "FOO_ALLOWLIST"). */
  allowlistEnv?: string;
  /** Env-var name surfaced when a protected check denies (e.g. "FOO_PROTECTED"). */
  protectedEnv?: string;
}

/** A high-impact opt-in power gated behind an explicit flag (exec, delete, input, …). */
export interface FlagRule {
  /** Whether the power is currently enabled. */
  enabled: boolean;
  /** Env-var name surfaced when the flag is required but off (e.g. "FOO_ALLOW_EXEC"). */
  env: string;
  /** Short phrase describing what it does, e.g. "runs arbitrary code". */
  describe?: string;
}

export interface PolicyConfig {
  mode: AccessMode;
  /** Tag written as the `audit` field of each JSON audit line, e.g. "mac-control". */
  auditTag: string;
  /** Validate + log mutating ops without executing them. */
  dryRun: boolean;
  auditLog: boolean;
  /** Resource rules keyed by a name the guard context references (e.g. "path", "connector"). */
  resources?: Record<string, ResourceRule>;
  /** Opt-in flags keyed by a name the guard context references (e.g. "exec", "delete"). */
  flags?: Record<string, FlagRule>;
  /**
   * When set, any guard call marked `destructive` also requires this flag (by its key in `flags`)
   * to be enabled. Lets REST-style servers gate deletes via `destructive: true` alone, mirroring the
   * `destructive && !allowDelete` shape, while servers that prefer explicit `requires` can omit it.
   */
  destructiveFlag?: string;
}

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

export interface GuardContext {
  tool: string;
  capability: Capability;
  /**
   * Resource values this op touches, keyed by the rule name in `PolicyConfig.resources`.
   * `mutation: true` marks a write/delete (so protected resources are refused); omit/false = read.
   */
  resources?: Record<string, { value: string; mutation?: boolean }>;
  /** Flag names (keys in `PolicyConfig.flags`) that must be enabled for this op. */
  requires?: string[];
  /**
   * Rule names whose allowlist this op could bypass if it ran — e.g. a shell `-c` invocation can
   * run any program, defeating a `command` allowlist. Refused whenever that rule's allowlist is set.
   */
  bypasses?: string[];
  /** Marks a mutating op as irreversible/high-impact (recorded in audit; gates `destructiveFlag`). */
  destructive?: boolean;
}

export class SecurityPolicy {
  constructor(private readonly config: PolicyConfig) {}

  get mode(): AccessMode {
    return this.config.mode;
  }

  isCapabilityEnabled(capability: Capability): boolean {
    return CAPABILITY_RANK[capability] <= MODE_RANK[this.config.mode];
  }

  /** Whether a named opt-in flag is enabled (false if the flag is unknown). */
  isFlagEnabled(name: string): boolean {
    return this.config.flags?.[name]?.enabled ?? false;
  }

  private rule(name: string): ResourceRule | undefined {
    return this.config.resources?.[name];
  }

  isResourceAllowed(ruleName: string, value: string): boolean {
    const rule = this.rule(ruleName);
    if (!rule || rule.allowlist.length === 0) return true;
    return rule.match === "prefix"
      ? rule.allowlist.some((root) => isUnder(value, root))
      : rule.allowlist.includes(value);
  }

  isResourceProtected(ruleName: string, value: string): boolean {
    const rule = this.rule(ruleName);
    if (!rule || !rule.protected?.length) return false;
    return rule.match === "prefix"
      ? rule.protected.some((root) => isUnder(value, root))
      : rule.protected.includes(value);
  }

  guard(ctx: GuardContext): { dryRun: boolean } {
    // 1. Capability vs. access mode.
    if (!this.isCapabilityEnabled(ctx.capability)) {
      this.audit(ctx, "DENY", `capability '${ctx.capability}' exceeds mode '${this.config.mode}'`);
      throw new PolicyError(
        `Operation '${ctx.tool}' requires '${ctx.capability}' access but the server runs in '${this.config.mode}' mode.`,
      );
    }

    // 2. Required opt-in flags.
    for (const name of ctx.requires ?? []) {
      if (!this.isFlagEnabled(name)) {
        const flag = this.config.flags?.[name];
        this.audit(ctx, "DENY", `flag '${name}' not enabled`);
        const what = flag?.describe ? ` ${flag.describe};` : "";
        throw new PolicyError(
          `Operation '${ctx.tool}'${what} it is disabled. Set ${flag?.env ?? name}=true to enable it.`,
        );
      }
    }

    // 3. Destructive ops may require a dedicated flag.
    if (ctx.destructive && this.config.destructiveFlag && !this.isFlagEnabled(this.config.destructiveFlag)) {
      const flag = this.config.flags?.[this.config.destructiveFlag];
      this.audit(ctx, "DENY", "destructive op requires flag");
      throw new PolicyError(
        `Destructive operation '${ctx.tool}' is disabled. Set ${flag?.env ?? this.config.destructiveFlag}=true to enable it.`,
      );
    }

    // 4. Allowlist bypasses (e.g. shell -c vs. a command allowlist).
    for (const name of ctx.bypasses ?? []) {
      const rule = this.rule(name);
      if (rule && rule.allowlist.length > 0) {
        this.audit(ctx, "DENY", `op bypasses the ${rule.label} allowlist`);
        throw new PolicyError(
          `Operation '${ctx.tool}' could run outside the ${rule.label} allowlist` +
            `${rule.allowlistEnv ? ` (${rule.allowlistEnv})` : ""}; refused while that allowlist is configured.`,
        );
      }
    }

    // 5. Resource allowlist + protected checks.
    for (const [name, { value, mutation }] of Object.entries(ctx.resources ?? {})) {
      if (value === "" || value === undefined) continue;
      const rule = this.rule(name);
      if (!this.isResourceAllowed(name, value)) {
        this.audit(ctx, "DENY", `${rule?.label ?? name} '${value}' not in allowlist`);
        throw new PolicyError(
          `${capitalize(rule?.label ?? name)} '${value}' is not in the configured allowlist` +
            `${rule?.allowlistEnv ? ` (${rule.allowlistEnv})` : ""}.`,
        );
      }
      if (mutation && this.isResourceProtected(name, value)) {
        this.audit(ctx, "DENY", `${rule?.label ?? name} '${value}' is protected`);
        throw new PolicyError(
          `${capitalize(rule?.label ?? name)} '${value}' is protected` +
            `${rule?.protectedEnv ? ` (${rule.protectedEnv})` : ""}; it can be read but not modified or deleted.`,
        );
      }
    }

    const dryRun = ctx.capability !== "read" && this.config.dryRun;
    this.audit(ctx, dryRun ? "DRY_RUN" : "ALLOW");
    return { dryRun };
  }

  private audit(ctx: GuardContext, decision: string, reason?: string): void {
    if (!this.config.auditLog) return;
    const resources: Record<string, string> = {};
    for (const [name, r] of Object.entries(ctx.resources ?? {})) resources[name] = r.value;
    const line = {
      ts: new Date().toISOString(),
      audit: this.config.auditTag,
      decision,
      tool: ctx.tool,
      capability: ctx.capability,
      ...(Object.keys(resources).length ? { resources } : {}),
      destructive: ctx.destructive ?? false,
      ...(reason ? { reason } : {}),
    };
    process.stderr.write(`${JSON.stringify(line)}\n`);
  }
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
