/**
 * Low-level CDP JSON-RPC over WebSocket (Node native WebSocket).
 * @module
 */

/**
 * @typedef {object} CdpMessage
 * @property {number} [id]
 * @property {string} [method]
 * @property {unknown} [params]
 * @property {unknown} [result]
 * @property {{ code: number, message: string, data?: unknown }} [error]
 * @property {string} [sessionId]
 */

/**
 * @typedef {(msg: CdpMessage) => void} CdpEventHandler
 */

export class CdpConnection {
  /** @type {WebSocket} */
  #ws
  /** @type {Map<number, { resolve: (v: unknown) => void, reject: (e: Error) => void, timer: ReturnType<typeof setTimeout> }>} */
  #pending = new Map()
  /** @type {Map<string, Set<CdpEventHandler>>} */
  #events = new Map()
  #nextId = 1
  #closed = false
  /** @type {string} */
  url
  /** @type {number} */
  defaultTimeoutMs

  /**
   * @param {string} wsUrl
   * @param {{ timeoutMs?: number }} [opts]
   */
  constructor(wsUrl, opts = {}) {
    this.url = wsUrl
    this.defaultTimeoutMs = opts.timeoutMs ?? 30_000
    this.#ws = new WebSocket(wsUrl)
  }

  /** @returns {Promise<void>} */
  async open() {
    if (this.#ws.readyState === WebSocket.OPEN) return
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onError = (ev) => {
        cleanup()
        reject(new Error(`CDP WebSocket error: ${ev.message || 'connect failed'} for ${this.url}`))
      }
      const cleanup = () => {
        this.#ws.removeEventListener('open', onOpen)
        this.#ws.removeEventListener('error', onError)
      }
      this.#ws.addEventListener('open', onOpen)
      this.#ws.addEventListener('error', onError)
    })
    this.#ws.addEventListener('message', (ev) => this.#onMessage(String(ev.data)))
    this.#ws.addEventListener('close', () => this.#onClose())
  }

  /**
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @param {{ sessionId?: string, timeoutMs?: number }} [opts]
   * @returns {Promise<unknown>}
   */
  send(method, params = {}, opts = {}) {
    if (this.#closed || this.#ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP connection closed (${this.url})`))
    }
    const id = this.#nextId++
    /** @type {CdpMessage} */
    const msg = { id, method, params }
    if (opts.sessionId) msg.sessionId = opts.sessionId
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`CDP timeout ${timeoutMs}ms: ${method}`))
      }, timeoutMs)
      this.#pending.set(id, { resolve, reject, timer })
      this.#ws.send(JSON.stringify(msg))
    })
  }

  /**
   * @param {string} method
   * @param {CdpEventHandler} handler
   * @returns {() => void}
   */
  on(method, handler) {
    let set = this.#events.get(method)
    if (!set) {
      set = new Set()
      this.#events.set(method, set)
    }
    set.add(handler)
    return () => set.delete(handler)
  }

  /** @returns {Promise<void>} */
  async close() {
    if (this.#closed) return
    this.#closed = true
    for (const [, p] of this.#pending) {
      clearTimeout(p.timer)
      p.reject(new Error('CDP connection closed'))
    }
    this.#pending.clear()
    if (this.#ws.readyState === WebSocket.OPEN || this.#ws.readyState === WebSocket.CONNECTING) {
      this.#ws.close()
    }
  }

  /**
   * @param {string} data
   */
  #onMessage(data) {
    /** @type {CdpMessage} */
    let msg
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }
    if (msg.id != null && this.#pending.has(msg.id)) {
      const p = this.#pending.get(msg.id)
      this.#pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) {
        p.reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`))
      } else {
        p.resolve(msg.result)
      }
      return
    }
    if (msg.method) {
      const set = this.#events.get(msg.method)
      if (set) for (const h of set) h(msg)
      const all = this.#events.get('*')
      if (all) for (const h of all) h(msg)
    }
  }

  #onClose() {
    this.#closed = true
    for (const [, p] of this.#pending) {
      clearTimeout(p.timer)
      p.reject(new Error('CDP connection closed'))
    }
    this.#pending.clear()
  }
}

/**
 * Connect and return an open connection.
 * @param {string} wsUrl
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<CdpConnection>}
 */
export async function connectCdp(wsUrl, opts) {
  const conn = new CdpConnection(wsUrl, opts)
  await conn.open()
  return conn
}
