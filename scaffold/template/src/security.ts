/**
 * Security wiring for __SERVER_NAME__ — turns env vars into a mcp-core PolicyConfig.
 *
 * All of the ranking / guard / dry-run / audit logic lives in @dockndevai/mcp-core. This file only
 * declares the DOMAIN specifics: the resource it scopes (a "__RESOURCE__"), and the one opt-in flag
 * that gates destructive deletes.
 */
import { type PolicyConfig, SecurityPolicy, envBool, envEnum, envList } from "@dockndevai/mcp-core";

export function loadPolicyConfig(): PolicyConfig {
  return {
    mode: envEnum("__ENV_PREFIX___MODE", ["read-only", "read-write", "admin"] as const, "read-only"),
    auditTag: "__SERVER_NAME__",
    dryRun: envBool("__ENV_PREFIX___DRY_RUN"),
    auditLog: envBool("__ENV_PREFIX___AUDIT_LOG", true),
    resources: {
      // A flat, name-based resource. Use match: "prefix" instead for hierarchical paths.
      __RESOURCE__: {
        label: "__RESOURCE__",
        match: "exact",
        allowlist: envList("__ENV_PREFIX___ALLOWLIST"),
        protected: envList("__ENV_PREFIX___PROTECTED"),
        allowlistEnv: "__ENV_PREFIX___ALLOWLIST",
        protectedEnv: "__ENV_PREFIX___PROTECTED",
      },
    },
    flags: {
      delete: { enabled: envBool("__ENV_PREFIX___ALLOW_DELETE"), env: "__ENV_PREFIX___ALLOW_DELETE" },
    },
    // A destructive op also needs the `delete` flag on top of admin mode.
    destructiveFlag: "delete",
  };
}

export function loadPolicy(): SecurityPolicy {
  return new SecurityPolicy(loadPolicyConfig());
}
