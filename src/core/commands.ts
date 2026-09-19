import { applyCaptionCommand, type CaptionCommand, type CommandContext, type CommandResult } from './captionCommands'
import { applyItemCommand, ITEM_COMMAND_TYPES, type ItemCommand } from './itemCommands'

/**
 * Every editing action in the app, caption or item. One entry point means `App.tsx` keeps a single
 * `runCommand`, and `history.ts`'s whole-project snapshots give item edits the same undo/redo
 * captions already have, with no second history (docs/EDITING.md).
 */
export type EditCommand = CaptionCommand | ItemCommand

export function isItemCommand(command: EditCommand): command is ItemCommand {
  return ITEM_COMMAND_TYPES.has(command.type as ItemCommand['type'])
}

export function applyEditCommand(project: Parameters<typeof applyCaptionCommand>[0], command: EditCommand, context: CommandContext = {}): CommandResult {
  return isItemCommand(command) ? applyItemCommand(project, command, context) : applyCaptionCommand(project, command, context)
}

export type { CaptionCommand, CommandContext, CommandResult, ItemCommand }
