/**
 * Page Algebra — reversible DOM layer stack for CDP page plugins.
 *
 * First principles (framework-agnostic):
 *   base page  +  layer(A)  +  layer(B)  =  composed view
 *   composed   -  layer(A)               =  base + B   (true subtract: detach + restore)
 *
 * Modes are visibility transforms over the stack, not permanent mutation of base.
 * Translation is one consumer; annotators / highlighters / a11y overlays should reuse this.
 *
 * Injected API: window.__dshAlgebra
 * @module
 */

/**
 * Install (or return) the in-page algebra runtime.
 * Idempotent. Safe to call from any plugin content script.
 */
export function makeInstallPageAlgebraScript() {
  return `(() => {
    if (window.__dshAlgebra && window.__dshAlgebra.version >= 3) {
      return { ok: true, already: true, version: window.__dshAlgebra.version };
    }

    /** @type {Map<string, { nodes: Element[], restores: Array<() => void>, meta: object }>} */
    const layers = new Map();

    function preserveScroll(fn) {
      const html = document.documentElement;
      const beforeH = Math.max(1, html.scrollHeight);
      const ratio = (window.scrollY || 0) / beforeH;
      const out = fn();
      void document.body.offsetHeight;
      // Site positioners pin absolute margin chrome to in-flow anchors.
      // In overlay/translation those anchors are clipped → refreshAsides piles
      // asides on top of each other; skip it and pack instead.
      const view = html.getAttribute('dsh-view') || '';
      const skipRefresh = view === 'overlay' || html.getAttribute('imt-state') === 'translation';
      try {
        if (!skipRefresh && typeof window.refreshAsides === 'function') window.refreshAsides();
      } catch (_) {}
      try { window.dispatchEvent(new Event('resize')); } catch (_) {}
      const afterH = html.scrollHeight;
      const max = Math.max(0, afterH - (window.innerHeight || 0));
      window.scrollTo(0, Math.min(max, Math.max(0, Math.round(ratio * afterH))));
      try {
        if (!skipRefresh && typeof window.refreshAsides === 'function') window.refreshAsides();
      } catch (_) {}
      try {
        if (typeof window.__imtPackAbsoluteAsides === 'function') window.__imtPackAbsoluteAsides();
      } catch (_) {}
      return out;
    }

    /**
     * Register / replace a layer.
     * @param {string} name
     * @param {{ nodes?: Element[], restores?: Array<() => void>, meta?: object }} spec
     */
    function add(name, spec) {
      remove(name, { keepScroll: true });
      const nodes = (spec && spec.nodes) || [];
      const restores = (spec && spec.restores) || [];
      const meta = (spec && spec.meta) || {};
      layers.set(name, { nodes, restores, meta });
      document.documentElement.setAttribute('dsh-layer-' + name, '1');
      return { name, count: nodes.length };
    }

    /**
     * True subtract: detach nodes + run restores → base styles back.
     * @param {string} name
     * @param {{ keepScroll?: boolean }} [opts]
     */
    function remove(name, opts) {
      const run = () => {
        const layer = layers.get(name);
        if (!layer) {
          document.documentElement.removeAttribute('dsh-layer-' + name);
          return { name, removed: 0 };
        }
        for (const n of layer.nodes) {
          try { n.remove(); } catch (_) {}
        }
        for (const r of layer.restores) {
          try { r(); } catch (_) {}
        }
        layers.delete(name);
        document.documentElement.removeAttribute('dsh-layer-' + name);
        return { name, removed: layer.nodes.length };
      };
      return opts && opts.keepScroll ? run() : preserveScroll(run);
    }

    /**
     * Drop layer registry without touching DOM (rebinding already-mounted nodes).
     * @param {string} name
     */
    function forget(name) {
      layers.delete(name);
      document.documentElement.removeAttribute('dsh-layer-' + name);
      return { name, forgotten: true };
    }

    function has(name) {
      return layers.has(name);
    }

    function list() {
      return [...layers.keys()];
    }

    /**
     * Visibility transform ("multiply"): does not add/remove nodes.
     * @param {string} mode 'base' | 'compose' | 'overlay'
     *   base     = hide all registered layer nodes (CSS), keep them in DOM optional —
     *              prefer remove() for true original; mode base used when layers stay
     *   compose  = show base + layers
     *   overlay  = hide base anchors marked data-dsh-base, show layers
     */
    function setView(mode) {
      return preserveScroll(() => {
        const html = document.documentElement;
        html.setAttribute('dsh-view', mode);
        return { mode };
      });
    }

    /**
     * Apply a CSS transform string to a layer's root nodes (future "multiply").
     * @param {string} name
     * @param {string} transformCss
     */
    function transform(name, transformCss) {
      const layer = layers.get(name);
      if (!layer) return { ok: false };
      for (const n of layer.nodes) {
        n.style.setProperty('transform', transformCss, 'important');
      }
      return { ok: true, count: layer.nodes.length };
    }

    function get(name) {
      return layers.get(name) || null;
    }

    window.__dshAlgebra = {
      version: 3,
      add,
      remove,
      forget,
      has,
      list,
      setView,
      transform,
      preserveScroll,
      get,
    };
    document.documentElement.setAttribute('dsh-algebra', '1');
    return { ok: true, version: 3 };
  })()`
}

/**
 * CSS companion for view transforms (base / compose / overlay).
 * Plugins may append more; these are the generic hooks.
 */
export const PAGE_ALGEBRA_CSS = `
/* Page Algebra view modes — plugins mark anchors with data-dsh-base="layerName" */
[dsh-view="base"] [data-dsh-layer] {
  display: none !important;
}
[dsh-view="overlay"] [data-dsh-base] {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  margin: -1px !important;
  padding: 0 !important;
  overflow: hidden !important;
  clip: rect(0,0,0,0) !important;
  border: 0 !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
[dsh-view="compose"] [data-dsh-layer],
[dsh-view="overlay"] [data-dsh-layer] {
  display: block !important;
}
`

/**
 * @param {'base'|'compose'|'overlay'} mode
 */
export function makeAlgebraSetViewScript(mode) {
  return `(() => {
    if (!window.__dshAlgebra) return { ok: false, error: 'algebra not installed' };
    return window.__dshAlgebra.setView(${JSON.stringify(mode)});
  })()`
}

/**
 * @param {string} name
 */
export function makeAlgebraRemoveLayerScript(name) {
  return `(() => {
    if (!window.__dshAlgebra) return { ok: false, error: 'algebra not installed' };
    return window.__dshAlgebra.remove(${JSON.stringify(name)});
  })()`
}
