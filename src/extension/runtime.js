/**
 * Extension Runtime — primitives for porting Chrome content-script style behavior via CDP.
 * @module
 */

/**
 * @typedef {import('../domains/session.js').TargetSession} TargetSession
 */

const BUS_KEY = '__dshCdpExtBus'

/**
 * Inject CSS once (idempotent by id).
 * @param {TargetSession} session
 * @param {string} css
 * @param {string} [styleId]
 */
export async function injectStyles(session, css, styleId = 'dsh-ext-style') {
  return session.inject({ css, id: styleId })
}

/**
 * Ensure a tiny in-page message bus exists (content-script ↔ background emulation).
 * @param {TargetSession} session
 */
export async function ensureMessageBus(session) {
  return session.evaluate(`(() => {
    const key = ${JSON.stringify(BUS_KEY)};
    if (globalThis[key]) return { ok: true, existed: true };
    const listeners = new Map();
    globalThis[key] = {
      on(channel, fn) {
        if (!listeners.has(channel)) listeners.set(channel, new Set());
        listeners.get(channel).add(fn);
        return () => listeners.get(channel)?.delete(fn);
      },
      emit(channel, payload) {
        const set = listeners.get(channel);
        if (!set) return 0;
        for (const fn of set) try { fn(payload); } catch (e) { console.error(e); }
        return set.size;
      },
      once(channel, fn) {
        const off = this.on(channel, (p) => { off(); fn(p); });
        return off;
      },
    };
    return { ok: true, existed: false };
  })()`)
}

/**
 * Mark an element tree as already processed by an extension port.
 * @param {TargetSession} session
 * @param {string} attr  e.g. data-imt-p
 * @param {string} selector
 * @param {string} [value]
 */
export async function markNodes(session, attr, selector, value = '1') {
  return session.evaluate(`(() => {
    const attr = ${JSON.stringify(attr)};
    const sel = ${JSON.stringify(selector)};
    const value = ${JSON.stringify(value)};
    const nodes = [...document.querySelectorAll(sel)];
    for (const n of nodes) n.setAttribute(attr, value);
    return { marked: nodes.length };
  })()`)
}

/**
 * Run a content-script-like function body in the page (string IIFE source).
 * @param {TargetSession} session
 * @param {string} source  must be an expression returning a value
 */
export async function runContentScript(session, source) {
  await ensureMessageBus(session)
  return session.evaluate(source)
}

/**
 * High-level helper used by extension ports.
 */
export class ExtensionRuntime {
  /** @type {TargetSession} */
  session
  /** @type {string} */
  extensionId

  /**
   * @param {TargetSession} session
   * @param {string} [extensionId]
   */
  constructor(session, extensionId = 'dsh-ext') {
    this.session = session
    this.extensionId = extensionId
  }

  /** @param {string} css @param {string} [id] */
  injectStyles(css, id) {
    return injectStyles(this.session, css, id ?? `${this.extensionId}-css`)
  }

  ensureBus() {
    return ensureMessageBus(this.session)
  }

  /** @param {string} source */
  run(source) {
    return runContentScript(this.session, source)
  }

  /**
   * @param {string} attr
   * @param {string} selector
   * @param {string} [value]
   */
  mark(attr, selector, value) {
    return markNodes(this.session, attr, selector, value)
  }
}
