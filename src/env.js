/**
 * Load ~/.env into process.env without overriding existing vars.
 * Never logs secret values.
 * @module
 */

import { homedir } from 'node:os'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {string} [path]
 * @returns {Record<string, string>}
 */
export function loadHomeEnv(path = join(homedir(), '.env')) {
  /** @type {Record<string, string>} */
  const out = {}
  if (!existsSync(path)) return out
  const text = readFileSync(path, 'utf8')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
    if (process.env[key] === undefined) process.env[key] = value
  }
  return out
}

/**
 * Parse DSH_CDP_ENDPOINTS / DSH_CDP_DEFAULT_PORT into base URLs.
 * @returns {string[]}
 */
export function endpointsFromEnv() {
  loadHomeEnv()
  const raw = process.env.DSH_CDP_ENDPOINTS?.trim()
  if (raw) {
    return raw.split(',').map(s => normalizeEndpointBase(s.trim())).filter(Boolean)
  }
  const port = process.env.DSH_CDP_DEFAULT_PORT?.trim() || '9225'
  return [normalizeEndpointBase(port)]
}

/**
 * @param {string} s port or URL
 * @returns {string}
 */
export function normalizeEndpointBase(s) {
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s.replace(/\/$/, '')
  if (/^\d+$/.test(s)) return `http://127.0.0.1:${s}`
  if (/^[\w.-]+:\d+$/.test(s)) return `http://${s}`
  return s.replace(/\/$/, '')
}

/**
 * @param {string} baseUrl
 * @returns {string}
 */
export function endpointIdFromBase(baseUrl) {
  try {
    const u = new URL(baseUrl)
    return `${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`
  } catch {
    return baseUrl
  }
}
