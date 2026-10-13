/**
 * Endpoint-level target discovery via browser WebSocket (Target.* events).
 * Complements HTTP /json/list polling so new/closed/refreshed tabs wake injectors fast.
 * @module
 */

import { connectCdp } from '../protocol/connection.js'
import { mapDevtoolsTarget, probeHttpEndpoint } from './http-attach.js'
import { endpointIdFromBase } from '../env.js'

/**
 * @typedef {'target-created'|'target-destroyed'|'target-changed'|'endpoint-down'} TargetWatchEvent
 * @typedef {{ type: TargetWatchEvent, endpointId: string, targetId?: string, url?: string, title?: string, reason?: string }} TargetWatchPayload
 */

/**
 * Watch one HTTP-attach endpoint for Target.create/destroy/info via browser CDP.
 * Falls back to faster /json/list polling if browser WS is unavailable.
 *
 * @param {string} baseUrl
 * @param {(ev: TargetWatchPayload) => void} onEvent
 * @param {{ pollMs?: number, logger?: { info?: Function, warn?: Function } }} [opts]
 * @returns {Promise<() => void>} disposer
 */
export async function watchHttpEndpointTargets(baseUrl, onEvent, opts = {}) {
  const base = String(baseUrl).replace(/\/$/, '')
  const endpointId = endpointIdFromBase(base)
  const logger = opts.logger
  const pollMs = Math.max(1500, opts.pollMs ?? 2500)
  /** @type {Set<string>} */
  let known = new Set()
  let stopped = false
  /** @type {import('../protocol/connection.js').CdpConnection | null} */
  let conn = null
  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null
  /** @type {Array<() => void>} */
  const offs = []

  async function refreshKnownFromList(reason) {
    if (stopped) return
    try {
      const { endpoint, targets } = await probeHttpEndpoint(base, { timeoutMs: 4_000 })
      if (endpoint.status !== 'ok') {
        onEvent({ type: 'endpoint-down', endpointId, reason: endpoint.status })
        return
      }
      const pages = targets.filter(t => t.type === 'page' || t.type === 'other')
      const next = new Set(pages.map(t => t.id))
      for (const t of pages) {
        if (!known.has(t.id)) {
          onEvent({
            type: 'target-created',
            endpointId,
            targetId: t.id,
            url: t.url,
            title: t.title,
            reason: reason || 'list',
          })
        }
      }
      for (const id of known) {
        if (!next.has(id)) {
          onEvent({ type: 'target-destroyed', endpointId, targetId: id, reason: reason || 'list' })
        }
      }
      known = next
    } catch (err) {
      logger?.warn?.('cdp-watch: list failed %s (%s)', endpointId, String(err?.message || err))
    }
  }

  async function attachBrowser() {
    const ver = await fetch(`${base}/json/version`, { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
    const wsUrl = ver?.webSocketDebuggerUrl
    if (!wsUrl) {
      logger?.info?.('cdp-watch: no browser WS on %s — poll only', endpointId)
      return false
    }
    conn = await connectCdp(wsUrl, { timeoutMs: 8_000 })
    await conn.send('Target.setDiscoverTargets', { discover: true })
    offs.push(conn.on('Target.targetCreated', (msg) => {
      const info = msg?.params?.targetInfo
      if (!info || (info.type !== 'page' && info.type !== 'other')) return
      const t = mapDevtoolsTarget(endpointId, {
        id: info.targetId,
        type: info.type,
        title: info.title || '',
        url: info.url || '',
        webSocketDebuggerUrl: info.url, // placeholder; list refresh fills real ws
      })
      // Prefer real list row (has page wsUrl)
      void refreshKnownFromList('targetCreated')
      onEvent({
        type: 'target-created',
        endpointId,
        targetId: t.id,
        url: info.url,
        title: info.title,
        reason: 'Target.targetCreated',
      })
    }))
    offs.push(conn.on('Target.targetDestroyed', (msg) => {
      const tid = msg?.params?.targetId
      if (!tid) return
      const id = `${endpointId}:${tid}`
      known.delete(id)
      onEvent({
        type: 'target-destroyed',
        endpointId,
        targetId: id,
        reason: 'Target.targetDestroyed',
      })
    }))
    offs.push(conn.on('Target.targetInfoChanged', (msg) => {
      const info = msg?.params?.targetInfo
      if (!info || (info.type !== 'page' && info.type !== 'other')) return
      const id = `${endpointId}:${info.targetId}`
      onEvent({
        type: 'target-changed',
        endpointId,
        targetId: id,
        url: info.url,
        title: info.title,
        reason: 'Target.targetInfoChanged',
      })
      // URL change after create often means navigation — wake injectors
      void refreshKnownFromList('targetInfoChanged')
    }))
    logger?.info?.('cdp-watch: browser Target.* on %s', endpointId)
    return true
  }

  await refreshKnownFromList('start')
  try {
    await attachBrowser()
  } catch (err) {
    logger?.warn?.('cdp-watch: browser attach failed %s (%s)', endpointId, String(err?.message || err))
  }

  pollTimer = setInterval(() => { void refreshKnownFromList('poll') }, pollMs)
  if (typeof pollTimer.unref === 'function') pollTimer.unref()

  return () => {
    stopped = true
    if (pollTimer) clearInterval(pollTimer)
    for (const off of offs) {
      try { off() } catch { /* ignore */ }
    }
    void conn?.close?.().catch(() => {})
    conn = null
  }
}
