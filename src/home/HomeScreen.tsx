import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RecentProjectView } from '../../electron/projectLibrary'
import { ContextMenu } from '../ContextMenu'
import type { MenuEntry } from '../MenuButton'
import { SettingsIcon } from '../RailIcons'
import { ResolveStatusPill } from '../resolve/ResolveStatusPill'
import brandIcon from '../assets/brand/icon-dark.png'
import { FilmIcon, FolderOpenIcon, HomeIcon, MoreIcon, PlusIcon, SearchIcon, TemplatesIcon } from './HomeIcons'
import { durationLabel, relativeTime } from './homeFormat'

type HomeTab = 'home' | 'templates'
type Sort = 'recent' | 'name'
type Menu = { x: number; y: number; project: RecentProjectView }
type Action = Parameters<NonNullable<Window['captionStudio']>['recentProjectAction']>[0]

const TABS: { id: HomeTab; label: string; icon: React.ReactNode }[] = [
  { id: 'home', label: 'Home', icon: <HomeIcon /> },
  { id: 'templates', label: 'Templates', icon: <TemplatesIcon /> },
]

const fileName = (filePath: string) => filePath.split(/[\\/]/).pop() ?? filePath
const lastTouched = (project: RecentProjectView) => Math.max(project.savedAt, project.openedAt)
const trashName = () => navigator.platform.startsWith('Mac') ? 'Trash' : 'Recycle Bin'

