import { expect, it } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { appMenuTemplate } from './appMenu'
import { isMenuCommand, type MenuCommand } from '../src/core/menuCommands'

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? flatten(item.submenu) : [])])
}

it.each(['darwin', 'win32'] as const)('forwards only valid menu commands on %s', (platform) => {
  const sent: MenuCommand[] = []
  const items = flatten(appMenuTemplate(platform, (command) => sent.push(command)))
  for (const item of items) item.click?.({} as never, undefined, {} as never)
  expect(sent.length).toBeGreaterThan(0)
  expect(sent.every(isMenuCommand)).toBe(true)
  expect(new Set(sent)).toEqual(new Set(['go-home', 'new-project', 'open-video', 'import-srt', 'open-project', 'save-project', 'save-project-as', 'export-video', 'export-srt', 'undo', 'redo', 'remove-silence', 'restore-cuts', 'settings', 'shortcuts']))
  const accelerators = items.map((item) => item.accelerator).filter(Boolean)
  expect(new Set(accelerators).size).toBe(accelerators.length)
  expect(items.find((item) => item.label === 'New Project')?.accelerator).toBe('CmdOrCtrl+N')
  expect(items.find((item) => item.label === 'Save Project')?.accelerator).toBe('CmdOrCtrl+S')
  expect(items.find((item) => item.label === 'Save Project As…')?.accelerator).toBe('CmdOrCtrl+Shift+S')
  expect(items.find((item) => item.label === 'Undo')?.accelerator).toBe('CmdOrCtrl+Z')
  expect(items.find((item) => item.label === 'Redo')?.accelerator).toBe(platform === 'darwin' ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y')
  // Text-field editing keeps its native roles alongside the project-history Undo/Redo items.
  for (const role of ['cut', 'copy', 'paste', 'selectAll']) expect(items.some((item) => item.role === role)).toBe(true)
  expect(items.some((item) => item.role === 'editMenu' || item.role === 'undo' || item.role === 'redo')).toBe(false)
  // Video-level cuts live in their own menu, not inside the text-editing 'Edit' menu.
  expect(items.find((item) => item.label === 'Remove Silence…')?.click).toBeDefined()
  expect(items.find((item) => item.label === 'Restore Removed Ranges')?.click).toBeDefined()
})

it('rejects unknown menu commands', () => {
  expect(isMenuCommand('save-project')).toBe(true)
  expect(isMenuCommand('rm -rf')).toBe(false)
  expect(isMenuCommand(3)).toBe(false)
})
