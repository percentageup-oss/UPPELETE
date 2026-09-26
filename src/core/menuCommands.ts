/** Actions the native application menu may ask the renderer to run. Validated on both sides of the bridge. */
export const MENU_COMMANDS = ['go-home', 'new-project', 'open-video', 'import-srt', 'open-project', 'save-project', 'save-project-as', 'export-srt', 'export-video', 'undo', 'redo', 'remove-silence', 'restore-cuts', 'settings', 'shortcuts'] as const
export type MenuCommand = typeof MENU_COMMANDS[number]
export const isMenuCommand = (value: unknown): value is MenuCommand => typeof value === 'string' && (MENU_COMMANDS as readonly string[]).includes(value)
