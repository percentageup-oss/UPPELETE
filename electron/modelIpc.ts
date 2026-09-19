import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import { MODEL_CATALOG, modelIdSchema } from '../src/core/modelCatalog'
import { whisperCliConfigured } from './mediaWorker'
import { ModelManager } from './modelManager'

let manager: ModelManager | undefined
export function getModelManager() { return getManager() }
function getManager() {
  if (!app.isReady()) throw new Error('App is not ready')
  if (!manager) {
    manager = new ModelManager(path.join(app.getPath('userData'), 'Models', 'whisper.cpp'))
    manager.subscribe((state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.webContents.isDestroyed()) window.webContents.send('models:state', state)
      }
    })
  }
  return manager
}

export function registerModelIpc() {
  // Disk-only; no startup/catalog networking. Backend availability is whether whisper-cli is configured.
  ipcMain.handle('models:list', async () => ({ ...(await getManager().list()), backendAvailable: whisperCliConfigured() }))
  ipcMain.handle('models:download', (_event, value: unknown) => getManager().download(modelIdSchema.parse(value)))
  ipcMain.handle('models:cancel', (_event, value: unknown) => getManager().cancel(modelIdSchema.parse(value)))
  ipcMain.handle('models:remove', async (event, value: unknown) => {
    const id = modelIdSchema.parse(value)
    const model = MODEL_CATALOG.find((entry) => entry.id === id)!
    const modelManager = getManager()
    const state = modelManager.snapshot(id)
    if (['checking', 'downloading', 'verifying', 'removing'].includes(state.status)) return state
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('Model removal requires an active app window')
    const choice = await dialog.showMessageBox(owner, {
      type: 'warning', title: 'Remove local model?',
      message: `Remove ${model.name}?`,
      detail: `Deletes only this managed model and its saved partial download:\n${state.location}\n${state.partialLocation}\n\nTo use this model again you will need to explicitly download it.`,
      buttons: ['Keep model', 'Remove model and partial download'], defaultId: 0, cancelId: 0, noLink: true,
    })
    if (choice.response !== 1) return modelManager.snapshot(id)
    return modelManager.remove(id)
  })
}
export async function closeModelManager() { await manager?.close() }
