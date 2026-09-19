import { JobScheduler } from './jobScheduler'

/**
 * One process-wide job scheduler shared by transcription and export, so `JobScheduler`'s
 * default `heavyConcurrency: 1` actually arbitrates between them — a heavy transcription and a
 * heavy export job never run together unless a caller explicitly raises concurrency, matching
 * `docs/ARCHITECTURE.md`'s "Jobs and failures" contract. A separate scheduler per feature would
 * silently defeat that arbitration by letting each kind queue against only itself.
 */
let scheduler: JobScheduler | undefined
export function getJobScheduler(): JobScheduler {
  scheduler ??= new JobScheduler()
  return scheduler
}
export async function closeJobs(): Promise<void> {
  await scheduler?.close()
}
