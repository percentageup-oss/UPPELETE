import { app } from 'electron'
import { GeminiSecretStore } from './geminiSecretStore'

let store: GeminiSecretStore | undefined
/** The one Gemini key store shared by alignment and transcription IPC. */
export const geminiSecretStore = () => store ??= new GeminiSecretStore(app.getPath('userData'))
