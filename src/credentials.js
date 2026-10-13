/**
 * Load named refs from ~/.dsh/.credentials.yaml without logging values.
 * @module
 */

import { homedir } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {string} name e.g. DEEPSEEK_API_KEY
 * @returns {string|undefined}
 */
export function readDshCredentialRef(name) {
  const homes = [
    process.env.DSH_HOME,
    join(homedir(), '.dsh'),
    join(homedir(), 'OneDrive', '.dsh'),
  ].filter(Boolean)

  for (const root of homes) {
    const file = join(root, '.credentials.yaml')
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    const value = parseRef(text, name)
    if (value) return value
  }
  return undefined
}

/**
 * @param {string} text
 * @param {string} name
 */
function parseRef(text, name) {
  const lines = text.split(/\r?\n/)
  let inRefs = false
  for (const raw of lines) {
    if (/^refs:\s*$/.test(raw)) {
      inRefs = true
      continue
    }
    if (inRefs) {
      if (/^\S/.test(raw) && !raw.startsWith('#')) {
        // next top-level key
        inRefs = false
        continue
      }
      const m = raw.match(new RegExp(`^\\s+${escapeReg(name)}:\\s*(.+?)\\s*$`))
      if (m) return unquote(m[1])
    }
    // also allow flat pre-migration layout
    const flat = raw.match(new RegExp(`^${escapeReg(name)}:\\s*(.+?)\\s*$`))
    if (flat) return unquote(flat[1])
  }
  return undefined
}

/** @param {string} v */
function unquote(v) {
  const s = v.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Put DEEPSEEK_API_KEY into process.env when stored in DSH credentials. */
export function hydrateDeepseekKeyFromDsh() {
  if (process.env.DEEPSEEK_API_KEY) return true
  const v = readDshCredentialRef('DEEPSEEK_API_KEY')
  if (!v) return false
  process.env.DEEPSEEK_API_KEY = v
  return true
}
