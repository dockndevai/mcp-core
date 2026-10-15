import { PolicyError, SecurityPolicy } from "@dockndevai/mcp-core";
import { describe, expect, it } from "vitest";
import { loadPolicyConfig } from "../src/security.js";

/**
 * Smoke tests for the generated server's policy wiring. These lean on mcp-core's own exhaustive
 * suite for the guard internals — here we only assert the DOMAIN wiring behaves as intended.
 */
function policy(env: Record<string, string>): SecurityPolicy {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    return new SecurityPolicy(loadPolicyConfig());
  } finally {
    process.env = saved;
  }
}

describe("__SERVER_NAME__ policy wiring", () => {
  it("defaults to read-only", () => {
    const p = policy({});
    expect(p.isCapabilityEnabled("read")).toBe(true);
    expect(p.isCapabilityEnabled("write")).toBe(false);
  });

  it("read-write enables writes but not admin", () => {
    const p = policy({ __ENV_PREFIX___MODE: "read-write" });
    expect(p.isCapabilityEnabled("write")).toBe(true);
    expect(p.isCapabilityEnabled("admin")).toBe(false);
  });

  it("a destructive delete needs the delete flag even in admin mode", () => {
    const locked = policy({ __ENV_PREFIX___MODE: "admin" });
    expect(() =>
      locked.guard({ tool: "delete___RESOURCE__", capability: "admin", destructive: true }),
    ).toThrow(PolicyError);

    const unlocked = policy({ __ENV_PREFIX___MODE: "admin", __ENV_PREFIX___ALLOW_DELETE: "true" });
    expect(unlocked.guard({ tool: "delete___RESOURCE__", capability: "admin", destructive: true })).toEqual({
      dryRun: false,
    });
  });

  it("confines to the allowlist when set", () => {
    const p = policy({ __ENV_PREFIX___MODE: "read-write", __ENV_PREFIX___ALLOWLIST: "example,other" });
    expect(p.isResourceAllowed("__RESOURCE__", "example")).toBe(true);
    expect(p.isResourceAllowed("__RESOURCE__", "nope")).toBe(false);
  });
});
