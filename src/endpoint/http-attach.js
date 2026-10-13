/**
 * HTTP attach endpoint: list targets via /json/list (Chrome/Edge/WebView2).
 * @module
 */

import { endpointIdFromBase } from '../env.js'
import { makeTargetId } from '../types.js'

/**
 * @typedef {import('../types.js').CdpEndpointRef} CdpEndpointRef
 * @typedef {import('../types.js').CdpTargetRef} CdpTargetRef
 */

/**
 * @param {string} baseUrl
 * @param {{ timeoutMs?: number, label?: string }} [opts]
 * @returns {Promise<{ endpoint: CdpEndpointRef, targets: CdpTargetRef[] }>}
 */
export async function probeHttpEndpoint(baseUrl, opts = {}) {
  const id = endpointIdFromBase(baseUrl)
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5_000)
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/json/list`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      return {
        endpoint: {
          id,
          kind: 'http-attach',
          baseUrl,
          status: 'unreachable',
          label: opts.label,
          latencyMs: Date.now() - started,
        },
        targets: [],
      }
    }
    /** @type {Array<Record<string, string>>} */
    const raw = await res.json()
    const latencyMs = Date.now() - started
    const endpoint = /** @type {CdpEndpointRef} */ ({
      id,
      kind: 'http-attach',
      baseUrl: baseUrl.replace(/\/$/, ''),
      status: 'ok',
      label: opts.label,
      latencyMs,
    })
    const targets = raw.map(t => mapDevtoolsTarget(endpoint.id, t))
    return { endpoint, targets }
  } catch {
    return {
      endpoint: {
        id,
        kind: 'http-attach',
        baseUrl: baseUrl.replace(/\/$/, ''),
        status: 'unreachable',
        label: opts.label,
        latencyMs: Date.now() - started,
      },
      targets: [],
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param {string} endpointId
 * @param {Record<string, string>} t
 * @returns {CdpTargetRef}
 */
export function mapDevtoolsTarget(endpointId, t) {
  return {
    id: makeTargetId(endpointId, t.id || t.webSocketDebuggerUrl || String(Math.random())),
    endpointId,
    type: t.type || 'page',
    title: t.title || '',
    url: t.url || '',
    wsUrl: t.webSocketDebuggerUrl,
    devtoolsId: t.id,
  }
}

/**
 * Contract for a future Desktop Sidebar Browser CDP broker.
 * Harness must implement an authenticated, target-scoped broker;
 * this module only defines the adapter shape for registration.
 * @typedef {object} SidebarBrokerAdapter
 * @property {() => Promise<CdpEndpointRef>} describe
 * @property {() => Promise<CdpTargetRef[]>} listTargets
 * @property {(targetId: string) => Promise<{ wsUrl: string, token?: string }>} attach
 */

/**
 * Placeholder adapter that reports auth-required until harness ships the broker.
 * @returns {SidebarBrokerAdapter}
 */
export function createSidebarBrokerStub() {
  return {
    async describe() {
      return {
        id: 'sidebar-broker',
        kind: 'sidebar-broker',
        baseUrl: 'dsh://sidebar-browser-broker',
        status: 'auth-required',
        label: 'Official Sidebar Browser (broker not installed)',
      }
    },
    async listTargets() {
      return []
    },
    async attach() {
      throw new Error(
        'sidebar-broker: Desktop CDP broker is not installed. '
        + 'Attach external WebView2/Chrome via http-attach (e.g. port 9225), '
        + 'or implement the harness broker per docs/ARCHITECTURE.md.',
      )
    },
  }
}
