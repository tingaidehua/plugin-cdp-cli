/**
 * Typed thin wrappers over common CDP domains for a connected page target.
 * @module
 */

import { connectCdp } from '../protocol/connection.js'

/**
 * @typedef {import('../types.js').CdpTargetRef} CdpTargetRef
 * @typedef {import('../protocol/connection.js').CdpConnection} CdpConnection
 */

export class TargetSession {
  /** @type {CdpTargetRef} */
  target
  /** @type {CdpConnection} */
  conn

  /**
   * @param {CdpTargetRef} target
   * @param {CdpConnection} conn
   */
  constructor(target, conn) {
    this.target = target
    this.conn = conn
  }

  /**
   * @param {CdpTargetRef} target
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<TargetSession>}
   */
  static async connect(target, opts) {
    if (!target.wsUrl) throw new Error(`target ${target.id} has no webSocketDebuggerUrl`)
    const conn = await connectCdp(target.wsUrl, opts)
    return new TargetSession(target, conn)
  }

  /** @returns {Promise<void>} */
  async close() {
    await this.conn.close()
  }

  /**
   * @param {string} expression
   * @param {{ awaitPromise?: boolean, returnByValue?: boolean }} [opts]
   * @returns {Promise<unknown>}
   */
  async evaluate(expression, opts = {}) {
    const result = /** @type {{ result?: { value?: unknown, type?: string, description?: string }, exceptionDetails?: { text?: string, exception?: { description?: string } } }} */ (
      await this.conn.send('Runtime.evaluate', {
        expression,
        awaitPromise: opts.awaitPromise !== false,
        returnByValue: opts.returnByValue !== false,
        userGesture: true,
      })
    )
    if (result.exceptionDetails) {
      const msg = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || 'Runtime.evaluate failed'
      throw new Error(msg)
    }
    return result.result?.value
  }

  /**
   * @param {string} url
   * @returns {Promise<void>}
   */
  async navigate(url) {
    await this.conn.send('Page.enable')
    await this.conn.send('Page.navigate', { url })
  }

  /**
   * Inject a <style> or <script> into the document.
   * @param {{ css?: string, js?: string, id?: string }} payload
   * @returns {Promise<unknown>}
   */
  async inject(payload) {
    const id = JSON.stringify(payload.id || `plugin-cdp-cli-${Date.now()}`)
    if (payload.css) {
      const css = JSON.stringify(payload.css)
      return this.evaluate(`(() => {
        const id = ${id};
        let el = document.querySelector('style[data-dsh-cdp-id="' + id + '"]');
        if (!el) {
          el = document.createElement('style');
          el.setAttribute('data-dsh-cdp-id', id);
          document.documentElement.appendChild(el);
        }
        el.textContent = ${css};
        return { ok: true, kind: 'css', id };
      })()`)
    }
    if (payload.js) {
      // Run as expression body (caller supplies IIFE or statements)
      return this.evaluate(payload.js)
    }
    throw new Error('inject: provide css or js')
  }

  /**
   * @param {{ format?: 'png' | 'jpeg', quality?: number, maxWidth?: number }} [opts]
   * @returns {Promise<{ data: string, mimeType: string }>}
   */
  async screenshot(opts = {}) {
    await this.conn.send('Page.enable')
    const format = opts.format || 'png'
    /** @type {Record<string, unknown>} */
    const params = { format, fromSurface: true }
    if (format === 'jpeg' && opts.quality != null) params.quality = opts.quality
    const result = /** @type {{ data: string }} */ (await this.conn.send('Page.captureScreenshot', params))
    // Bound: reject absurd payloads (>8MB base64 �?too large for tool result)
    if (result.data.length > 8 * 1024 * 1024) {
      throw new Error('screenshot: result exceeds 8MB base64 bound')
    }
    return {
      data: result.data,
      mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    }
  }

  /**
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @returns {Promise<unknown>}
   */
  send(method, params) {
    return this.conn.send(method, params)
  }

  /**
   * Subscribe to a CDP event on this target's connection.
   * @param {string} method
   * @param {(msg: import('../protocol/connection.js').CdpMessage) => void} handler
   * @returns {() => void}
   */
  on(method, handler) {
    return this.conn.on(method, handler)
  }

  /**
   * Enable Page domain + optional lifecycle events (reload / navigation).
   * @returns {Promise<void>}
   */
  async enablePageLifecycle() {
    await this.conn.send('Page.enable')
    try {
      await this.conn.send('Page.setLifecycleEventsEnabled', { enabled: true })
    } catch {
      // older Chromium �?loadEventFired / frameNavigated still work
    }
  }
}
