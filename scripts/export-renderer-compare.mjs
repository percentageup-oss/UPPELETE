import { app, nativeImage } from 'electron'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

// Compare saved PNG pixels across modes, using the same decoder and premultiplied bitmap API.
app.whenReady().then(async () => {
  const [softwareDirectory, gpuDirectory] = process.argv.slice(2).map((path) => resolve(path))
  assert.ok(softwareDirectory && gpuDirectory, 'Supply software and GPU evidence directories')
  const software = JSON.parse(await readFile(join(softwareDirectory, 'measurements.json'), 'utf8'))
  const gpu = JSON.parse(await readFile(join(gpuDirectory, 'measurements.json'), 'utf8'))
  assert.deepEqual(software.sourceHashes, gpu.sourceHashes, 'Compare the same renderer sources')
  const report = { softwareDirectory, gpuDirectory, sourceHashes: software.sourceHashes, cases: [] }
  const other = new Set(await readdir(gpuDirectory))
  for (const file of (await readdir(softwareDirectory)).filter((file) => file.endsWith('.png') && !file.includes('preview') && other.has(file))) {
    const a = nativeImage.createFromPath(join(softwareDirectory, file)), b = nativeImage.createFromPath(join(gpuDirectory, file))
    assert.deepEqual(a.getSize(), b.getSize())
    const x = a.toBitmap(), y = b.toBitmap()
    let differingPixels = 0, maxChannelDelta = 0, totalChannelDelta = 0, differingAlphaPixels = 0
    for (let i = 0; i < x.length; i += 4) {
      let differs = false
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(x[i + channel] - y[i + channel])
        differs ||= delta > 0; maxChannelDelta = Math.max(maxChannelDelta, delta); totalChannelDelta += delta
      }
      if (differs) differingPixels++
      if (x[i + 3] !== y[i + 3]) differingAlphaPixels++
    }
    report.cases.push({ file, dimensions: a.getSize(), differingPixels, differingAlphaPixels,
      maxChannelDelta, meanAbsoluteChannelDelta: totalChannelDelta / x.length })
  }
  await writeFile(join(softwareDirectory, 'cross-mode.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  app.exit(0)
}).catch((error) => { console.error(error); app.exit(1) })
