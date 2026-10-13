# DEVELOPMENT �?plugin-cdp-cli

Principles for secondary development (Cursor / humans).

## Why this package exists

Harness already has `ctx.browserUse` (one exclusive automation provider, often MCP). That cannot host “control ten WebView2 panels + port Chrome extensions�? `plugin-cdp-cli` is the **middleware fabric**: many endpoints × many targets × leases × extension primitives.

## Module map

| Path | Responsibility |
|------|----------------|
| `src/protocol/connection.js` | CDP JSON-RPC WebSocket client |
| `src/endpoint/http-attach.js` | `/json/list` probe + sidebar broker stub |
| `src/target/graph.js` | Multi-endpoint target graph + selector resolve |
| `src/lease.js` | Shared-read / exclusive-write leases |
| `src/domains/session.js` | Evaluate / navigate / inject / screenshot |
| `src/extension/runtime.js` | Content-script style helpers + message bus |
| `src/fabric.js` | Public `CdpFabric` API |
| `src/service.js` | Cordis `Service` named `cdp` |
| `src/tools/register.js` | Model tools via `@deepseek-ai/dsh-tools` |
| `scripts/smoke.mjs` | Live acceptance against ~/.env ports |

## Adding an endpoint adapter

1. Implement probe + attach returning `CdpEndpointRef` / `CdpTargetRef` / `wsUrl`.
2. Register from `CdpFabric` constructor or `addEndpoint`.
3. Document auth requirements (sidebar broker must be target-scoped + authenticated).

## Porting a Chrome extension

1. Identify content-script DOM/CSS contracts (classes, data attrs).
2. Use `fabric.open(selector)` + `ExtensionRuntime.injectStyles` + `run(iife)`.
3. Keep translation / network / storage in the DSH plugin (Node), not in the page, when possible.
4. Never vendor the whole CRX into git.

## Testing

```sh
node --test tests/*.test.mjs
node scripts/smoke.mjs
```

Acceptance evidence should say `pass` / `fail` / `blocked` / `unobserved` per check.
