# Week 04 Assignment 2 — Firebase (Auth, Firestore, Hosting)

This tutorial matches the Firebase setup in this repo: Google sign-in, saved
snapshots of each page's state in Firestore (Week 04's voxel settings among
them), and deploy with Hosting.

**Live site:** [https://procedural-world-lab.web.app](https://procedural-world-lab.web.app)

Architecture used here:

```text
Authentication  →  who the user is (Google)
Firestore       →  per-user saved snapshots of each page
Hosting         →  production build on the web
```

Storage is **not** used (see below).

---

## Web SDK setup

1. Install the SDK in `app/`:

   ```bash
   cd app
   npm install firebase
   ```

2. Copy `app/.env.example` → `app/.env.local` and fill in the Web app config from
   Firebase Console → Project settings → Your apps. Vite exposes only
   `VITE_*` variables:

   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`

3. Local Firebase configuration is kept out of git: `app/.gitignore` ignores
   `.env` / `.env.*` but keeps `.env.example`. Never commit `.env.local`.

4. `app/src/firebase.ts` calls `initializeApp`, then exports `auth` (`getAuth`)
   and `db` (`getFirestore`). Types for the env vars live in
   `app/src/vite-env.d.ts`.

Restart `npm run dev` after editing `.env.local`.

---

## Google Authentication

**Console:** Authentication → Sign-in method → enable **Google**.

**App:**

- `app/src/auth/useAuth.ts` — `onAuthStateChanged`, `signInWithPopup` +
  `GoogleAuthProvider`, `signOut`
- `app/src/shared/ui/AuthBar.tsx` — top-bar **Sign in with Google** / name + **Sign out**
- Wired in `app/src/App.tsx` next to the week tabs (all weeks)

After Hosting deploy, add the Hosting domain under Authentication → Settings →
Authorized domains (`localhost` is already allowed).

---

## Firestore + security rules

**Console:** create a Firestore database. Prefer locked-down rules before a
public deploy (not open test mode forever).

Every Save creates a new snapshot; earlier saves are never overwritten. Each
page (`week03`, `week04`, `week05`, `project`) has its own history:

```text
users/{uid}/pages/{page}/snapshots/{id}
  page: 'week04'
  schema: 1              // version of that page's state shape
  createdAt: timestamp   // server time; the history is listed newest first
  summary: '3 steps · res 20 · Blocks'
  state: { … small page state: controls, settings … }
  hasPayload: false

users/{uid}/pages/{page}/snapshots/{id}/payload/main
  height: Bytes, water: Bytes, …   // heavy typed arrays, one Bytes field each
```

Heavy simulation data (Week 03's erosion fields, the Project's voxels and
sunlight memory) goes in the separate `payload/main` document, so listing the
history only reads the small snapshot documents. Each Firestore document is
limited to 1 MiB; the largest payload (the Project) is a few hundred KB.

Path already includes `uid`, so ownership is the path — not a separate
`ownerId` field.

The first version of Week 04 saved a single overwritten document at
`users/{uid}/configs/week04` (or `configs/default`). Week 04's Load still lists
it, read only, as "old Cloud config".

**Rules** (`firestore.rules` at the repo root; deploy with
`firebase deploy --only firestore:rules`):

```text
match /users/{userId}/pages/{page}/snapshots/{snapshotId} {
  allow read, delete: if isOwner(userId);
  allow create: if isOwner(userId)
    && page in ['week03', 'week04', 'week05', 'project']
    && request.resource.data.page == page
    && request.resource.data.createdAt == request.time;   // plus type checks
  match /payload/{payloadId} {
    allow read, delete: if isOwner(userId);
    allow create: if isOwner(userId) && payloadId == 'main';
  }
}
match /users/{userId}/configs/{configId} {
  allow read: if isOwner(userId);
}
```

Only the signed-in user can reach their own subtree. Snapshots can be created
and deleted but not updated, and the old configs are read only.

---

## Reset / Save / Load snapshots

**Helpers:** `app/src/shared/persistence/snapshots.ts`, shared by every page

- `saveSnapshot(uid, page, schema, content)` → one `writeBatch` that creates
  the snapshot document and, if there is one, its payload
- `listSnapshots(uid, page)` → the newest 50, ordered by `createdAt`
- `loadPayload(uid, page, id)` → the payload's Bytes fields
- `deleteSnapshot(uid, page, entry)` → deletes the payload and the snapshot

`app/src/shared/persistence/codec.ts` turns typed arrays into Bytes and back.

**UI:** `RESET · SAVE · LOAD` at the top of each page's control panel, under
its title (`app/src/shared/ui/PageSnapshots.tsx`, placed through
`InstrumentPanel`'s `utilities` slot). Reset restores the page's defaults and
works signed out; Save and Load need a signed-in user. Load opens the page's
history below the row, newest first, with **Restore** and **Delete** for each
save. Simulations come back paused.

Each page passes the component an adapter: its page id, a schema number, and
`reset`, `capture` and `restore` functions. Firestore is touched only on
Save, Load, Restore and Delete, never while rendering or simulating.

**What Week 04 saves:** the `VoxelSettings` object — `resolution`, `meshMode`,
`showChunkBounds`, `chunksPerAxis`, and `steps[]` (shape, CSG op, size, etc.) —
plus the isolated step and wireframe. `parseVoxelSettings` in
`app/src/weeks/week04/voxels/voxelConfig.ts` back-fills older saves. The
expanded step card and auto rotate are local UI only.

### Why save parameters, not geometry?

The mesh is **derived** from the density field. Saving triangle buffers would be
huge, slow, and redundant. Saving the small settings object lets the client
rebuild the volume and remesh on load.

---

## Storage (not used)

Cloud Storage was **not** enabled for this project:

- For this project, Firebase Console required upgrading to the Blaze plan to enable Cloud Storage.
- This assignment only needs to persist procedural **settings**, which fit in
  Firestore. There is no file upload (images, meshes, etc.) yet.

The web config still includes `storageBucket` (from the Firebase web app
snippet), but the app never calls `getStorage` or uploads files.

---

## Hosting setup and deploy

Repo-root config (already in the repo):

- `firebase.json` — Hosting target `lab`, public dir `app/dist`, SPA
  rewrite `**` → `/index.html`; Firestore rules file
- `firestore.rules` — owner-only access to `users/{uid}/…`
- `.firebaserc` — default Firebase project for CLI deploys, and the `lab`
  target mapped to the Hosting site `procedural-world-lab`
- `.gitignore` ignores `.firebase/`

Commands:

```bash
# once
npm install -g firebase-tools
firebase login

# build Vite output → app/dist
cd app && npm run build

# deploy from repo root
cd ..
firebase deploy --only hosting
```

Public URL: **https://procedural-world-lab.web.app**

---

## Quick checklist

- [ ] `.env.local` filled from `.env.example` (not committed)
- [ ] Google sign-in works locally
- [ ] Firestore rules limit access to `users/{uid}/…`
- [ ] Week 04 Save / Load round-trips voxel settings through a snapshot
- [ ] Hosting build + deploy succeeds
- [ ] Hosting domain listed under Auth authorized domains
- [ ] Storage skipped (no Blaze / no file need)
