import { AuthBar } from '../shared/ui/AuthBar.tsx'
import { PageSnapshots, type PageSnapshotAdapter } from '../shared/ui/PageSnapshots.tsx'
import type { SnapshotState } from '../shared/persistence/snapshots.ts'

/**
 * EXPLORE'S SAVED VIEWS (loaded only when the drawer opens, so Firebase is never fetched by a visitor who does not ask for it). The existing sign-in
 * (auth/useAuth.ts, Google) and snapshot history (shared/persistence/snapshots.ts: users/{uid}/pages/explore/snapshots, owner-only, see firestore.rules)
 * are reused as they are. What is saved is the VIEW a visitor has made (day and hour, lens, layers, weather), never the island: the island is
 * generated from its seed and is the same for everyone.
 */
export default function SavedDrawer({ capture, apply, reset, summary }: { capture: () => SnapshotState; apply: (state: SnapshotState) => void; reset: () => void; summary: () => string }) {
  const adapter: PageSnapshotAdapter = {
    page: 'explore',
    schema: 1,
    reset,
    capture: () => ({ summary: summary(), state: capture() }),
    restore: (state) => apply(state),
  }
  return (
    <div className="pv-saved">
      <p className="pv-saved-note">
        These apply to Explore only. <b>Save</b> keeps the view you have made now: the day and hour, the lens, which layers are shown and the
        weather. <b>Load</b> lists your saved views, newest first; Restore applies one. <b>Reset</b> returns Explore to its defaults here (the plain
        island, every layer shown, the seed’s own weather; the clock stays where it is) and never touches your saved views: a saved view is removed
        only by its own Delete. The island itself is never saved: its seed generates it, the same for everyone.
      </p>
      <AuthBar />
      <PageSnapshots adapter={adapter} />
    </div>
  )
}
