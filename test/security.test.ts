import { describe, expect, it } from "vitest";
import { PolicyError, SecurityPolicy, isUnder, type PolicyConfig } from "../src/security.js";

function makePolicy(overrides: Partial<PolicyConfig> = {}): SecurityPolicy {
  return new SecurityPolicy({
    mode: "read-only",
    auditTag: "test",
    dryRun: false,
    auditLog: false,
    resources: {
      path: {
        label: "path",
        match: "prefix",
        allowlist: [],
        protected: ["/System", "/Users/me/.ssh"],
        allowlistEnv: "APP_PATH_ALLOWLIST",
        protectedEnv: "APP_PROTECTED_PATHS",
      },
      command: { label: "program", match: "exact", allowlist: [], allowlistEnv: "APP_COMMAND_ALLOWLIST" },
    },
    flags: {
      exec: { enabled: false, env: "APP_ALLOW_EXEC", describe: "runs arbitrary code" },
      delete: { enabled: false, env: "APP_ALLOW_DELETE" },
      input: { enabled: false, env: "APP_ALLOW_INPUT", describe: "injects GUI input" },
    },
    ...overrides,
  });
}

describe("capability gating", () => {
  it("read-only enables read only", () => {
    const p = makePolicy();
    expect(p.isCapabilityEnabled("read")).toBe(true);
    expect(p.isCapabilityEnabled("write")).toBe(false);
    expect(p.isCapabilityEnabled("admin")).toBe(false);
  });
  it("admin enables everything", () => {
    const p = makePolicy({ mode: "admin" });
    expect(p.isCapabilityEnabled("write")).toBe(true);
    expect(p.isCapabilityEnabled("admin")).toBe(true);
  });
  it("guard throws when capability exceeds mode", () => {
    expect(() => makePolicy().guard({ tool: "write_file", capability: "write" })).toThrow(PolicyError);
  });
});

describe("isUnder (path boundary)", () => {
  it("matches a path at or under a root, segment-aware", () => {
    expect(isUnder("/Users/me/docs", "/Users/me")).toBe(true);
    expect(isUnder("/Users/me", "/Users/me")).toBe(true);
    expect(isUnder("/Users/mentor", "/Users/me")).toBe(false); // no partial-segment match
    expect(isUnder("/tmp/x", "/")).toBe(true);
  });
});

describe("resource allowlist + protected (prefix match)", () => {
  it("allows any value when the allowlist is empty", () => {
    expect(makePolicy().isResourceAllowed("path", "/anywhere")).toBe(true);
  });
  it("confines to the allowlist when set", () => {
    const p = makePolicy({
      mode: "read-write",
      resources: { path: { label: "path", match: "prefix", allowlist: ["/tmp", "/Users/me/work"] } },
    });
    expect(p.isResourceAllowed("path", "/tmp/a")).toBe(true);
    expect(p.isResourceAllowed("path", "/Users/me/work/x")).toBe(true);
    expect(p.isResourceAllowed("path", "/etc/passwd")).toBe(false);
  });
  it("denies a mutation outside the allowlist", () => {
    const p = makePolicy({
      mode: "read-write",
      resources: { path: { label: "path", match: "prefix", allowlist: ["/tmp"], allowlistEnv: "APP_PATH_ALLOWLIST" } },
    });
    expect(() =>
      p.guard({ tool: "write_file", capability: "write", resources: { path: { value: "/etc/x", mutation: true } } }),
    ).toThrow(/allowlist/);
  });
  it("refuses to mutate a protected path but allows reading it", () => {
    const p = makePolicy({ mode: "admin" });
    expect(() =>
      p.guard({ tool: "write_file", capability: "write", resources: { path: { value: "/System/x", mutation: true } } }),
    ).toThrow(/protected/);
    // reading a protected path is fine
    expect(p.guard({ tool: "read_file", capability: "read", resources: { path: { value: "/System/x" } } })).toEqual({
      dryRun: false,
    });
  });
});

describe("resource allowlist (exact match) — connector-style names", () => {
  const p = () =>
    new SecurityPolicy({
      mode: "admin",
      auditTag: "test",
      dryRun: false,
      auditLog: false,
      resources: {
        connector: {
          label: "connector",
          match: "exact",
          allowlist: ["orders", "payments", "heartbeat"],
          protected: ["heartbeat"],
          allowlistEnv: "APP_CONNECTOR_ALLOWLIST",
          protectedEnv: "APP_PROTECTED_CONNECTORS",
        },
      },
    });
  it("allows an exact name in the allowlist, rejects others", () => {
    expect(p().isResourceAllowed("connector", "orders")).toBe(true);
    expect(p().isResourceAllowed("connector", "order")).toBe(false); // no prefix leniency
  });
  it("refuses to mutate a protected connector but allows reading it", () => {
    expect(() =>
      p().guard({ tool: "delete_connector", capability: "admin", resources: { connector: { value: "heartbeat", mutation: true } } }),
    ).toThrow(/protected/);
    expect(
      p().guard({ tool: "get_connector", capability: "read", resources: { connector: { value: "heartbeat" } } }),
    ).toEqual({ dryRun: false });
  });
});

