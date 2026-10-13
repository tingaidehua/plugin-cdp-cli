# plugin-cdp-cli

Multi-endpoint **CDP interface layer** (`dsh-xxx-cli`) for DeepSeek Harness.
Exposes `ctx.cdp` and model tools for listing endpoints/targets, evaluating JS, injecting CSS/JS, navigating, and screenshots — the foundation for porting Chrome/WebView2 extensions and for Harness/Cursor page debugging.

[中文](README.zh.md) · [DEVELOPMENT.md](DEVELOPMENT.md) · [Architecture](../docs/ARCHITECTURE.md) · [Taxonomy](../.cursor/rules/dsh-plugin-taxonomy.mdc)

## Install

```sh
dsh plugin --profile web add /absolute/path/to/agent-plugins/plugin-cdp-cli
```

Configure endpoints in `~/.env`:

```
DSH_CDP_ENDPOINTS=9225,9224
DSH_CDP_DEFAULT_PORT=9225
```

## Smoke (no dsh boot)

```sh
node scripts/smoke.mjs
```

## Tools

| Tool | Purpose |
|------|---------|
| `cdp_endpoints` | List / refresh endpoints |
| `cdp_targets` | List page targets |
| `cdp_evaluate` | `Runtime.evaluate` on one matched target |
| `cdp_inject` | Inject CSS/JS |
| `cdp_navigate` | Navigate |
| `cdp_screenshot` | PNG/JPEG (bounded) |

## Library API

```js
import { CdpFabric } from 'plugin-cdp-cli'

const fabric = new CdpFabric({ endpoints: ['http://127.0.0.1:9225'] })
const { session, lease, target } = await fabric.open({
  port: 9225,
  urlIncludes: 'example.com',
})
console.log(await session.evaluate('document.title'))
await fabric.release(lease, session, { closeSession: true })
```
