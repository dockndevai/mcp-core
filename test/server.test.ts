import { describe, expect, it } from "vitest";
import { annotationsFor } from "../src/annotations.js";
import { makeConfirmer } from "../src/elicit.js";
import { buildServer, defaultErrorMapper } from "../src/server.js";
import { PolicyError, SecurityPolicy } from "../src/security.js";
import { type BaseToolContext, type ToolDef, textResult } from "../src/tools.js";

interface Ctx extends BaseToolContext {
  client: { ping(): string };
}

function tools(): ToolDef<Ctx>[] {
  return [
    {
      name: "read_thing",
      capability: "read",
      config: { title: "Read thing", description: "d", inputSchema: {} },
      handler: async (_a, { client }) => textResult(client.ping()),
    },
    {
      name: "write_thing",
      capability: "write",
      config: { title: "Write thing", description: "d", inputSchema: {} },
      handler: async () => textResult("wrote"),
    },
    {
      name: "danger_thing",
      capability: "admin",
      // only register when the exec flag is on
      enabledWhen: (p) => p.isFlagEnabled("exec"),
      config: { title: "Danger thing", description: "d", inputSchema: {} },
      handler: async () => textResult("boom"),
    },
  ];
}

function ctx(mode: "read-only" | "read-write" | "admin", execEnabled = false): Ctx {
  const policy = new SecurityPolicy({
    mode,
    auditTag: "test",
    dryRun: false,
    auditLog: false,
    flags: { exec: { enabled: execEnabled, env: "APP_ALLOW_EXEC" } },
  });
  return {
    policy,
    confirm: makeConfirmer({ server: { getClientCapabilities: () => ({}) } } as never),
    client: { ping: () => "pong" },
  };
}

describe("buildServer registration gating", () => {
  it("registers only tools whose capability <= mode", () => {
    const { enabled } = buildServer({ name: "t", version: "0.0.0", tools: tools(), context: ctx("read-only") });
    expect(enabled).toEqual(["read_thing"]);
  });
  it("registers read + write in read-write mode, but not the flag-gated admin tool", () => {
    const { enabled } = buildServer({ name: "t", version: "0.0.0", tools: tools(), context: ctx("read-write") });
    expect(enabled).toEqual(["read_thing", "write_thing"]);
  });
  it("registers the admin tool only when its enabledWhen flag is on", () => {
    expect(
      buildServer({ name: "t", version: "0.0.0", tools: tools(), context: ctx("admin", false) }).enabled,
    ).toEqual(["read_thing", "write_thing"]);
    expect(
      buildServer({ name: "t", version: "0.0.0", tools: tools(), context: ctx("admin", true) }).enabled,
    ).toEqual(["read_thing", "write_thing", "danger_thing"]);
  });
});

describe("defaultErrorMapper", () => {
  it("prefixes policy denials and flags isError", () => {
    const r = defaultErrorMapper(new PolicyError("nope"));
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toBe("Policy denied: nope");
  });
  it("names other errors", () => {
    const r = defaultErrorMapper(new TypeError("bad"));
    expect((r.content[0] as { text: string }).text).toBe("TypeError: bad");
  });
});

describe("annotationsFor", () => {
  it("derives hints from capability", () => {
    const [read, write, admin] = tools();
    expect(annotationsFor(read)).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    expect(annotationsFor(write)).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(annotationsFor(admin)).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(annotationsFor(read, false).openWorldHint).toBe(false);
  });
});

describe("buildServer binds approvals to the call", () => {
  it("hands each handler a confirmer carrying that call's tool and arguments", async () => {
    let seen: { tool?: string; fingerprint?: string } = {};
    const probeTool: ToolDef<Ctx> = {
      name: "delete_thing",
      capability: "admin",
      config: { title: "Delete", description: "d", inputSchema: {} },
      handler: async (_a, { confirm }) => {
        const out = await confirm.confirm({ action: "delete thing", target: "t" });
        if (out.approved) seen = out.receipt;
        return textResult("ok");
      },
    };
    const context = ctx("admin");
    const { server } = buildServer<Ctx>({ name: "t", version: "0", tools: [probeTool], context });
    context.confirm = makeConfirmer(server, { audit: false });
    // Call the registered handler directly (no transport): registeredTools is the SDK's internal map.
    const reg = (server as unknown as { _registeredTools: Record<string, { handler: (a: unknown) => Promise<unknown> }> })._registeredTools;
    await reg["delete_thing"].handler({ id: 7 });
    expect(seen.tool).toBe("delete_thing");
    expect(seen.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});
