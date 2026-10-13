/**
 * Target graph: multi-endpoint discovery + selector matching.
 * @module
 */

import { probeHttpEndpoint } from '../endpoint/http-attach.js'
import { normalizeEndpointBase, endpointIdFromBase, endpointsFromEnv } from '../env.js'

/**
 * @typedef {import('./types.js').CdpEndpointRef} CdpEndpointRef
 * @typedef {import('./types.js').CdpTargetRef} CdpTargetRef
 * @typedef {import('./types.js').CdpSelector} CdpSelector
 */

export class TargetGraph {
  /** @type {Map<string, CdpEndpointRef>} */
  #endpoints = new Map()
  /** @type {Map<string, CdpTargetRef>} */
  #targets = new Map()
  /** @type {Map<string, number>} last refresh ms */
  #refreshedAt = new Map()

  /**
   * @param {string[]} [bases]
   */
  constructor(bases) {
    this.initialBases = bases ?? endpointsFromEnv()
  }

  /**
   * Register or refresh one HTTP attach base URL.
   * @param {string} baseOrPort
   * @param {{ label?: string, timeoutMs?: number }} [opts]
   * @returns {Promise<{ endpoint: CdpEndpointRef, targets: CdpTargetRef[] }>}
   */
  async addEndpoint(baseOrPort, opts = {}) {
    const base = normalizeEndpointBase(baseOrPort)
    const result = await probeHttpEndpoint(base, opts)
    this.#endpoints.set(result.endpoint.id, result.endpoint)
    // drop stale targets for this endpoint
    for (const [tid, t] of this.#targets) {
      if (t.endpointId === result.endpoint.id) this.#targets.delete(tid)
    }
    for (const t of result.targets) this.#targets.set(t.id, t)
    this.#refreshedAt.set(result.endpoint.id, Date.now())
    return result
  }

  /** Refresh all known endpoints (or initial env list if empty). */
  async refreshAll() {
    const bases = this.#endpoints.size > 0
      ? [...this.#endpoints.values()].map(e => e.baseUrl)
      : this.initialBases
    /** @type {CdpEndpointRef[]} */
    const endpoints = []
    /** @type {CdpTargetRef[]} */
    const targets = []
    for (const base of bases) {
      const r = await this.addEndpoint(base)
      endpoints.push(r.endpoint)
      targets.push(...r.targets)
    }
    return { endpoints, targets }
  }

  /** @returns {CdpEndpointRef[]} */
  listEndpoints() {
    return [...this.#endpoints.values()]
  }

  /**
   * @param {{ type?: string, pagesOnly?: boolean }} [filter]
   * @returns {CdpTargetRef[]}
   */
  listTargets(filter = {}) {
    let list = [...this.#targets.values()]
    if (filter.pagesOnly || filter.type === 'page') {
      list = list.filter(t => t.type === 'page' || t.type === 'other')
    } else if (filter.type) {
      list = list.filter(t => t.type === filter.type)
    }
    return list
  }

  /**
   * Resolve a selector to one or more targets. Fails loud on 0/ambiguous matches.
   * @param {CdpSelector} selector
   * @returns {Promise<CdpTargetRef[]>}
   */
  async resolve(selector) {
    if (selector.port != null || selector.endpointId) {
      if (selector.port != null) await this.addEndpoint(String(selector.port))
      else if (selector.endpointId && !this.#endpoints.has(selector.endpointId)) {
        // try env bases that match id
        for (const base of this.initialBases) {
          if (endpointIdFromBase(base) === selector.endpointId) {
            await this.addEndpoint(base)
            break
          }
        }
      }
    } else if (this.#targets.size === 0) {
      await this.refreshAll()
    }

    let candidates = this.listTargets({ pagesOnly: true })

    if (selector.endpointId) {
      candidates = candidates.filter(t => t.endpointId === selector.endpointId)
    } else if (selector.port != null) {
      const eid = endpointIdFromBase(normalizeEndpointBase(String(selector.port)))
      candidates = candidates.filter(t => t.endpointId === eid)
    }

    if (selector.targetId) {
      candidates = candidates.filter(
        t => t.id === selector.targetId
          || t.devtoolsId === selector.targetId
          || t.id.endsWith(`:${selector.targetId}`),
      )
    }
    if (selector.urlIncludes) {
      const needle = String(selector.urlIncludes).toLowerCase()
      candidates = candidates.filter(t => t.url.toLowerCase().includes(needle))
    }
    if (selector.titleIncludes) {
      const needle = String(selector.titleIncludes).toLowerCase()
      candidates = candidates.filter(t => t.title.toLowerCase().includes(needle))
    }

    // Prefer real http(s) pages over about:blank / extension workers when still ambiguous
    const httpPages = candidates.filter(t => /^https?:/i.test(t.url))
    if (httpPages.length > 0) candidates = httpPages

    if (candidates.length === 0) {
      throw new Error(
        `cdp target: no match for selector ${JSON.stringify(selector)}`,
      )
    }
    if (candidates.length > 1 && !selector.allowMultiple) {
      const preview = candidates.slice(0, 5).map(t => ({
        id: t.id,
        title: t.title,
        url: t.url,
      }))
      throw new Error(
        `cdp target: ${candidates.length} matches (pass allowMultiple or narrow url/title/targetId): `
        + JSON.stringify(preview),
      )
    }
    return candidates
  }

  /**
   * @param {CdpSelector} selector
   * @returns {Promise<CdpTargetRef>}
   */
  async resolveOne(selector) {
    const list = await this.resolve({ ...selector, allowMultiple: false })
    return list[0]
  }

  /**
   * @param {string} targetId
   * @returns {CdpTargetRef | undefined}
   */
  get(targetId) {
    return this.#targets.get(/** @type {any} */ (targetId))
  }
}
