import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { candidatePaths, portableMediaReference, projectForSave } from './projectMedia'
import type { CaptionProject } from '../src/core/model'
import { mediaReferenceSchema } from '../src/core/media'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

const project = (absolutePath: string): CaptionProject => ({
  schemaVersion: 11,
  tracks: [],
  clips: [],
  assets: [{ id: 'video', kind: 'video', name: path.basename(absolutePath), reference: { relativePath: null, absolutePath }, fingerprint: null, metadata: null }],
  captionTracks: [], blurRegions: [], zoomRegions: [], effects: [], textOverlays: [], markers: [],
  id: 'project',
  title: 'Paths',
  cues: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('portable project media paths', () => {
  it('stores and resolves a safe relative Unicode path inside the project folder', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'caption project space-'))
    directories.push(directory)
    const mediaDirectory = path.join(directory, 'മീഡിയ files')
    await mkdir(mediaDirectory)
    const mediaPath = path.join(mediaDirectory, 'എന്റെ clip.mp4')
    await writeFile(mediaPath, 'fixture')
    const projectPath = path.join(directory, 'എന്റെ project.cstudio')
    const saved = projectForSave(project(mediaPath), projectPath)
    expect(saved.assets[0].reference).toEqual({ relativePath: 'മീഡിയ files/എന്റെ clip.mp4', absolutePath: mediaPath })
    expect(await candidatePaths(projectPath, saved.assets[0])).toEqual({ existing: await realpath(mediaPath), tried: [mediaPath] })
  })

  it('does not create a traversing relative reference and reports missing candidates', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'caption missing-'))
    directories.push(directory)
    const outside = path.join(path.dirname(directory), 'outside missing.mp4')
    const projectPath = path.join(directory, 'project.cstudio')
    expect(portableMediaReference(projectPath, outside)).toEqual({ relativePath: null, absolutePath: outside })
    expect(await candidatePaths(projectPath, project(outside).assets[0])).toEqual({ existing: null, tried: [outside] })
    expect(mediaReferenceSchema.safeParse({ relativePath: '../outside.mp4', absolutePath: null }).success).toBe(false)
    expect(mediaReferenceSchema.safeParse({ relativePath: '..\\outside.mp4', absolutePath: null }).success).toBe(false)
  })
})
