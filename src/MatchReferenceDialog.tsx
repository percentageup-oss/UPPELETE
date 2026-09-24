import { useEffect, useMemo, useRef, useState } from 'react'
import { writeCube } from './color/cube'
import { gradePixels } from './color/lookThumbnail'
import { bakeMatch, deriveMatch, type PixelImage } from './color/referenceMatch'

/** A canvas showing `pixels` (RGBA) at its own size, scaled by CSS. */
function PixelCanvas({ pixels, width, height, label }: { pixels: Uint8ClampedArray | ArrayLike<number>; width: number; height: number; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    const image = context.createImageData(width, height)
    image.data.set(pixels as ArrayLike<number> as Uint8ClampedArray)
    context.putImageData(image, 0, 0)
  }, [pixels, width, height])
  return <figure className="match-shot"><canvas ref={canvas} width={width} height={height} aria-label={label} /><figcaption>{label}</figcaption></figure>
}

/**
 * "Match reference image": shows the current frame before and after a grade derived from a reference
 * still (`color/referenceMatch.ts`), with a strength slider, and saves the result as a `.cube` that
 * joins My LUTs. It is a statistical color/tone transfer — it matches the reference's distribution,
 * not its content — so results vary with how alike the two pictures are; the slider is there for that.
 */
export function MatchReferenceDialog({ source, reference, referenceName, onSave, onClose }: {
  source: PixelImage
  reference: PixelImage
  referenceName: string
  onSave(request: { text: string; name: string }): Promise<void>
  onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [strength, setStrength] = useState(100)
  const [name, setName] = useState(`Match – ${referenceName.replace(/\.[^.]+$/, '')}`)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => { const element = dialog.current; if (element && !element.open) element.showModal() }, [])

  const model = useMemo(() => {
    try { return deriveMatch(source, reference) } catch (error) { setFailure(error instanceof Error ? error.message : 'The match could not be computed.'); return null }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setFailure is stable; derive once per pair of images
  }, [source, reference])
  const graded = useMemo(() => (model ? gradePixels(source, bakeMatch(model, strength / 100, 17)) : null), [model, source, strength])

  const save = async () => {
    if (!model || saving) return
    setSaving(true)
    try { await onSave({ text: writeCube(bakeMatch(model, strength / 100, 33, name.trim() || 'Reference match')), name: name.trim() || 'Reference match' }) }
    finally { setSaving(false) }
  }

  return <dialog ref={dialog} className="model-dialog export-dialog match-dialog" aria-labelledby="match-reference-title" onClose={onClose} onKeyDown={(event) => event.stopPropagation()}>
    <div className="model-panel-heading"><h2 id="match-reference-title">Match reference image</h2><button onClick={onClose}>Close</button></div>
    <p>Moves the current frame’s tone and color toward <strong>{referenceName}</strong>, then saves the grade as a .cube LUT you can use like any other.</p>
    <div className="match-shots">
      <PixelCanvas pixels={source.data} width={source.width} height={source.height} label="Current frame" />
      {graded && <PixelCanvas pixels={graded} width={source.width} height={source.height} label="Matched" />}
      <PixelCanvas pixels={reference.data} width={reference.width} height={reference.height} label="Reference" />
    </div>
    <label className="match-field">Strength <input type="range" min={0} max={100} value={strength} onChange={(event) => setStrength(Number(event.target.value))} /> <output>{strength}%</output></label>
    <label className="match-field">Name <input type="text" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></label>
    {failure && <p className="export-summary" role="alert">{failure}</p>}
    <div className="export-footer">
      <p className="export-summary" role="status">A statistical match: best when both pictures are alike in subject and lighting.</p>
      <button onClick={onClose}>Cancel</button>
      <button className="accent" onClick={() => void save()} disabled={!model || saving}>{saving ? 'Saving…' : 'Save LUT…'}</button>
    </div>
  </dialog>
}