/** The start page: sidebar (Home / Templates), a Create-project banner and the projects saved so far. */
export function HomeScreen({ onCreate, onOpenFile, onOpenRecent, onSettings, onMessage, resolve }: {
  onCreate: () => void
  onOpenFile: () => void
  onOpenRecent: (path: string) => void
  onSettings: () => void
  onMessage: (tone: 'info' | 'warning' | 'error', text: string) => void
  /** DaVinci Resolve connection (briefs 04 and 11): shown only while connected. Import rebuilds the cuts from the
   * original files; Render makes one proxy video of the whole timeline. */
  resolve?: { connected: boolean; timelineName?: string; busy: boolean; onImport: () => void; onRender: () => void }
}) {
  const [tab, setTab] = useState<HomeTab>('home')
  const [projects, setProjects] = useState<RecentProjectView[] | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [trashing, setTrashing] = useState<RecentProjectView | null>(null)

  // The parent re-renders often; keep `refresh` stable so the list is fetched once per visit, not once per render.
  const messageRef = useRef(onMessage)
  messageRef.current = onMessage
  const refresh = useCallback(async () => {
    try { setProjects(await window.captionStudio?.listRecentProjects() ?? []) }
    catch (error) { setProjects([]); messageRef.current('error', error instanceof Error ? error.message : String(error)) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const run = async (request: Action, done?: string) => {
    try {
      const result = await window.captionStudio?.recentProjectAction(request)
      if (result && !result.ok) onMessage('error', result.message)
      else if (done) onMessage('info', done)
    } catch (error) { onMessage('error', error instanceof Error ? error.message : String(error)) }
    await refresh()
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matched = (projects ?? []).filter((project) => !needle || project.title.toLowerCase().includes(needle))
    return matched.sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title) : lastTouched(b) - lastTouched(a))
  }, [projects, query, sort])

  const entriesFor = (project: RecentProjectView): MenuEntry[] => {
    const missing = project.exists ? null : 'The file is missing'
    return [
      { id: 'open', label: 'Open', onSelect: () => onOpenRecent(project.path), disabledReason: missing },
      { id: 'rename', label: 'Rename', onSelect: () => setRenaming(project.path), disabledReason: missing },
      { id: 'show', label: 'Show in folder', onSelect: () => void run({ action: 'show', path: project.path }), disabledReason: missing },
      { id: 'sep', separator: true },
      { id: 'remove', label: 'Remove from list', onSelect: () => void run({ action: 'remove', path: project.path }) },
      { id: 'trash', label: 'Delete…', onSelect: () => setTrashing(project), disabledReason: missing },
    ]
  }

  return <div className="home">
    <nav className="home-sidebar" aria-label="Home">
      <div className="home-brand"><img src={brandIcon} alt="" aria-hidden="true" draggable={false} /><strong>Katha<span>Cut</span></strong></div>
      <div role="tablist" aria-orientation="vertical" aria-label="Home sections" onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
        const next = TABS[(TABS.findIndex((entry) => entry.id === tab) + (event.key === 'ArrowDown' ? 1 : -1) + TABS.length) % TABS.length].id
        setTab(next)
        document.getElementById(`home-tab-${next}`)?.focus()
      }}>
        {TABS.map((entry) => <button key={entry.id} id={`home-tab-${entry.id}`} role="tab" type="button" className={`home-tab${tab === entry.id ? ' active' : ''}`}
          aria-selected={tab === entry.id} aria-controls={`home-panel-${entry.id}`} tabIndex={tab === entry.id ? 0 : -1} onClick={() => setTab(entry.id)}>
          {entry.icon}<span>{entry.label}</span>
        </button>)}
      </div>
      <button type="button" className="home-tab home-settings" onClick={onSettings}><SettingsIcon /><span>Settings</span></button>
    </nav>

    {tab === 'templates' ? <section className="home-main" id="home-panel-templates" role="tabpanel" aria-labelledby="home-tab-templates">
      <div className="home-soon"><TemplatesIcon width={40} height={40} /><h1>Templates are coming soon</h1>
        <p>Ready-made project starts will live here. For now, create a project and pick caption and title styles from the editor.</p></div>
    </section> : <section className="home-main" id="home-panel-home" role="tabpanel" aria-labelledby="home-tab-home">
      <button type="button" className="home-create" onClick={onCreate}>
        <span className="home-create-plus"><PlusIcon width={22} height={22} /></span><span>Create project</span>
      </button>
      {resolve?.connected && <div className="home-resolve-actions">
        <button type="button" className="home-create-resolve" disabled={resolve.busy} onClick={resolve.onImport}>
          <FilmIcon width={18} height={18} />
          <span>Import DaVinci timeline{resolve.timelineName ? ` — “${resolve.timelineName}”` : ''}</span>
        </button>
        <button type="button" className="home-resolve-render" disabled={resolve.busy} onClick={resolve.onRender}
          title="Render the whole timeline to one video instead. Slower, but works for retimed, multicam and Fusion clips.">Render instead</button>
      </div>}
      <div className="home-actions"><button type="button" onClick={onOpenFile}><FolderOpenIcon />Open project…</button><ResolveStatusPill onMessage={onMessage} /></div>

      <div className="home-projects-head">
        <h2>Projects</h2>
        <label className="home-search"><SearchIcon /><input type="search" placeholder="Search projects" aria-label="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select aria-label="Sort projects" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          <option value="recent">Last edited</option><option value="name">Name</option>
        </select>
      </div>

      {projects === null ? null : projects.length === 0
        ? <div className="home-empty"><FilmIcon width={36} height={36} /><p>Projects you create are saved automatically. Start creating your own videos.</p></div>
        : visible.length === 0 ? <div className="home-empty"><p>No projects match “{query}”.</p></div>
        : <ul className="home-grid">
          {visible.map((project) => <li key={project.path} className={`home-card${project.exists ? '' : ' missing'}`} onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, project }) }}>
            <button type="button" className="home-card-open" disabled={!project.exists} title={project.exists ? project.path : `${project.path} is missing`} onClick={() => onOpenRecent(project.path)}>
              <span className="home-thumb">{project.thumbnail ? <img src={project.thumbnail} alt="" draggable={false} /> : <FilmIcon width={30} height={30} />}
                <span className="home-duration">{durationLabel(project.durationUs)}</span>
                {!project.exists && <span className="home-missing">File missing</span>}</span>
            </button>
            <div className="home-card-meta">
              {renaming === project.path
                ? <RenameField initial={project.title} onCancel={() => setRenaming(null)} onCommit={(title) => { setRenaming(null); if (title !== project.title) void run({ action: 'rename', path: project.path, title }) }} />
                : <strong title={project.title} lang="ml">{project.title}</strong>}
              <small>{relativeTime(lastTouched(project))} · {fileName(project.path)}</small>
            </div>
            <button type="button" className="home-card-more icon-button" aria-label={`Actions for ${project.title}`} aria-haspopup="menu"
              onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setMenu({ x: box.left, y: box.bottom + 4, project }) }}><MoreIcon /></button>
          </li>)}
        </ul>}
    </section>}

    {menu && <ContextMenu x={menu.x} y={menu.y} entries={entriesFor(menu.project)} label="Project actions" onClose={() => setMenu(null)} />}
    {trashing && <div className="relink-backdrop"><section className="relink-review" role="dialog" aria-modal="true" aria-labelledby="trash-project-title">
      <small>DELETE PROJECT</small><h2 id="trash-project-title">Move “{trashing.title}” to the {trashName()}?</h2>
      <p>Only the project file ({fileName(trashing.path)}) is moved. Your video and other media files are not touched.</p>
      <div><button onClick={() => setTrashing(null)}>Cancel</button>
        <button className="accent" onClick={() => { const target = trashing; setTrashing(null); void run({ action: 'trash', path: target.path }, `Moved ${fileName(target.path)} to the ${trashName()}.`) }}>Delete</button></div>
    </section></div>}
  </div>
}

function RenameField({ initial, onCommit, onCancel }: { initial: string; onCommit: (title: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => { input.current?.select() }, [])
  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    if (commit && value.trim()) onCommit(value.trim()); else onCancel()
  }
  return <input ref={input} className="home-rename" aria-label="Project name" value={value} autoFocus lang="ml" maxLength={120}
    onChange={(event) => setValue(event.target.value)} onBlur={() => finish(true)}
    onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') finish(true); else if (event.key === 'Escape') finish(false) }} />
}
