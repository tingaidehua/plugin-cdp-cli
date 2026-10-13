import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEndpointBase, endpointIdFromBase } from '../src/env.js'
import { makeTargetId } from '../src/types.js'
import { LeaseManager } from '../src/lease.js'
import { mapDevtoolsTarget } from '../src/endpoint/http-attach.js'

describe('env normalize', () => {
  it('accepts port and URL', () => {
    assert.equal(normalizeEndpointBase('9225'), 'http://127.0.0.1:9225')
    assert.equal(normalizeEndpointBase('http://127.0.0.1:9224/'), 'http://127.0.0.1:9224')
    assert.equal(endpointIdFromBase('http://127.0.0.1:9225'), '127.0.0.1:9225')
  })
})

describe('target id', () => {
  it('brands endpoint:devtoolsId', () => {
    assert.equal(makeTargetId('127.0.0.1:9225', 'ABC'), '127.0.0.1:9225:ABC')
  })
})

describe('leases', () => {
  it('allows shared read and exclusive write', () => {
    const m = new LeaseManager()
    const a = m.acquire('t1', 'read', 'a')
    const b = m.acquire('t1', 'read', 'b')
    assert.equal(m.list('t1').length, 2)
    assert.throws(() => m.acquire('t1', 'write', 'c'))
    m.release(a)
    m.release(b)
    const w = m.acquire('t1', 'write', 'c')
    assert.throws(() => m.acquire('t1', 'write', 'd'))
    m.release(w)
  })
})

describe('mapDevtoolsTarget', () => {
  it('maps chrome json/list row', () => {
    const t = mapDevtoolsTarget('127.0.0.1:9225', {
      id: 'X',
      type: 'page',
      title: 'Hello',
      url: 'https://example.com',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9225/devtools/page/X',
    })
    assert.equal(t.id, '127.0.0.1:9225:X')
    assert.equal(t.wsUrl?.includes('9225'), true)
  })
})
