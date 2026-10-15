# __PKG_NAME__

MCP server for **__RESOURCE__s**, built on [`@dockndevai/mcp-core`](https://github.com/dockndevai/mcp-core) — safe by default, least privilege, audited.

## What you get

- **Capability-gated tools** — a read / write / admin tool, each registered only when the access mode allows it.
- **Resource allowlist + protected resources** — scope which `__RESOURCE__`s can be touched; protected ones are read-only forever.
- **Destructive deletes gated** behind `__ENV_PREFIX___ALLOW_DELETE` plus human confirmation.
- **Dry-run + JSON audit** out of the box.

## Install & run

```bash
npm install
npm run build
__ENV_PREFIX___MODE=read-only node dist/index.js
```

## Configuration

See `.env.example`. All vars are optional; the server is read-only with everything gated by default.

| Env var | Default | Meaning |
| --- | --- | --- |
| `__ENV_PREFIX___MODE` | `read-only` | `read-only` \| `read-write` \| `admin` |
| `__ENV_PREFIX___ALLOWLIST` | (empty = all) | Comma-separated `__RESOURCE__` names allowed |
| `__ENV_PREFIX___PROTECTED` | (empty) | `__RESOURCE__` names that are read-only forever |
| `__ENV_PREFIX___ALLOW_DELETE` | `false` | Enable destructive deletes (admin mode too) |
| `__ENV_PREFIX___DRY_RUN` | `false` | Validate + log mutations without executing |
| `__ENV_PREFIX___AUDIT_LOG` | `true` | JSON audit line to stderr per guarded op |

## Make it yours

1. Replace the in-memory stub in `src/client.ts` with a real wrapper over your backend SDK/REST API.
2. Adjust the resource rule in `src/security.ts` (switch `match` to `"prefix"` for hierarchical paths; add more resources or opt-in flags as needed).
3. Flesh out the example tools in `src/tools/{read,write,admin}.ts`. Keep the `capability` tag honest — a `read` tool must never mutate.
4. `npm run typecheck && npm test && npm run build`.

The governance primitives (policy, guard, elicitation, path canonicalization, audit) live in `@dockndevai/mcp-core` — never reimplement them here.
