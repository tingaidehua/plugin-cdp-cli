/**
 * Shared branded ids and selector contracts for the CDP fabric.
 * @module
 */

/**
 * Opaque target id: `${endpointId}:${devtoolsTargetId}`
 * @typedef {string} CdpTargetId
 */

/**
 * @param {string} endpointId
 * @param {string} targetId
 * @returns {CdpTargetId}
 */
export function makeTargetId(endpointId, targetId) {
  return `${endpointId}:${targetId}`
}

/**
 * @typedef {'http-attach' | 'sidebar-broker'} CdpEndpointKind
 */

/**
 * @typedef {'ok' | 'unreachable' | 'auth-required' | 'unknown'} CdpEndpointStatus
 */

/**
 * @typedef {object} CdpEndpointRef
 * @property {string} id
 * @property {CdpEndpointKind} kind
 * @property {string} baseUrl
 * @property {CdpEndpointStatus} status
 * @property {string} [label]
 * @property {number} [latencyMs]
 */

/**
 * @typedef {object} CdpTargetRef
 * @property {CdpTargetId} id
 * @property {string} endpointId
 * @property {string} type
 * @property {string} title
 * @property {string} url
 * @property {string} [wsUrl]
 * @property {string} [devtoolsId]
 */

/**
 * @typedef {object} CdpSelector
 * @property {number} [port]
 * @property {string} [endpointId]
 * @property {string} [urlIncludes]
 * @property {string} [titleIncludes]
 * @property {string} [targetId]
 * @property {boolean} [allowMultiple]
 */

/**
 * @typedef {object} CdpHandle
 * @property {CdpTargetRef} target
 * @property {string} [sessionId]
 * @property {import('./lease.js').Lease} [lease]
 */
