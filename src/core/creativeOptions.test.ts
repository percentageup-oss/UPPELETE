import { describe, expect, it } from 'vitest'
import { listCreativeOptions } from './creativeOptions'
import { LOOKS } from '../color/looks'
import { gradeLookSchema, zoomRegionSchema } from './edit'

describe('listCreativeOptions', () => {
  const options = listCreativeOptions()

  it('lists every look, and each id is accepted by the grade schema', () => {
    expect(options.looks.map((look) => look.id)).toEqual(LOOKS.map((look) => look.id))
    for (const look of options.looks) expect(gradeLookSchema.safeParse({ id: look.id }).success).toBe(true)
  })

  it('lists background presets and only the authored title treatments', () => {
    expect(options.backgroundPresets.length).toBeGreaterThan(5)
    expect(options.titleTreatments.map((title) => title.id)).toContain('title-focus-reveal')
    expect(options.titleTreatments.every((title) => title.id.startsWith('title-'))).toBe(true)
  })

  it('generates JSON schemas from the real zod schemas and survives serialization', () => {
    const zoom = options.schemas.zoomRegion as { properties?: Record<string, unknown> }
    expect(zoom.properties).toHaveProperty('rect')
    expect(zoom.properties).toHaveProperty('easeInUs')
    expect(zoomRegionSchema.safeParse({ id: 'z', startUs: 0, endUs: 1, rect: { x: 0, y: 0, width: 1, height: 1 } }).success).toBe(true)
    expect(() => JSON.stringify(options)).not.toThrow()
  })
})
