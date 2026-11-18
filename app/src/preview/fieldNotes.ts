import { useSyncExternalStore } from 'react'

/**
 * FIELD NOTES: the photographs taken in this visit (PhotoMode.tsx), each with the moment it records and what it was taken of. Kept in this tab's
 * memory only, never uploaded: closing the tab clears them; Download keeps one.
 */
export type FieldNote = { id: number; src: string; moment: string; subject: string; at: Date }
let notes: FieldNote[] = []
let next = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const fieldNotes = {
  add(src: string, moment: string, subject: string): FieldNote {
    const note = { id: next++, src, moment, subject, at: new Date() }
    notes = [note, ...notes]
    emit()
    return note
  },
  remove(id: number) {
    notes = notes.filter((n) => n.id !== id)
    emit()
  },
  all: () => notes,
}

export function useFieldNotes(): FieldNote[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => notes,
  )
}

export const noteFileName = (n: FieldNote) => `shadow-ecology-${n.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'observation'}-${n.id}.png`