describe("opt-in flags", () => {
  it("blocks a required flag unless enabled", () => {
    expect(() =>
      makePolicy({ mode: "admin" }).guard({ tool: "run_command", capability: "admin", requires: ["exec"] }),
    ).toThrow(/APP_ALLOW_EXEC/);
    const p = makePolicy({
      mode: "admin",
      flags: { exec: { enabled: true, env: "APP_ALLOW_EXEC" } },
    });
    expect(p.guard({ tool: "run_command", capability: "admin", requires: ["exec"] })).toEqual({ dryRun: false });
  });
  it("names the flag's describe phrase in the denial", () => {
    expect(() =>
      makePolicy({ mode: "admin" }).guard({ tool: "type_text", capability: "admin", requires: ["input"] }),
    ).toThrow(/injects GUI input/);
  });
});

describe("command allowlist + shell-escape bypass", () => {
  it("enforces an exact command allowlist", () => {
    const p = makePolicy({
      mode: "admin",
      flags: { exec: { enabled: true, env: "APP_ALLOW_EXEC" } },
      resources: { command: { label: "program", match: "exact", allowlist: ["ls", "echo"], allowlistEnv: "APP_COMMAND_ALLOWLIST" } },
    });
    expect(() =>
      p.guard({ tool: "run_command", capability: "admin", requires: ["exec"], resources: { command: { value: "rm" } } }),
    ).toThrow(/allowlist/);
    expect(
      p.guard({ tool: "run_command", capability: "admin", requires: ["exec"], resources: { command: { value: "echo" } } }),
    ).toEqual({ dryRun: false });
  });
  it("blocks a shell -c escape from bypassing the command allowlist even when the shell itself is allowed", () => {
    const p = makePolicy({
      mode: "admin",
      flags: { exec: { enabled: true, env: "APP_ALLOW_EXEC" } },
      resources: { command: { label: "program", match: "exact", allowlist: ["zsh"], allowlistEnv: "APP_COMMAND_ALLOWLIST" } },
    });
    expect(() =>
      p.guard({
        tool: "run_command",
        capability: "admin",
        requires: ["exec"],
        resources: { command: { value: "zsh" } },
        bypasses: ["command"],
      }),
    ).toThrow(/allowlist/);
    // With no allowlist configured, the shell escape is unrestricted (nothing to bypass).
    const open = makePolicy({
      mode: "admin",
      flags: { exec: { enabled: true, env: "APP_ALLOW_EXEC" } },
      resources: { command: { label: "program", match: "exact", allowlist: [] } },
    });
    expect(
      open.guard({ tool: "run_command", capability: "admin", requires: ["exec"], resources: { command: { value: "zsh" } }, bypasses: ["command"] }),
    ).toEqual({ dryRun: false });
  });
});

describe("destructiveFlag (REST-style delete gating)", () => {
  const cfg = (deleteEnabled: boolean): PolicyConfig => ({
    mode: "admin",
    auditTag: "test",
    dryRun: false,
    auditLog: false,
    destructiveFlag: "delete",
    flags: { delete: { enabled: deleteEnabled, env: "APP_ALLOW_DELETE" } },
  });
  it("a destructive op needs the configured flag", () => {
    expect(() =>
      new SecurityPolicy(cfg(false)).guard({ tool: "delete_connector", capability: "admin", destructive: true }),
    ).toThrow(/APP_ALLOW_DELETE/);
    expect(
      new SecurityPolicy(cfg(true)).guard({ tool: "delete_connector", capability: "admin", destructive: true }),
    ).toEqual({ dryRun: false });
  });
});

describe("dry-run", () => {
  it("returns dryRun for mutating ops but never for reads", () => {
    const p = makePolicy({
      mode: "admin",
      dryRun: true,
      flags: { exec: { enabled: true, env: "APP_ALLOW_EXEC" } },
    });
    expect(p.guard({ tool: "run_command", capability: "admin", requires: ["exec"] }).dryRun).toBe(true);
    expect(p.guard({ tool: "read_file", capability: "read" }).dryRun).toBe(false);
  });
});
