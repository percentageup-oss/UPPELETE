import { describe, expect, it } from 'vitest'
import { imagesHostPainted } from './hostPainted'
import type { Clip, Track } from './edit'

const tracks = ['V1', 'V2', 'V3'].map((id) => ({ id, kind: 'video', name: id }) as unknown as Track)
const video = (trackId: string) => ({ kind: 'video', id: `v-${trackId}`, trackId }) as unknown as Clip
const image = (trackId: string, extra: Record<string, unknown> = {}) => ({ kind: 'image', id: `i-${trackId}`, trackId, ...extra }) as unknown as Clip

describe('imagesHostPainted', () => {
  it('holds when every image sits above every video and nothing grades or blends it', () => {
    expect(imagesHostPainted([video('V1'), image('V2'), image('V3', { blendMode: 'normal' })], tracks, { adjustments: false })).toBe(true)
    expect(imagesHostPainted([video('V1')], tracks, { adjustments: false })).toBe(true)
  })

  it('fails for an image under a video, when an adjustment layer exists, or when an image blends', () => {
    expect(imagesHostPainted([video('V2'), image('V1')], tracks, { adjustments: false })).toBe(false)
    expect(imagesHostPainted([video('V1'), image('V2')], tracks, { adjustments: true })).toBe(false)
    expect(imagesHostPainted([video('V1'), image('V2', { blendMode: 'screen' })], tracks, { adjustments: false })).toBe(false)
  })
})
