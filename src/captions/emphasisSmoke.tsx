// Test-only editor surface using production commands, controls and renderer.
import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TemplatesPanel } from '../TemplatesPanel'
import { StylePanel } from '../StylePanel'
import { WordEmphasisPanel } from '../WordEmphasisPanel'
import { CaptionPreview } from './CaptionPreview'
import { captionStyleInputs, DEFAULT_CAPTION_STYLE, type CaptionStyle } from './style'
import { createProject, cueSchema } from '../core/model'
import { applyCaptionCommand, type CaptionCommand } from '../core/captionCommands'
import { commitHistory, createHistory, undoHistory, redoHistory } from '../core/history'
import { applyCaptionPreset, deleteCaptionPreset, saveCaptionPreset } from './presets'
import '../styles.css'

const composition = { width: 1080, height: 1080 }
const initial = { ...createProject(), cues: [cueSchema.parse({ id: 'sample', text: 'മലയാളം quick brown fox jumps', startUs: 0, endUs: 3_000_000 })] }
function Demo() {
  const [history, setHistory] = useState(() => createHistory(initial))
  const [timestamp, setTimestamp] = useState(1_250_000)
  const project = history.present, cue = project.cues[0], style = project.captionStyle ?? DEFAULT_CAPTION_STYLE
  const inputs = useMemo(() => captionStyleInputs(style, composition), [style])
  const commitStyle = (captionStyle: CaptionStyle) => setHistory((current) => commitHistory(current, { ...current.present, captionStyle }))
  const command = (command: CaptionCommand) => setHistory((current) => {
    const result = applyCaptionCommand(current.present, command)
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    return commitHistory(current, result.project)
  })
  return <main style={{ padding: 24, display: 'grid', gridTemplateColumns: '310px 480px 330px', gap: 24, alignItems: 'start' }}>
    <div><TemplatesPanel style={style} cues={project.cues} activeCue={cue} presets={project.savedCaptionPresets ?? []}
      onApplyTemplate={commitStyle} onCommitMotion={(motion) => commitStyle({ ...style, motion })}
      onSavePreset={(name) => setHistory((h) => commitHistory(h, saveCaptionPreset(h.present, name, style, () => crypto.randomUUID())))}
      onApplyPreset={(id) => setHistory((h) => commitHistory(h, applyCaptionPreset(h.present, id)))}
      onDeletePreset={(id) => setHistory((h) => commitHistory(h, deleteCaptionPreset(h.present, id)))} /></div>
    <div><h2>Caption preview</h2><p className="style-hint">Synthetic mixed-language fixture · no audio alignment claimed</p>
      <div data-emphasis-preview style={{ position: 'relative', width: 480, height: 480, background: 'linear-gradient(145deg, #444a37, #171c1a)' }}>
        <CaptionPreview cue={cue} composition={composition} timestampUs={timestamp} inputs={inputs} motion={style.motion} />
      </div>
      <label>Source microseconds<input id="demo-time" type="number" value={timestamp} onChange={(event) => setTimestamp(Number(event.target.value))} /></label>
      <button id="demo-undo" onClick={() => setHistory(undoHistory)}>Undo</button><button id="demo-redo" onClick={() => setHistory(redoHistory)}>Redo</button>
      <pre id="demo-state" style={{ display: 'none' }}>{JSON.stringify(project)}</pre>
    </div>
    <div><WordEmphasisPanel cue={cue} onToggle={(textStart) => command({ type: 'toggle-emphasis', cueId: cue.id, textStart })}
      onEstimate={() => command({ type: 'estimate-words', cueId: cue.id, idPrefix: 'demo-estimate' })} />
      <StylePanel style={style} onDraft={commitStyle} onCommit={commitStyle} /></div>
  </main>
}
createRoot(document.getElementById('root')!).render(<Demo />)
