import type { DrawerDragState } from './useEdgeDragDrawers'

interface MobileDrawerControlsProps {
  drawers: DrawerDragState
  playing: boolean
  canPlay: boolean
  onTogglePlay: () => void
  onSeekBy: (us: number) => void
  hasSelection: boolean
  onSplit?: () => void
  onDelete?: () => void
  onAddCue?: () => void
  canSplit?: boolean
  canDelete?: boolean
  canAddCue?: boolean
  hasPastUndo: boolean
  hasFutureRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

export function MobileDrawerControls({
  drawers,
  playing,
  canPlay,
  onTogglePlay,
  onSeekBy,
  hasSelection,
  onSplit,
  onDelete,
  onAddCue,
  canSplit,
  canDelete,
  canAddCue,
  hasPastUndo,
  hasFutureRedo,
  onUndo,
  onRedo,
}: MobileDrawerControlsProps) {
  const {
    activeDrawer,
    isDragging,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    handleEdgePointerDown,
    isMobile,
  } = drawers

  if (!isMobile) return null

  return (
    <>
      {/* Backdrop for open drawers */}
      {activeDrawer !== null && (
        <div
          className="mobile-drawer-backdrop"
          onClick={closeDrawer}
          role="presentation"
          aria-hidden="true"
        />
      )}

      {/* Left Edge Trigger & Visible Handle Tab */}
      <div
        className={`edge-trigger edge-trigger-left ${activeDrawer === 'left' ? 'open' : ''}`}
        onPointerDown={(e) => handleEdgePointerDown('left', e)}
        style={{ touchAction: 'none' }}
      >
        <button
          type="button"
          className="edge-tab edge-tab-left"
          aria-label="Open Tools Drawer"
          onClick={() => toggleDrawer('left')}
        >
          <span className="edge-tab-icon">☰</span>
          <span className="edge-tab-label">TOOLS</span>
        </button>
      </div>

      {/* Right Edge Trigger & Visible Handle Tab */}
      <div
        className={`edge-trigger edge-trigger-right ${activeDrawer === 'right' ? 'open' : ''}`}
        onPointerDown={(e) => handleEdgePointerDown('right', e)}
        style={{ touchAction: 'none' }}
      >
        <button
          type="button"
          className="edge-tab edge-tab-right"
          aria-label="Open Inspector Drawer"
          onClick={() => toggleDrawer('right')}
        >
          <span className="edge-tab-icon">⚙</span>
          <span className="edge-tab-label">INSPECT</span>
        </button>
      </div>

      {/* Bottom Edge Trigger & Visible Handle Tab */}
      <div
        className={`edge-trigger edge-trigger-bottom ${activeDrawer === 'bottom' ? 'open' : ''}`}
        onPointerDown={(e) => handleEdgePointerDown('bottom', e)}
        style={{ touchAction: 'none' }}
      >
        <button
          type="button"
          className="edge-tab edge-tab-bottom"
          aria-label="Open Timeline Drawer"
          onClick={() => toggleDrawer('bottom')}
        >
          <span className="edge-tab-icon">⏱</span>
          <span className="edge-tab-label">TIMELINE</span>
        </button>
      </div>

      {/* On-Canvas Floating HUD Controls */}
      {activeDrawer === null && !isDragging && (
        <nav className="canvas-hud" aria-label="Mobile Controls">
          {/* Quick Undo/Redo & Selection Tools Row (if selected or actions available) */}
          <div className="canvas-hud-top-row">
            <button
              type="button"
              className="hud-btn hud-btn-sm"
              disabled={!hasPastUndo}
              onClick={onUndo}
              title="Undo"
              aria-label="Undo"
            >
              ↩
            </button>
            <button
              type="button"
              className="hud-btn hud-btn-sm"
              disabled={!hasFutureRedo}
              onClick={onRedo}
              title="Redo"
              aria-label="Redo"
            >
              ↪
            </button>

            {canAddCue && onAddCue && (
              <button
                type="button"
                className="hud-btn hud-btn-action"
                onClick={onAddCue}
                aria-label="Add Caption at Playhead"
              >
                + Cue
              </button>
            )}

            {canSplit && onSplit && (
              <button
                type="button"
                className="hud-btn hud-btn-action"
                onClick={onSplit}
                aria-label="Split at Playhead"
              >
                ✂ Split
              </button>
            )}

            {canDelete && onDelete && (
              <button
                type="button"
                className="hud-btn hud-btn-danger"
                onClick={onDelete}
                aria-label="Delete Selected"
              >
                🗑
              </button>
            )}
          </div>

          {/* Primary Bottom HUD Bar: Drawers & Playback */}
          <div className="canvas-hud-bar">
            <button
              type="button"
              className="hud-drawer-btn"
              onClick={() => openDrawer('left')}
              aria-label="Open Tools (Media, Captions, Effects)"
            >
              <span className="hud-icon">☰</span>
              <span className="hud-label">Tools</span>
            </button>

            <div className="hud-transport">
              <button
                type="button"
                className="hud-btn hud-btn-transport"
                onClick={() => onSeekBy(-1000000)}
                aria-label="Seek Backward 1 Second"
              >
                −1s
              </button>
              <button
                type="button"
                className={`hud-play-btn ${playing ? 'playing' : ''}`}
                disabled={!canPlay}
                onClick={onTogglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <button
                type="button"
                className="hud-btn hud-btn-transport"
                onClick={() => onSeekBy(1000000)}
                aria-label="Seek Forward 1 Second"
              >
                +1s
              </button>
            </div>

            <button
              type="button"
              className="hud-drawer-btn"
              onClick={() => openDrawer('bottom')}
              aria-label="Open Timeline Tracks"
            >
              <span className="hud-icon">⏱</span>
              <span className="hud-label">Timeline</span>
            </button>

            <button
              type="button"
              className="hud-drawer-btn"
              onClick={() => openDrawer('right')}
              aria-label="Open Inspector & Properties"
            >
              <span className="hud-icon">⚙</span>
              <span className="hud-label">Inspect</span>
            </button>
          </div>
        </nav>
      )}
    </>
  )
}
