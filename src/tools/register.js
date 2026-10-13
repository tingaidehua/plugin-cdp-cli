/**
 * Model-facing CDP tools. Uses @deepseek-ai/dsh-tools when available.
 * @module
 */

import { tryRequireFromProfile } from '../profile-require.js'

/**
 * @param {any} toolsSvc
 * @param {import('../fabric.js').CdpFabric} fabric
 */
export async function registerTools(toolsSvc, fabric) {
  const mod = tryRequireFromProfile('@deepseek-ai/dsh-tools')
  const defineTool = mod?.defineTool
  if (!defineTool) {
    return { registered: false, reason: 'dsh-tools not resolvable from profile' }
  }

  const disposers = []

  disposers.push(toolsSvc.register(defineTool({
    name: 'cdp_endpoints',
    description: 'List CDP endpoints known to plugin-cdp-cli (HTTP attach ports and sidebar broker stub). Refresh by default.',
    parameters: {
      refresh: {
        type: 'boolean',
        description: 'Probe endpoints again before listing (default true).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          endpoints: { type: 'array', required: true, items: { type: 'object' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.endpoints, null, 2) }],
    },
    async execute(args) {
      if (args.refresh !== false) await fabric.start()
      const sidebar = await fabric.sidebarBroker.describe()
      return { endpoints: [...fabric.listEndpoints(), sidebar] }
    },
  })))

  disposers.push(toolsSvc.register(defineTool({
    name: 'cdp_targets',
    description: 'List page targets across CDP endpoints. Optionally filter by port/url/title.',
    parameters: {
      port: { type: 'number', description: 'Remote debugging port (e.g. 9225).' },
      endpointId: { type: 'string', description: 'Endpoint id like 127.0.0.1:9225.' },
      urlIncludes: { type: 'string' },
      titleIncludes: { type: 'string' },
      refresh: { type: 'boolean', description: 'Refresh endpoints first (default true).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          targets: { type: 'array', required: true, items: { type: 'object' } },
        },
      },
      render: (_a, v) => [{ type: 'text', text: JSON.stringify(v.targets, null, 2) }],
    },
    async execute(args) {
      if (args.refresh !== false) {
        if (args.port != null) await fabric.addEndpoint(String(args.port))
        else await fabric.start()
      }
      let targets = fabric.listTargets({ pagesOnly: true })
      if (args.port != null) {
        const { endpointIdFromBase, normalizeEndpointBase } = await import('../env.js')
        const eid = endpointIdFromBase(normalizeEndpointBase(String(args.port)))
        targets = targets.filter(t => t.endpointId === eid)
      }
      if (args.endpointId) targets = targets.filter(t => t.endpointId === args.endpointId)
      if (args.urlIncludes) {
        const needle = String(args.urlIncludes).toLowerCase()
        targets = targets.filter(t => t.url.toLowerCase().includes(needle))
      }
      if (args.titleIncludes) {
        const needle = String(args.titleIncludes).toLowerCase()
        targets = targets.filter(t => t.title.toLowerCase().includes(needle))
      }
      return {
        targets: targets.map(t => ({
          id: t.id,
          endpointId: t.endpointId,
          type: t.type,
          title: t.title,
          url: t.url,
        })),
      }
    },
  })))

  disposers.push(toolsSvc.register(defineTool({
    name: 'cdp_evaluate',
    description: 'Evaluate JavaScript in a page matched by port + url/title/targetId. Fails if zero or multiple matches unless allowMultiple.',
    parameters: {
      expression: { type: 'string', required: true, description: 'JS expression to evaluate.' },
      port: { type: 'number' },
      endpointId: { type: 'string' },
      urlIncludes: { type: 'string' },
      titleIncludes: { type: 'string' },
      targetId: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
    },
    async execute(args, exec) {
      const { session, lease, target } = await fabric.open({
        port: args.port,
        endpointId: args.endpointId,
        urlIncludes: args.urlIncludes,
        titleIncludes: args.titleIncludes,
        targetId: args.targetId,
      }, { owner: 'tool:cdp_evaluate' })
      try {
        exec?.signal?.throwIfAborted?.()
        const value = await session.evaluate(args.expression)
        return { targetId: target.id, url: target.url, title: target.title, value }
      } finally {
        await fabric.release(lease, session, { closeSession: true })
      }
    },
  })))

  disposers.push(toolsSvc.register(defineTool({
    name: 'cdp_inject',
    description: 'Inject CSS and/or JS into a matched page (extension-porting primitive).',
    parameters: {
      css: { type: 'string' },
      js: { type: 'string' },
      styleId: { type: 'string' },
      port: { type: 'number' },
      endpointId: { type: 'string' },
      urlIncludes: { type: 'string' },
      titleIncludes: { type: 'string' },
      targetId: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
    },
    async execute(args) {
      if (!args.css && !args.js) throw new Error('cdp_inject: provide css and/or js')
      const { session, lease, target } = await fabric.open({
        port: args.port,
        endpointId: args.endpointId,
        urlIncludes: args.urlIncludes,
        titleIncludes: args.titleIncludes,
        targetId: args.targetId,
      }, { owner: 'tool:cdp_inject' })
      try {
        /** @type {unknown[]} */
        const results = []
        if (args.css) results.push(await session.inject({ css: args.css, id: args.styleId || 'plugin-cdp-cli-inject' }))
        if (args.js) results.push(await session.evaluate(args.js))
        return { targetId: target.id, url: target.url, results }
      } finally {
        await fabric.release(lease, session, { closeSession: true })
      }
    },
  })))

  disposers.push(toolsSvc.register(defineTool({
    name: 'cdp_navigate',
    description: 'Navigate a matched page to a URL.',
    parameters: {
      url: { type: 'string', required: true },
      port: { type: 'number' },
      endpointId: { type: 'string' },
      urlIncludes: { type: 'string' },
      titleIncludes: { type: 'string' },
      targetId: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }],
    },
    async execute(args) {
      const { session, lease, target } = await fabric.open({
        port: args.port,
        endpointId: args.endpointId,
        urlIncludes: args.urlIncludes,
        titleIncludes: args.titleIncludes,
        targetId: args.targetId,
      }, { owner: 'tool:cdp_navigate' })
      try {
        await session.navigate(args.url)
        return { targetId: target.id, navigatedTo: args.url }
      } finally {
        await fabric.release(lease, session, { closeSession: true })
      }
    },
  })))

  disposers.push(toolsSvc.register(defineTool({
    name: 'cdp_screenshot',
    description: 'Capture a PNG screenshot of a matched page (base64, bounded to 8MB).',
    parameters: {
      port: { type: 'number' },
      endpointId: { type: 'string' },
      urlIncludes: { type: 'string' },
      titleIncludes: { type: 'string' },
      targetId: { type: 'string' },
      format: { type: 'string', enum: ['png', 'jpeg'] },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          targetId: { type: 'string', required: true },
          mimeType: { type: 'string', required: true },
          byteLength: { type: 'integer', required: true },
          dataBase64: { type: 'string', required: true },
        },
      },
      render: (_a, v) => [{
        type: 'text',
        text: `screenshot ${v.mimeType} ${v.byteLength} bytes (base64 omitted in render; see value)`,
      }],
    },
    async execute(args) {
      const { session, lease, target } = await fabric.open({
        port: args.port,
        endpointId: args.endpointId,
        urlIncludes: args.urlIncludes,
        titleIncludes: args.titleIncludes,
        targetId: args.targetId,
      }, { owner: 'tool:cdp_screenshot' })
      try {
        const shot = await session.screenshot({
          format: args.format === 'jpeg' ? 'jpeg' : 'png',
        })
        return {
          targetId: target.id,
          mimeType: shot.mimeType,
          byteLength: shot.data.length,
          dataBase64: shot.data,
        }
      } finally {
        await fabric.release(lease, session, { closeSession: true })
      }
    },
  })))

  return { registered: true, count: disposers.length, dispose: () => disposers.forEach(d => d?.()) }
}
