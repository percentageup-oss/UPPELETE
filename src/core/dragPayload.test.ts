import { afterEach, describe, expect, it } from 'vitest'
import { ASSET_DRAG_TYPE, PRESET_DRAG_TYPE, clearDragPayload, dropContent, getDragPayload, setDragPayload, type AssetDragPayload, type PresetDragPayload } from './dragPayload'

const payload: AssetDragPayload = { source: 'bin', assetId: 'asset-1', kind: 'image', name: 'logo.png', durationUs: null }
const presetPayload: PresetDragPayload = { source: 'preset', preset: 'zoom-in' }

function fakeDataTransfer(types: string[], data: Record<string, string> = {}, files: File[] = []): DataTransfer {
  return {
    types,
    files: files as unknown as FileList,
    getData: (type: string) => data[type] ?? '',
  } as unknown as DataTransfer
}

describe('drag payload store', () => {
  afterEach(() => clearDragPayload())

  it('round-trips through set/get/clear', () => {
    expect(getDragPayload()).toBeNull()
    setDragPayload(payload)
    expect(getDragPayload()).toEqual(payload)
    clearDragPayload()
    expect(getDragPayload()).toBeNull()
  })
})

describe('dropContent', () => {
  afterEach(() => clearDragPayload())

  it('returns null for an empty data transfer', () => {
    expect(dropContent(null)).toBeNull()
    expect(dropContent(fakeDataTransfer([]))).toBeNull()
  })

  it('reads the live payload during dragover, when getData is unavailable', () => {
    setDragPayload(payload)
    expect(dropContent(fakeDataTransfer([ASSET_DRAG_TYPE]))).toEqual({ kind: 'asset', payload })
  })

  it('falls back to getData for an out-of-window asset drag', () => {
    expect(dropContent(fakeDataTransfer([ASSET_DRAG_TYPE], { [ASSET_DRAG_TYPE]: JSON.stringify(payload) }))).toEqual({ kind: 'asset', payload })
  })

  it('recognizes an OS file drag', () => {
    const file = new File(['x'], 'clip.mp4')
    expect(dropContent(fakeDataTransfer(['Files'], {}, [file]))).toEqual({ kind: 'files', files: [file] })
  })

  it('recognizes a file drag during dragover, before dataTransfer.files is populated', () => {
    expect(dropContent(fakeDataTransfer(['Files']))).toEqual({ kind: 'files', files: [] })
  })

  it('reads the live payload for a preset drag (Zoom panel), during dragover', () => {
    setDragPayload(presetPayload)
    expect(dropContent(fakeDataTransfer([PRESET_DRAG_TYPE]))).toEqual({ kind: 'preset', payload: presetPayload })
  })

  it('falls back to getData for an out-of-window preset drag', () => {
    expect(dropContent(fakeDataTransfer([PRESET_DRAG_TYPE], { [PRESET_DRAG_TYPE]: JSON.stringify(presetPayload) }))).toEqual({ kind: 'preset', payload: presetPayload })
  })
})
