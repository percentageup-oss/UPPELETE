// Bundled (by export-parity.mjs, via esbuild) into one flat ESM module before use. Node's own
// type-stripping loader resolves single `.ts` files with no local imports fine (as export-host.mjs
// and frameRequest.ts already show), but these modules' own extensionless relative imports (the
// project's normal style, resolved by the bundler everywhere else) are not resolvable by that raw
// loader — bundling once here sidesteps that instead of rewriting the project's import style.
export { frameRequestAt, frameSourceUs, exportFrameCountFor, exportOutputDurationUs, exportPlanSchema, exportManifestSchema } from '../src/export/plan'
export { captionTokens } from '../src/core/captionText'
export { DEFAULT_CAPTION_STYLE } from '../src/captions/style'
export { CAPTION_TEMPLATES, titleTemplateChanges } from '../src/captions/templates'
export { defaultTextOverlay } from '../src/core/textCommands'
export { decorativeTextCue, textMotionAt } from '../src/captions/textMotion'
export { frameRequestV4Schema } from '../src/export/frameRequest'
export { captionFixtures } from '../src/captions/fixtures'
export { readLocalToolConfig, resolveToolchain, LOCAL_TOOL_CONFIG_FILE } from '../electron/toolConfig'
export { bakeGrade, NEUTRAL_GRADE } from '../src/color/bake'
export { encodeLog } from '../src/color/transfer'
export { encodeCubeData } from '../src/color/cube'
