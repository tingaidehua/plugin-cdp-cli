#!/usr/bin/env node
/**
 * Live smoke against HTTP CDP endpoints from ~/.env (default 9225).
 * Verdicts: pass | fail | blocked
 */
import { CdpFabric } from '../src/fabric.js'
import { loadHomeEnv, endpointsFromEnv } from '../src/env.js'

loadHomeEnv()

const fabric = new CdpFabric({ endpoints: endpointsFromEnv() })
/** @type {Array<{ name: string, status: string, detail?: string }>} */
const results = []

function record(name, status, detail) {
  results.push({ name, status, detail })
  const mark = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : status.toUpperCase()
  console.log(`[${mark}] ${name}${detail ? ` �?${detail}` : ''}`)
}

try {
  const started = await fabric.start()
  const okEndpoints = started.endpoints.filter(e => e.status === 'ok')
  if (okEndpoints.length === 0) {
    record('endpoint-probe', 'blocked', 'no reachable CDP endpoint (is 9225 up?)')
  } else {
    record(
      'endpoint-probe',
      'pass',
      okEndpoints.map(e => `${e.id}(${e.latencyMs}ms)`).join(', '),
    )
  }

  // Multi-endpoint: try listing each env base
  const bases = endpointsFromEnv()
  if (bases.length >= 2) {
    let multiOk = 0
    for (const b of bases) {
      const r = await fabric.addEndpoint(b)
      if (r.endpoint.status === 'ok') multiOk++
    }
    record(
      'multi-endpoint',
      multiOk >= 1 ? 'pass' : 'fail',
      `${multiOk}/${bases.length} reachable`,
    )
  } else {
    record('multi-endpoint', 'unobserved', 'only one endpoint configured')
  }

  if (okEndpoints.length > 0) {
    try {
      const target = await fabric.resolveOne({
        port: Number(process.env.DSH_CDP_DEFAULT_PORT || 9225),
        urlIncludes: process.env.DSH_CDP_SMOKE_URL_INCLUDES || 'craftinginterpreters',
      })
      record('resolve-scanning', 'pass', `${target.title} | ${target.url}`)

      const { session, lease } = await fabric.open(target, { owner: 'smoke' })
      try {
        const href = await session.evaluate('location.href')
        record('evaluate-href', href === target.url || String(href).includes('http') ? 'pass' : 'fail', String(href))

        await session.inject({
          css: 'html { --plugin-cdp-cli-smoke: 1; }',
          id: 'plugin-cdp-cli-smoke',
        })
        const flagged = await session.evaluate(
          'Boolean(document.querySelector(\'style[data-dsh-cdp-id="plugin-cdp-cli-smoke"]\'))',
        )
        record('inject-css', flagged ? 'pass' : 'fail')
      } finally {
        await fabric.release(lease, session, { closeSession: true })
      }
    } catch (err) {
      record('page-session', 'fail', String(err?.message || err))
    }
  }
} catch (err) {
  record('smoke', 'fail', String(err?.message || err))
} finally {
  await fabric.dispose()
}

const failed = results.filter(r => r.status === 'fail')
const blocked = results.filter(r => r.status === 'blocked')
console.log('\n--- summary ---')
console.log(JSON.stringify(results, null, 2))
if (failed.length) process.exitCode = 1
else if (blocked.length && !results.some(r => r.status === 'pass')) process.exitCode = 2
