import { app } from 'electron'
import { ProviderSecretStore } from './providerSecretStore'

let store: ProviderSecretStore | undefined
/** The one credential store for every cloud provider (transcription, translation and alignment). */
export const providerSecretStore = () => store ??= new ProviderSecretStore(app.getPath('userData'))
/** Gemini view of the shared store, kept for alignment and translation code that only ever needs that key. */
export const geminiSecretStore = () => {
  const shared = providerSecretStore()
  return {
    load: () => shared.load('gemini'), status: () => shared.status('gemini'),
    save: (apiKey: string) => shared.save('gemini', apiKey), remove: () => shared.remove('gemini'),
  }
}
