import { ipcMain } from 'electron'
import { z } from 'zod'
import { cloudProviderIdSchema } from '../src/core/transcriptionProviders'
import { providerSecretStore } from './geminiKey'

export function registerProviderKeysIpc() {
  ipcMain.handle('providerKeys:statuses', () => providerSecretStore().statuses())
  ipcMain.handle('providerKeys:save', async (_event, provider: unknown, apiKey: unknown) => {
    await providerSecretStore().save(cloudProviderIdSchema.parse(provider), z.string().parse(apiKey))
    return providerSecretStore().statuses()
  })
  ipcMain.handle('providerKeys:remove', async (_event, provider: unknown) => {
    await providerSecretStore().remove(cloudProviderIdSchema.parse(provider))
    return providerSecretStore().statuses()
  })
}
