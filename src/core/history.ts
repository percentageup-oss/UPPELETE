export type History<T> = { past: T[]; present: T; future: T[] }

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

export function commitHistory<T>(history: History<T>, present: T): History<T> {
  if (present === history.present) return history
  return { past: [...history.past, history.present], present, future: [] }
}

export function undoHistory<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1)
  if (!previous) return history
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redoHistory<T>(history: History<T>): History<T> {
  const next = history.future[0]
  if (!next) return history
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  }
}
