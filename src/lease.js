/**
 * Shared-read / exclusive-write leases for CDP targets.
 * @module
 */

/**
 * @typedef {object} Lease
 * @property {string} id
 * @property {string} targetId
 * @property {'read' | 'write'} mode
 * @property {string} owner
 * @property {number} acquiredAt
 */

export class LeaseManager {
  /** @type {Map<string, Lease[]>} targetId → leases */
  #byTarget = new Map()
  #seq = 0

  /**
   * @param {string} targetId
   * @param {'read' | 'write'} mode
   * @param {string} owner
   * @returns {Lease}
   */
  acquire(targetId, mode, owner) {
    const existing = this.#byTarget.get(targetId) || []
    if (mode === 'write') {
      if (existing.length > 0) {
        const holders = existing.map(l => `${l.mode}:${l.owner}`).join(',')
        throw new Error(`cdp lease: target ${targetId} busy (${holders}); write requires exclusive access`)
      }
    } else {
      const writer = existing.find(l => l.mode === 'write')
      if (writer) {
        throw new Error(`cdp lease: target ${targetId} locked for write by ${writer.owner}`)
      }
    }
    /** @type {Lease} */
    const lease = {
      id: `lease-${++this.#seq}`,
      targetId,
      mode,
      owner,
      acquiredAt: Date.now(),
    }
    existing.push(lease)
    this.#byTarget.set(targetId, existing)
    return lease
  }

  /**
   * @param {Lease} lease
   */
  release(lease) {
    const list = this.#byTarget.get(lease.targetId)
    if (!list) return
    const next = list.filter(l => l.id !== lease.id)
    if (next.length === 0) this.#byTarget.delete(lease.targetId)
    else this.#byTarget.set(lease.targetId, next)
  }

  /**
   * @param {string} targetId
   * @returns {Lease[]}
   */
  list(targetId) {
    return [...(this.#byTarget.get(targetId) || [])]
  }
}
