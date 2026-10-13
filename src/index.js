/**
 * Cordis plugin entry for plugin-cdp-cli (interface-layer CDP fabric).
 * @module plugin-cdp-cli
 */

import { CdpFabric } from './fabric.js'
import { registerTools } from './tools/register.js'

export { CdpFabric, getDefaultFabric } from './fabric.js'
export { TargetGraph } from './target/graph.js'
export { TargetSession } from './domains/session.js'
export { ExtensionRuntime } from './extension/runtime.js'
export { loadHomeEnv, endpointsFromEnv, normalizeEndpointBase } from './env.js'
export { createSidebarBrokerStub } from './endpoint/http-attach.js'
export { makeTargetId } from './types.js'
export { createCdpService } from './service.js'
export {
  makeInstallPageAlgebraScript,
  makeAlgebraSetViewScript,
  makeAlgebraRemoveLayerScript,
  PAGE_ALGEBRA_CSS,
} from './page-algebra.js'

export const name = 'plugin-cdp-cli'

/** Prefer optional tools so missing/timing cannot fail the fiber. */
export const inject = {
  tools: { required: false },
}

/**
 * Do not assign `ctx.cdp = ?` before provide ? the Context proxy can declare
 * the name as a non-service property and make `provide('cdp')` throw.
 * Cordis Config must be a Standard Schema; omit Config and default in apply.
 *
 * @param {any} ctx
 * @param {{ endpoints?: string[], defaultPort?: number }} [config]
 */
export function apply(ctx, config = {}) {
  const fabric = new CdpFabric({
    endpoints: config.endpoints?.length ? config.endpoints : undefined,
    logger: ctx.logger,
  })

  ctx.provide('cdp', fabric)

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      void fabric.dispose()
    }, 'plugin-cdp-cli.dispose')
  }

  if (ctx.tools) {
    void registerTools(ctx.tools, fabric)
      .then((r) => { ctx.logger?.info?.('cdp: tools %j', r) })
      .catch((err) => {
        ctx.logger?.warn?.('cdp: tool register failed: %s', String(err?.message || err))
      })
  }

  void fabric.start()
    .then(() => fabric.ensureTargetWatches())
    .catch((err) => {
      ctx.logger?.warn?.('cdp: start failed: %s', String(err?.message || err))
    })
}

export default { name, inject, apply }
