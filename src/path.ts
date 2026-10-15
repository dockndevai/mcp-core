import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

/** Expand a leading `~` and resolve to an absolute, normalized path (lexical only — no symlinks). */
export function resolvePath(p: string): string {
  let s = p.trim();
  if (s === "~") s = HOME;
  else if (s.startsWith("~/")) s = path.join(HOME, s.slice(2));
  return path.resolve(s);
}

/**
 * Expand `~`, resolve to absolute, and follow symlinks to their real target — synchronously.
 *
 * This is the audited fix for the symlink allowlist-bypass: a symlink planted inside an
 * allowlisted directory (or pointing at a protected one) must not smuggle a filesystem op past
 * `isResourceAllowed`/`isResourceProtected`, which only ever see the post-resolution path.
 * `fs.writeFile`/`readFile` follow symlinks; the policy check must see the same real path they will.
 *
 * The target itself may not exist yet (e.g. `write_file` creating a new file) — in that case fall
 * back to resolving its parent directory, since that's the boundary that matters for a
 * not-yet-existing leaf. If even the parent doesn't exist, fall back to the plain resolved path
 * rather than throwing; the policy will still confine it correctly once it does.
 *
 * Always guard on the value this returns, and perform the filesystem op on it.
 */
export function resolveRealPath(p: string): string {
  const abs = resolvePath(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    try {
      const realDir = fs.realpathSync(path.dirname(abs));
      return path.join(realDir, path.basename(abs));
    } catch {
      return abs;
    }
  }
}

/**
 * Canonicalize an already-absolute path by resolving symlinks — asynchronously. Same guarantee as
 * `resolveRealPath`, for call sites that resolve `~` with `resolvePath` first and want a promise.
 *
 * - Existing path (file, dir, or symlink): fully resolved via realpath.
 * - Non-existent leaf (e.g. a file about to be created): the parent directory is realpath'd (so a
 *   symlinked parent can't escape either) and the leaf name appended. A missing parent surfaces as
 *   a normal ENOENT error (callers that prefer a non-throwing fallback should use `resolveRealPath`).
 */
export async function canonicalize(abs: string): Promise<string> {
  try {
    return await fsp.realpath(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const realDir = await fsp.realpath(path.dirname(abs));
    return path.join(realDir, path.basename(abs));
  }
}
