#!/usr/bin/env node
/**
 * create-mcp-server — scaffold a new dockndevai MCP server on top of @dockndevai/mcp-core.
 *
 * Usage:
 *   npx @dockndevai/create-mcp-server <name> [--resource <label>] [--dir <path>]
 *   npm create @dockndevai/mcp-server -- <name> --resource widget
 *
 *   <name>        Server name, e.g. "mcp-widget" (an "mcp-" prefix is added if missing).
 *   --resource    The resource the server scopes (singular), e.g. "widget". Default: "item".
 *   --dir         Target directory. Default: ./<name>.
 *
 * It copies scaffold/template, substitutes the placeholder tokens, and renames the dotfile
 * templates (gitignore -> .gitignore, env.example -> .env.example). It does NOT run npm install.
 */
import { cp, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, "..", "scaffold", "template");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--resource" || a === "-r") args.resource = argv[++i];
    else if (a === "--dir" || a === "-d") args.dir = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else args._.push(a);
  }
  return args;
}

function usage() {
  console.log(
    `create-mcp-server <name> [--resource <label>] [--dir <path>]\n\n` +
      `  <name>      Server name, e.g. "mcp-widget" (an "mcp-" prefix is added if missing).\n` +
      `  --resource  Resource the server scopes (singular), e.g. "widget". Default: "item".\n` +
      `  --dir       Target directory. Default: ./<name>.`,
  );
}

function pascal(s) {
  return s
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function sanitizeResource(r) {
  // Keep it a safe JS identifier fragment (used in tool names like get_<resource>).
  const clean = r.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return clean || "item";
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  let name = args._[0].trim();
  if (!/^[a-z0-9-]+$/.test(name)) {
    console.error(`Error: name "${name}" must be lowercase letters, digits and hyphens only.`);
    process.exit(1);
  }
  if (!name.startsWith("mcp-")) name = `mcp-${name}`;

  const resource = sanitizeResource(args.resource ?? "item");
  const envBase = name.replace(/^mcp-/, "");
  const tokens = {
    __PKG_NAME__: `@dockndevai/${name}`,
    __SERVER_NAME__: name,
    __ENV_PREFIX__: envBase.toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
    __SERVER_PASCAL__: pascal(envBase),
    __RESOURCE__: resource,
  };

  const target = path.resolve(args.dir ?? name);
  if (existsSync(target) && (await readdir(target)).length > 0) {
    console.error(`Error: target directory "${target}" exists and is not empty.`);
    process.exit(1);
  }

  if (!existsSync(TEMPLATE)) {
    console.error(`Error: template not found at ${TEMPLATE}. Is the package installed correctly?`);
    process.exit(1);
  }

  // Copy the whole template, then substitute tokens in every file, then rename dotfiles.
  await mkdir(target, { recursive: true });
  await cp(TEMPLATE, target, { recursive: true });

  const files = await walk(target);
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    let replaced = raw;
    for (const [tok, val] of Object.entries(tokens)) replaced = replaced.split(tok).join(val);
    if (replaced !== raw) await writeFile(file, replaced, "utf8");
  }

  // Template dotfiles are shipped without a leading dot so npm doesn't strip them on publish.
  const renames = [
    ["gitignore", ".gitignore"],
    ["env.example", ".env.example"],
  ];
  for (const [from, to] of renames) {
    const src = path.join(target, from);
    if (existsSync(src)) await rename(src, path.join(target, to));
  }

  console.log(`\nScaffolded ${tokens.__PKG_NAME__} in ${target}\n`);
  console.log(`  resource: ${resource}    env prefix: ${tokens.__ENV_PREFIX__}_\n`);
  console.log(`Next steps:`);
  console.log(`  cd ${path.relative(process.cwd(), target) || "."}`);
  console.log(`  npm install`);
  console.log(`  npm run typecheck && npm test && npm run build`);
  console.log(`\nThen wire src/client.ts to your backend and flesh out the tools. See the README.\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
