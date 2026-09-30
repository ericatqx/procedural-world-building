import { useState } from 'react'
import { useAuth } from '../../auth/useAuth.ts'
import {
  deleteSnapshot,
  listSnapshots,
  loadPayload,
  saveSnapshot,
  type PageId,
  type SnapshotContent,
  type SnapshotEntry,
  type SnapshotPayload,
  type SnapshotState,
} from '../persistence/snapshots.ts'

/**
 * What a page gives the shared Reset / Save / Load control. Built each
 * render; `capture` and `restore` are only called on Save and Restore.
 */
export type PageSnapshotAdapter = {
  page: PageId
  /** Version of this page's `state` / payload shape, stored with each snapshot. */
  schema: number
  /** Restores the page's defaults, locally. */
  reset: () => void
  capture: () => SnapshotContent
  /** Applies a snapshot, paused; throws when it cannot be read. */
  restore: (state: SnapshotState, payload: SnapshotPayload | null, schema: number) => void
  /** Why Save is unavailable right now (e.g. a day jump is running). */
  saveBlocked?: string | null
  /** An older save kept outside the history, offered at the end of the list. */
  loadLegacy?: (uid: string) => Promise<{ summary: string; restore: () => void } | null>
}

type Legacy = Awaited<ReturnType<NonNullable<PageSnapshotAdapter['loadLegacy']>>>

const timeFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const formatTime = (date: Date | null) => (date ? timeFormat.format(date) : 'Saving…')

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

/**
 * Page-level RESET · SAVE · LOAD, at the top of the instrument panel.
 * Save appends a timestamped snapshot; Load opens the history below it,
 * newest first, with Restore and Delete. Save and Load need a signed-in user.
 */
export function PageSnapshots({ adapter }: { adapter: PageSnapshotAdapter }) {
  const { user, ready } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [entries, setEntries] = useState<SnapshotEntry[] | null>(null)
  const [legacy, setLegacy] = useState<Legacy>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const run = async (action: () => Promise<void>, failed: string) => {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      setStatus(errorText(err, failed))
    } finally {
      setBusy(false)
    }
  }

  const needUser = () => {
    if (user) {
      return user.uid
    }
    setStatus(ready ? 'Sign in with Google to save or load.' : 'Checking sign-in…')
    return null
  }

  const refresh = async (uid: string) => {
    const [list, old] = await Promise.all([
      listSnapshots(uid, adapter.page),
      adapter.loadLegacy ? adapter.loadLegacy(uid).catch(() => null) : Promise.resolve(null),
    ])
    setEntries(list)
    setLegacy(old)
  }

  const reset = () => {
    adapter.reset()
    setStatus('Reset to defaults.')
  }

  const save = () => {
    const uid = needUser()
    if (!uid) {
      return
    }
    if (adapter.saveBlocked) {
      setStatus(adapter.saveBlocked)
      return
    }
    const content = adapter.capture()
    void run(async () => {
      await saveSnapshot(uid, adapter.page, adapter.schema, content)
      setStatus('Saved a new snapshot.')
      if (open) {
        await refresh(uid)
      }
    }, 'Save failed.')
  }

  const toggleLoad = () => {
    if (open) {
      setOpen(false)
      return
    }
    const uid = needUser()
    if (!uid) {
      return
    }
    setOpen(true)
    setConfirmId(null)
    setStatus(null)
    void run(() => refresh(uid), 'Could not load the history.')
  }

  const restore = (entry: SnapshotEntry) => {
    const uid = needUser()
    if (!uid) {
      return
    }
    void run(async () => {
      const payload = entry.hasPayload ? await loadPayload(uid, adapter.page, entry.id) : null
      adapter.restore(entry.state, payload, entry.schema)
      setOpen(false)
      setStatus(`Restored ${formatTime(entry.createdAt)}.`)
    }, 'Restore failed.')
  }

  const remove = (entry: SnapshotEntry) => {
    if (confirmId !== entry.id) {
      setConfirmId(entry.id)
      return
    }
    const uid = needUser()
    if (!uid) {
      return
    }
    setConfirmId(null)
    void run(async () => {
      await deleteSnapshot(uid, adapter.page, entry)
      setEntries((current) => current?.filter((item) => item.id !== entry.id) ?? null)
      setStatus('Deleted.')
    }, 'Delete failed.')
  }

  return (
    <div className="page-state">
      <div className="page-state-row" role="group" aria-label="Page state">
        <button type="button" className="text-button" onClick={reset}>
          Reset
        </button>
        <span className="page-state-sep" aria-hidden="true">
          ·
        </span>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          title={adapter.saveBlocked ?? 'Save a new snapshot of this page'}
          onClick={save}
        >
          Save
        </button>
        <span className="page-state-sep" aria-hidden="true">
          ·
        </span>
        <button
          type="button"
          className={open ? 'text-button is-on' : 'text-button'}
          aria-expanded={open}
          disabled={busy && !open}
          onClick={toggleLoad}
        >
          Load
        </button>
      </div>
      {status ? (
        <p className="page-state-status" aria-live="polite">
          {status}
        </p>
      ) : null}
      {open ? (
        <section className="page-history" aria-label="Saved snapshots">
          <header className="page-history-head">
            <span className="instrument-label">History</span>
            <span className="section-status">{entries ? `${entries.length} saved` : ''}</span>
          </header>
          {entries === null ? (
            <p className="page-history-note">Loading…</p>
          ) : entries.length === 0 && !legacy ? (
            <p className="page-history-note">No snapshots yet. Save adds one.</p>
          ) : (
            <ol className="page-history-list">
              {entries.map((entry) => (
                <li key={entry.id} className="page-history-item">
                  <span className="page-history-time">{formatTime(entry.createdAt)}</span>
                  <span className="page-history-summary">{entry.summary}</span>
                  <span className="page-history-actions">
                    <button type="button" className="text-button" disabled={busy} onClick={() => restore(entry)}>
                      Restore
                    </button>
                    <button type="button" className="text-button" disabled={busy} onClick={() => remove(entry)}>
                      {confirmId === entry.id ? 'Confirm delete' : 'Delete'}
                    </button>
                  </span>
                </li>
              ))}
              {legacy ? (
                <li className="page-history-item">
                  <span className="page-history-time">Legacy save</span>
                  <span className="page-history-summary">{legacy.summary}</span>
                  <span className="page-history-actions">
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        legacy.restore()
                        setOpen(false)
                        setStatus('Restored the legacy save.')
                      }}
                    >
                      Restore
                    </button>
                  </span>
                </li>
              ) : null}
            </ol>
          )}
        </section>
      ) : null}
    </div>
  )
}
