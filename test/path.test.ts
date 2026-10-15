import fs from "node:fs";
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import os from "node:os";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalize, resolvePath, resolveRealPath } from "../src/path.js";
import { PolicyError, SecurityPolicy, type PolicyConfig } from "../src/security.js";

/** A path-scoped policy: one "path" resource rule (prefix match) + optional protected roots. */
function pathPolicy(allowlist: string[], protectedPaths: string[] = []): SecurityPolicy {
  const cfg: PolicyConfig = {
    mode: "admin",
    auditTag: "test",
    dryRun: false,
    auditLog: false,
    resources: {
      path: { label: "path", match: "prefix", allowlist, protected: protectedPaths, allowlistEnv: "APP_PATH_ALLOWLIST", protectedEnv: "APP_PROTECTED_PATHS" },
    },
    flags: { delete: { enabled: true, env: "APP_ALLOW_DELETE" } },
  };
  return new SecurityPolicy(cfg);
}

describe("resolvePath (no symlink resolution)", () => {
  it("expands ~ and normalizes, but does not follow symlinks", () => {
    expect(resolvePath("~")).toBe(os.homedir());
    expect(resolvePath("/a/b/../c")).toBe("/a/c");
  });
});

describe("resolveRealPath (sync, symlink-aware)", () => {
  let root: string;
  let inside: string;
  let outside: string;
  let realFile: string;
  let escapeLink: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-core-rrp-"));
    inside = path.join(root, "inside");
    outside = path.join(root, "outside");
    fs.mkdirSync(inside);
    fs.mkdirSync(outside);
    realFile = path.join(outside, "secret.txt");
    fs.writeFileSync(realFile, "sensitive");
    escapeLink = path.join(inside, "escape.txt");
    fs.symlinkSync(realFile, escapeLink);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("resolves an existing symlink to its real target", () => {
    expect(resolveRealPath(escapeLink)).toBe(fs.realpathSync(realFile));
  });

  it("falls back to resolving the parent dir for a not-yet-existing target", () => {
    const newFile = path.join(inside, "brand-new.txt");
    expect(resolveRealPath(newFile)).toBe(path.join(fs.realpathSync(inside), "brand-new.txt"));
  });

  it("falls back to the plain resolved path when even the parent doesn't exist", () => {
    const deep = path.join(root, "does", "not", "exist", "file.txt");
    expect(resolveRealPath(deep)).toBe(path.resolve(deep));
  });

  it("a symlink escaping the allowlist is denied once resolved before guard()", () => {
    // Naive resolvePath (the pre-fix behaviour) never follows the symlink, so the allowlist is fooled.
    const naive = resolvePath(escapeLink);
    expect(naive.startsWith(resolvePath(inside))).toBe(true);
    expect(pathPolicy([resolvePath(inside)]).isResourceAllowed("path", naive)).toBe(true);

    // resolveRealPath follows it out, which correctly fails the check — both target and root canonicalized the same way.
    const real = resolveRealPath(escapeLink);
    const fixed = pathPolicy([resolveRealPath(inside)]);
    expect(real.startsWith(resolveRealPath(inside))).toBe(false);
    expect(fixed.isResourceAllowed("path", real)).toBe(false);
    expect(() => fixed.guard({ tool: "read_file", capability: "read", resources: { path: { value: real } } })).toThrow(
      /allowlist/,
    );
  });

  it("a symlink pointing into a protected root is refused for mutation once resolved", () => {
    const protectedDir = path.join(root, "protected");
    fs.mkdirSync(protectedDir);
    const protectedTarget = path.join(protectedDir, "keychain.db");
    fs.writeFileSync(protectedTarget, "keys");
    const linkInAllowlist = path.join(inside, "innocuous-name.db");
    fs.symlinkSync(protectedTarget, linkInAllowlist);

    const p = pathPolicy([resolveRealPath(inside), resolveRealPath(protectedDir)], [resolveRealPath(protectedDir)]);
    const real = resolveRealPath(linkInAllowlist);
    expect(() =>
      p.guard({ tool: "write_file", capability: "write", resources: { path: { value: real, mutation: true } } }),
    ).toThrow(/protected/);
  });
});

/**
 * Regression test for the symlink allowlist-bypass via the async `canonicalize`: a symlink INSIDE an
 * allowed root that points OUTSIDE it must not grant read/write access to the target.
 */
describe("canonicalize (async, symlink allowlist bypass)", () => {
  let base: string;
  let allowed: string;
  let outside: string;
  let secret: string;

  beforeAll(async () => {
    // realpath the base so comparisons are symlink-stable (macOS /var -> /private/var).
    base = await realpath(await mkdtemp(path.join(tmpdir(), "mcp-core-canon-")));
    allowed = path.join(base, "sandbox");
    await mkdir(allowed);
    outside = path.join(base, "outside");
    await mkdir(outside);
    secret = path.join(outside, "secret.txt");
    await writeFile(secret, "TOP SECRET", "utf8");
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true }).catch(() => {});
  });

  it("a symlink inside the sandbox pointing outside is canonicalized to the real target", async () => {
    const link = path.join(allowed, "leak");
    await symlink(secret, link);
    const canon = await canonicalize(resolvePath(link));
    expect(canon).toBe(secret); // resolved out of the sandbox
    expect(pathPolicy([allowed]).isResourceAllowed("path", canon)).toBe(false); // ...and thus rejected
  });

  it("guard() throws for a read through such a symlink", async () => {
    const link = path.join(allowed, "leak2");
    await symlink(secret, link);
    const canon = await canonicalize(resolvePath(link));
    expect(() =>
      pathPolicy([allowed]).guard({ tool: "read_file", capability: "read", resources: { path: { value: canon } } }),
    ).toThrow(PolicyError);
  });

  it("a brand-new file under a symlinked subdir cannot escape (parent is canonicalized)", async () => {
    const linkDir = path.join(allowed, "outlink");
    await symlink(outside, linkDir); // sandbox/outlink -> outside/
    const target = path.join(linkDir, "new.txt"); // does not exist yet
    const canon = await canonicalize(resolvePath(target));
    expect(canon).toBe(path.join(outside, "new.txt"));
    expect(pathPolicy([allowed]).isResourceAllowed("path", canon)).toBe(false);
  });

  it("a legitimate file genuinely inside the sandbox is still allowed", async () => {
    const real = path.join(allowed, "notes.txt");
    await writeFile(real, "ok", "utf8");
    const canon = await canonicalize(resolvePath(real));
    expect(canon).toBe(real);
    expect(pathPolicy([allowed]).isResourceAllowed("path", canon)).toBe(true);
    expect(() =>
      pathPolicy([allowed]).guard({ tool: "read_file", capability: "read", resources: { path: { value: canon } } }),
    ).not.toThrow();
  });
});
