import { describe, expect, it } from 'vitest'
import { textAnchorAt } from './textPlacement'

describe('textAnchorAt', () => {
  const bounds = { left: 100, top: 50, width: 400, height: 800 }
  it('maps preview clicks into normalized composition placement', () => {
    expect(textAnchorAt(300, 450, bounds)).toEqual({ horizontal: .5, vertical: .5 })
  })
  it('clamps clicks to the composition edges', () => {
    expect(textAnchorAt(0, 900, bounds)).toEqual({ horizontal: 0, vertical: 1 })
  })
  it('rejects an unmeasured frame', () => {
    expect(textAnchorAt(0, 0, { ...bounds, width: 0 })).toBeNull()
  })
})
