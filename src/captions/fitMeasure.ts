import type { Shape } from '../core/edit'
import type { Size } from '../core/composition'
import { fitShapeToText, isFittableGeometry, textBlockBounds, type FitPadding, type FitResult, type TextBlock } from '../core/fitToText'
import { createDomMeasurer, fontLoadSpec } from './CaptionPreview'
import { captionStyleInputs, type CaptionStyle } from './style'

/** Padding a fitted shape uses when it stored none. */
export const DEFAULT_FIT_PADDING: FitPadding = [24, 16]

/** Loads the title's fonts, then measures with a throwaway DOM measurer: the only place fit measuring touches the DOM. */
async function withMeasurer<T>(text: string, style: CaptionStyle, composition: Size, run: (measure: ReturnType<typeof createDomMeasurer>['measure']) => T): Promise<T> {
  const inputs = captionStyleInputs(style, composition)
  const sample = text || 'മലയാളം English'
  await Promise.all([document.fonts.load(fontLoadSpec(inputs.font), sample), ...(inputs.emphasisFont ? [document.fonts.load(fontLoadSpec(inputs.emphasisFont), sample)] : [])])
  await document.fonts.ready
  const measurer = createDomMeasurer(document)
  try { return run(measurer.measure) } finally { measurer.dispose() }
}

/** The measured text block of a title, for `template-insert`'s `measured` input. Null for blank text. */
export const measureTitleBlock = (text: string, style: CaptionStyle, composition: Size): Promise<TextBlock | null> =>
  withMeasurer(text, style, composition, (measure) => textBlockBounds(text, style, composition, measure))

/** The refitted geometry for every fittable shape in `shapes`, keyed by shape id, measured once for the new text. */
export const fitShapesToTitle = (shapes: readonly Shape[], text: string, style: CaptionStyle, composition: Size): Promise<Map<string, FitResult>> =>
  withMeasurer(text, style, composition, (measure) => {
    const fitted = new Map<string, FitResult>()
    for (const shape of shapes) {
      if (!isFittableGeometry(shape.geometry)) continue
      const result = fitShapeToText(shape, text, style, measure, shape.fitPadding ?? DEFAULT_FIT_PADDING, { composition })
      if (result) fitted.set(shape.id, result)
    }
    return fitted
  })
