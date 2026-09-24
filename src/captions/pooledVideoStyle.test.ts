import { describe, expect, it } from 'vitest'
import { pooledVideoStyle } from './pooledVideoStyle'

describe('pooledVideoStyle', () => {
  it('always sets opacity so a previous mounter cannot leave the shared video invisible', () => {
    expect(pooledVideoStyle('contain', true).opacity).toBe(1)
    expect(pooledVideoStyle('contain', false).opacity).toBe(0)
  })
  it('maps stretch to fill and fills the slot', () => {
    expect(pooledVideoStyle('stretch', true)).toMatchObject({ objectFit: 'fill', width: '100%', height: '100%', display: 'block' })
    expect(pooledVideoStyle('cover', true).objectFit).toBe('cover')
  })
})
