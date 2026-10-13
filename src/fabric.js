/**
 * CdpFabric � multi-endpoint CDP middleware (library face; Cordis wraps this).
 * @module
 */

import { TargetGraph } from './target/graph.js'
import { LeaseManager } from './lease.js'
import { TargetSession } from './domains/session.js'
import { ExtensionRuntime } from './extension/runtime.js'
import { createSidebarBrokerStub } from './endpoint/http-attach.js'
import { watchHttpEndpointTargets } from './endpoint/target-watch.js'
import { endpointsFromEnv } from './env.js'

/**
 * @typedef {import('./types.js').CdpSelector} CdpSelector
 * @typedef {import('./types.js').CdpTargetRef} CdpTargetRef
 * @typedef {import('./endpoint/http-attach.js').SidebarBrokerAdapter} SidebarBrokerAdapter
 * @typedef {import('./endpoint/target-watch.js').TargetWatchPayload} TargetWatchPayload
 */

export class CdpFabric {
  /** @type {TargetGraph} */
  graph
  /** @type {LeaseManager} */
  leases
  /** @type {SidebarBrokerAdapter} */
  sidebarBroker
  /** @type {Map<string, TargetSession>} open sessions keyed by target id */
  #sessions = new Map()
  /** @type {Map<string, () => void>} endpointId ? dispose watch */
  #watches = new Map()
  /** @type {Set<(ev: TargetWatchPayload) => void>} */
  #targetListeners = new Set()
  /** @type {{ info?: Function, warn?: Function } | null} */
  #logger = null

  /**
   * @param {{ endpoints?: string[], sidebarBroker?: SidebarBrokerAdapter, logger?: { info?: Function, warn?: Function } }} [opts]
   */
  constructor(opts = {}) {
    this.graph = new TargetGraph(opts.endpoints ?? endpointsFromEnv())
    this.leases = new LeaseManager()
    this.sidebarBroker = opts.sidebarBroker ?? createSidebarBrokerStub()
    this.#logger = opts.logger || null
  }

  /**
   * Subscribe to endpoint Target.* / list-diff events (new tab, close, URL change).
   * @param {(ev: TargetWatchPayload) => void} handler
   * @returns {() => void}
   */
  onTargetEvent(handler) {
    this.#targetListeners.add(handler)
    return () => this.#targetListeners.delete(handler)
  }

  /**
   * @param {TargetWatchPayload} ev
   */
  #emitTarget(ev) {
    for (const h of this.#targetListeners) {
      try { h(ev) } catch { /* ignore */ }
    }
  }

  /**
   * Ensure browser Target.* watchers for every known HTTP endpoint.
   * Idempotent. Call after start()/addEndpoint.
   */
  async ensureTargetWatches() {
    for (const ep of this.listEndpoints()) {
      if (ep.kind !== 'http-attach' || ep.status !== 'ok') continue
      if (this.#watches.has(ep.id)) continue
      try {
        const stop = await watchHttpEndpointTargets(ep.baseUrl, (ev) => {
          // Keep graph fresh on create/change
          if (ev.type === 'target-created' || ev.type === 'target-changed' || ev.type === 'target-destroyed') {
            void this.graph.addEndpoint(ep.baseUrl).catch(() => {})
          }
          this.#emitTarget(ev)
        }, { logger: this.#logger || undefined, pollMs: 2500 })
        this.#watches.set(ep.id, stop)
      } catch (err) {
        this.#logger?.warn?.('cdp: target watch failed %s (%s)', ep.id, String(err?.message || err))
      }
    }
  }

  /** Bootstrap: refresh env endpoints + describe sidebar stub + start Target watches. */
  async start() {
    const http = await this.graph.refreshAll()
    const sidebar = await this.sidebarBroker.describe()
    await this.ensureTargetWatches().catch(() => {})
    return {
      endpoints: [...http.endpoints, sidebar],
      targets: http.targets,
    }
  }

  /**
   * @param {string} baseOrPort
   * @param {{ label?: string }} [opts]
   */
  async addEndpoint(baseOrPort, opts) {
    const r = await this.graph.addEndpoint(baseOrPort, opts)
    await this.ensureTargetWatches().catch(() => {})
    return r
  }

  listEndpoints() {
    return this.graph.listEndpoints()
  }

  /**
   * @param {{ pagesOnly?: boolean }} [filter]
   */
  listTargets(filter) {
    return this.graph.listTargets(filter)
  }

  /**
   * @param {CdpSelector} selector
   */
  resolve(selector) {
    return this.graph.resolve(selector)
  }

  /**
   * @param {CdpSelector} selector
   */
  resolveOne(selector) {
    return this.graph.resolveOne(selector)
  }

  /**
   * Open (or reuse) a page session. Acquires a write lease by default.
   * @param {CdpSelector | CdpTargetRef} selectorOrTarget
   * @param {{ owner?: string, mode?: 'read' | 'write', reuse?: boolean }} [opts]
   * @returns {Promise<{ session: TargetSession, lease: import('./lease.js').Lease, target: CdpTargetRef }>}
   */
  async open(selectorOrTarget, opts = {}) {
    const owner = opts.owner || 'plugin-cdp-cli'
    const mode = opts.mode || 'write'
    /** @type {CdpTargetRef} */
    const target = 'wsUrl' in selectorOrTarget && selectorOrTarget.wsUrl
      ? /** @type {CdpTargetRef} */ (selectorOrTarget)
      : await this.resolveOne(/** @type {CdpSelector} */ (selectorOrTarget))

    if (opts.reuse !== false && this.#sessions.has(target.id)) {
      const session = this.#sessions.get(target.id)
      const lease = this.leases.acquire(target.id, mode, owner)
      return { session, lease, target }
    }

    const lease = this.leases.acquire(target.id, mode, owner)
    try {
      const session = await TargetSession.connect(target)
      this.#sessions.set(target.id, session)
      return { session, lease, target }
    } catch (err) {
      this.leases.release(lease)
      throw err
    }
  }

  /**
   * @param {import('./lease.js').Lease} lease
   * @param {TargetSession} [session]
   * @param {{ closeSession?: boolean }} [opts]
   */
  async release(lease, session, opts = {}) {
    this.leases.release(lease)
    if (opts.closeSession && session) {
      this.#sessions.delete(session.target.id)
      await session.close()
    }
  }

  /**
   * @param {TargetSession} session
   * @param {string} [extensionId]
   */
  extension(session, extensionId) {
    return new ExtensionRuntime(session, extensionId)
  }

  async dispose() {
    for (const stop of this.#watches.values()) {
      try { stop() } catch { /* ignore */ }
    }
    this.#watches.clear()
    this.#targetListeners.clear()
    for (const s of this.#sessions.values()) await s.close().catch(() => {})
    this.#sessions.clear()
  }
}

/** Singleton helper for smoke scripts. */
let _default
/** @returns {CdpFabric} */
export function getDefaultFabric() {
  if (!_default) _default = new CdpFabric()
  return _default
}
