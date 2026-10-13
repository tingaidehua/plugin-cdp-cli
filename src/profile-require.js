/**
 * Resolve harness packages from the Desktop/profile install, not from the
 * junctioned plugin realpath (which has no @deepseek-ai node_modules).
 * @module
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * @returns {NodeRequire}
 */
export function profileRequire() {
  const candidates = [
    process.env.DSH_PROFILE_PACKAGE && join(process.env.DSH_PROFILE_PACKAGE),
    process.env.DSH_HOME && join(process.env.DSH_HOME, 'profiles', 'desktop', 'package.json'),
    join(homedir(), '.dsh', 'profiles', 'desktop', 'package.json'),
    join(homedir(), 'OneDrive', '.dsh', 'profiles', 'desktop', 'package.json'),
    // last resort: this file (works only if peers are installed beside the plugin)
    join(import.meta.dirname, '..', '..', 'package.json'),
  ].filter(Boolean)

  for (const pkg of candidates) {
    if (!existsSync(pkg)) continue
    try {
      return createRequire(pkg)
    } catch {
      // try next
    }
  }
  return createRequire(import.meta.url)
}

/**
 * @param {string} id
 * @returns {any}
 */
export function requireFromProfile(id) {
  return profileRequire()(id)
}

/**
 * @template T
 * @param {string} id
 * @returns {T | null}
 */
export function tryRequireFromProfile(id) {
  try {
    return requireFromProfile(id)
  } catch {
    return null
  }
}
