/**
 * Cordis Service wrapper for CdpFabric (loaded when @deepseek-ai/cordis is present).
 * @module
 */

import { CdpFabric } from './fabric.js'
import { registerTools } from './tools/register.js'

/**
 * @param {typeof import('@deepseek-ai/cordis').Service} Service
 * @returns {typeof import('@deepseek-ai/cordis').Service}
 */
export function createCdpService(Service) {
  return class CdpService extends Service {
    static inject = ['tools']

    /** @type {CdpFabric} */
    fabric

    /**
     * @param {import('@deepseek-ai/cordis').Context} ctx
     * @param {{ endpoints?: string[], defaultPort?: number }} config
     */
    constructor(ctx, config = {}) {
      super(ctx, 'cdp')
      this.fabric = new CdpFabric({
        endpoints: config.endpoints?.length ? config.endpoints : undefined,
      })
      ctx.cdp = this

      ctx.effect(() => () => {
        void this.fabric.dispose()
      }, 'cdp.dispose')

      void registerTools(ctx.tools, this.fabric).catch((err) => {
        ctx.logger?.warn?.('cdp: tool register failed: %s', String(err?.message || err))
      })

      void this.fabric.start().catch((err) => {
        ctx.logger?.warn?.('cdp: probe failed: %s', String(err?.message || err))
      })
    }

    start() { return this.fabric.start() }
    addEndpoint(base, opts) { return this.fabric.addEndpoint(base, opts) }
    listEndpoints() { return this.fabric.listEndpoints() }
    listTargets(filter) { return this.fabric.listTargets(filter) }
    resolve(selector) { return this.fabric.resolve(selector) }
    resolveOne(selector) { return this.fabric.resolveOne(selector) }
    open(selector, opts) { return this.fabric.open(selector, opts) }
    release(lease, session, opts) { return this.fabric.release(lease, session, opts) }
    extension(session, id) { return this.fabric.extension(session, id) }
    get sidebarBroker() { return this.fabric.sidebarBroker }
  }
}
