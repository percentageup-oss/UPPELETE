import { describe, expect, it } from 'vitest'
import { LOOKS } from './looks'
import { gradePixels, lookCube, sampleScene } from './lookThumbnail'

describe('look thumbnails', () => {
  const scene = sampleScene(32, 18)

  it('draws an opaque scene of the requested size', () => {
    expect(scene.data.length).toBe(32 * 18 * 4)
    for (let i = 3; i < scene.data.length; i += 4) expect(scene.data[i]).toBe(255)
  })

  it('every bundled look yields a different picture of the same scene', () => {
    const sums = new Set(LOOKS.map((look) => Array.from(gradePixels(scene, lookCube(look.id))).join(',')))
    expect(sums.size).toBe(LOOKS.length)
  })

  it('caches one lattice per look', () => {
    expect(lookCube(LOOKS[0].id)).toBe(lookCube(LOOKS[0].id))
  })
})
