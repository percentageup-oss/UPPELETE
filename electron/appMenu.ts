import type { MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../src/core/menuCommands'

/**
 * Native application menu. File and Edit actions are forwarded to the focused window as validated `menu:command`
 * events, so the renderer keeps ownership of dialogs and project state. Menu accelerators own ⌘/Ctrl+O/S/Z (they
 * work while typing); the renderer deliberately has no keydown handler for them, so each fires exactly once.
 * Undo/Redo reach the renderer even while a text field is focused; it delegates to the field's own edit history
 * in that case (`edit:text`) and to project history otherwise.
 */
export function appMenuTemplate(platform: NodeJS.Platform, send: (command: MenuCommand) => void): MenuItemConstructorOptions[] {
  const item = (label: string, command: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({ label, accelerator, click: () => send(command) })
  const mac = platform === 'darwin'
  return [
    ...(mac ? [{ role: 'appMenu' as const, submenu: [
      { role: 'about' as const }, { type: 'separator' as const },
      item('Settings…', 'settings', 'CmdOrCtrl+,'), { type: 'separator' as const },
      { role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const }, { type: 'separator' as const }, { role: 'quit' as const },
    ] }] : []),
    { label: 'File', submenu: [
      item('Open Video…', 'open-video', 'CmdOrCtrl+Shift+O'),
      item('Import SRT…', 'import-srt', 'CmdOrCtrl+I'),
      { type: 'separator' },
      item('Open Project…', 'open-project', 'CmdOrCtrl+O'),
      item('Save Project', 'save-project', 'CmdOrCtrl+S'),
      item('Save Project As…', 'save-project-as', 'CmdOrCtrl+Shift+S'),
      { type: 'separator' },
      item('Export Video…', 'export-video', 'CmdOrCtrl+E'),
      item('Export SRT…', 'export-srt', 'CmdOrCtrl+Shift+E'),
      ...(mac ? [] : [{ type: 'separator' as const }, item('Settings…', 'settings', 'CmdOrCtrl+,'), { type: 'separator' as const }, { role: 'quit' as const }]),
    ] },
    { label: 'Edit', submenu: [
      item('Undo', 'undo', 'CmdOrCtrl+Z'),
      // Windows/Linux convention is Ctrl+Y; Ctrl+Shift+Z still works there through the renderer's keydown shortcuts.
      item('Redo', 'redo', mac ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y'),
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
      ...(mac ? [{ role: 'pasteAndMatchStyle' as const }] : []),
      { role: 'delete' }, { role: 'selectAll' },
    ] },
    // Video-level edits (cuts, and later trim/overlays/blur — docs/EDITING.md) live in their own
    // menu rather than inside 'Edit', which OS convention reserves for text/clipboard actions.
    { label: 'Timeline', submenu: [
      item('Remove Silence…', 'remove-silence'),
      item('Restore Removed Ranges', 'restore-cuts'),
    ] },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [item('Keyboard Shortcuts', 'shortcuts')] },
  ]
}
