/**
 * Environment-variable parsing helpers shared by every server's `config.ts`.
 *
 * All read from `process.env` by name, with a default when unset or malformed. Keeping these in one
 * place means every server parses booleans, lists and numbers the same way.
 */

/** Parse a boolean env var. Truthy: 1/true/yes/on (case-insensitive). Unset → `dflt`. */
export function envBool(name: string, dflt = false): boolean {
  const v = process.env[name];
  if (v === undefined) return dflt;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

/** Parse a comma-separated env var into a trimmed, non-empty list. Unset → `[]`. */
export function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Alias of `envList` — reads a CSV env var. */
export const envCsv = envList;

/** Parse a positive number env var. Non-finite or <= 0 → `dflt`. */
export function envNum(name: string, dflt: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

/** Parse a one-of enum env var (case-insensitive). Unset or not in `allowed` → `dflt`. */
export function envEnum<T extends string>(name: string, allowed: readonly T[], dflt: T): T {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : dflt;
}
