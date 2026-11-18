import type { LabIn, LabOut, PackedMesh, Spec } from './labWorker.ts'

/**
 * The Architecture Lab's workers, as one. A view of several specimens (a comparison, a contact sheet) is grown on several workers at
 * once, each specimen on one of them, and the answers are put back together in order; a spec keeps the worker that grew it, so the
 * worker's own memory of it (labWorker.ts) is found again. It answers like a single worker: `postMessage` in, `onmessage` out.
 *
 * A grow that arrives while a worker is still busy with an earlier one is given to the idle workers first; the busy worker finishes its old
 * view (the answer is dropped) before it starts the new one.
 */
type Slot = { w: number; spec: Spec }
type Entry = { worker: Worker; busy: boolean }

export class LabPool {
  onmessage: ((event: { data: LabOut }) => void) | null = null
  /** Workers are started when first needed (a single specimen uses one; nothing runs until a view asks to grow). */
  private entries: (Entry | undefined)[] = []
  private affinity = new Map<string, number>()
  private current: { id: number; slots: Slot[]; started: number; remaining: number; ms: number; ground: number; stats: Record<string, number | string>[]; measures: (Record<string, number> | null)[]; at: number } | null = null
  private meshing: { id: number; req: number; ages: number[]; remaining: number; meshes: (PackedMesh | null)[]; ms: number } | null = null
  readonly size: number

  constructor(size = Math.max(1, Math.min(6, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4) - 1))) {
    this.size = size
  }

  private entry(index: number): Entry {
    return (this.entries[index] ??= this.spawn(index))
  }

  private spawn(index: number): Entry {
    const worker = new Worker(new URL('./labWorker.ts', import.meta.url), { type: 'module' })
    const entry: Entry = { worker, busy: false }
    worker.onmessage = (event: MessageEvent<LabOut>) => this.receive(index, event.data)
    return entry
  }

  private emit(message: LabOut) {
    this.onmessage?.({ data: message })
  }

  private receive(index: number, m: LabOut) {
    if (m.type === 'error') {
      const e = this.entries[index]
      if (e) e.busy = false
      this.emit(m)
      return
    }
    if (m.type === 'grown') {
      const e = this.entries[index]
      if (e) e.busy = false
      const c = this.current
      if (!c || c.id !== m.id) return
      m.slots.forEach((slot, i) => {
        c.stats[slot] = m.stats[i]!
        c.measures[slot] = m.measures[i]!
      })
      c.ms = Math.max(c.ms, m.ms)
      c.ground = m.ground
      c.remaining -= 1
      if (c.remaining === 0) this.emit({ type: 'grown', id: c.id, ms: Math.round(performance.now() - c.at), ground: c.ground, slots: c.slots.map((_, i) => i), stats: c.stats, measures: c.measures })
      return
    }
    const t = this.meshing
    if (!t || t.id !== m.id || t.req !== m.req) return
    m.slots.forEach((slot, i) => (t.meshes[slot] = m.meshes[i]!))
    t.ms = Math.max(t.ms, m.ms)
    t.remaining -= 1
    if (t.remaining === 0) this.emit({ type: 'mesh', id: t.id, req: t.req, ages: t.ages, slots: t.meshes.map((_, i) => i), meshes: t.meshes as PackedMesh[], ms: t.ms })
  }

  postMessage(message: LabIn) {
    if (message.type === 'grow') {
      // A worker still busy with an older view finishes it (its answer is dropped) and is given work last: ending it would lose its warmed-up code.
      const load: number[] = Array.from({ length: this.size }, (_, i) => (this.entries[i]?.busy ? 1 : 0))
      const slots: Slot[] = message.specs.map((spec) => {
        const key = JSON.stringify(spec)
        const kept = this.affinity.get(key)
        const w = kept !== undefined ? kept : load.indexOf(Math.min(...load))
        load[w]! += 1
        this.affinity.set(key, w)
        return { w, spec }
      })
      if (this.affinity.size > 200) this.affinity.clear()
      const used = [...new Set(slots.map((s) => s.w))]
      this.current = { id: message.id, slots, started: performance.now(), remaining: used.length, ms: 0, ground: 0, stats: [], measures: [], at: performance.now() }
      for (const w of used) {
        const mine = slots.map((s, i) => ({ s, i })).filter((x) => x.s.w === w)
        const en = this.entry(w)
        en.busy = true
        en.worker.postMessage({ type: 'grow', id: message.id, specs: mine.map((x) => x.s.spec), slots: mine.map((x) => x.i) } satisfies LabIn)
      }
      return
    }
    const c = this.current
    if (!c || c.id !== message.id) return
    const used = [...new Set(c.slots.map((s) => s.w))]
    this.meshing = { id: message.id, req: message.req, ages: message.ages, remaining: used.length, meshes: c.slots.map(() => null), ms: 0 }
    for (const w of used) this.entry(w).worker.postMessage(message)
  }

  terminate() {
    for (const e of this.entries) e?.worker.terminate()
    this.entries = []
  }
}
