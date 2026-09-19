import type { CaptionProject } from '../core/model'
import type { CaptionStyle, SavedCaptionPreset } from './style'

/** Pure project-level operations so saving/applying/deleting a preset is one undoable command. */
export function saveCaptionPreset(project: CaptionProject, name: string, style: CaptionStyle, newId: () => string): CaptionProject {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Preset name is required.')
  const preset: SavedCaptionPreset = { id: newId(), name: trimmed, style }
  return { ...project, savedCaptionPresets: [...(project.savedCaptionPresets ?? []), preset] }
}

export function applyCaptionPreset(project: CaptionProject, presetId: string): CaptionProject {
  const preset = project.savedCaptionPresets?.find((entry) => entry.id === presetId)
  if (!preset) throw new Error('Preset not found.')
  return { ...project, captionStyle: preset.style }
}

export function deleteCaptionPreset(project: CaptionProject, presetId: string): CaptionProject {
  if (!project.savedCaptionPresets?.some((entry) => entry.id === presetId)) throw new Error('Preset not found.')
  return { ...project, savedCaptionPresets: project.savedCaptionPresets.filter((entry) => entry.id !== presetId) }
}

export function setCaptionStyle(project: CaptionProject, style: CaptionStyle): CaptionProject {
  return { ...project, captionStyle: style }
}
