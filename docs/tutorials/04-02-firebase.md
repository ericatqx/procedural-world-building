# Assignment 2 — Firebase (Auth, Firestore, Hosting)

This tutorial matches the Firebase setup in this repo: Google sign-in, save/load
of the Week 04 voxel config in Firestore, and deploy with Hosting.

**Live site:** [https://erica-procedural-world.web.app](https://erica-procedural-world.web.app)

Architecture used here:

```text
Authentication  →  who the user is (Google)
Firestore       →  per-user voxel settings
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
- `app/src/ui/AuthBar.tsx` — top-bar **Sign in with Google** / name + **Sign out**
- Wired in `app/src/App.tsx` next to the week tabs (all weeks)

After Hosting deploy, add the Hosting domain under Authentication → Settings →
Authorized domains (`localhost` is already allowed).

---

## Firestore + security rules

**Console:** create a Firestore database. Prefer locked-down rules before a
public deploy (not open test mode forever).

This app stores one default config per user:

```text
users/{uid}/configs/default
  updatedAt: timestamp
  settings: { … VoxelSettings … }
```

Path already includes `uid`, so ownership is the path — not a separate
`ownerId` field.

**Rules used for this path:**

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null
        && request.auth.uid == userId;
    }
  }
}
```

Only the signed-in user can read/write their own subtree.

---

## Save / Load Week 04 voxel config

**Helpers:** `app/src/voxels/firestoreConfig.ts`

- `saveVoxelConfig(uid, settings)` → `setDoc` on `users/{uid}/configs/default`
- `loadVoxelConfig(uid)` → `getDoc`; returns `null` if missing

**UI:** Week 04 side panel → **Cloud config** → **Save** / **Load**
(`VoxelExercise.tsx`). Buttons require a signed-in user.

**What is saved:** the `VoxelSettings` object — `resolution`, `meshMode`,
`showChunkBounds`, `chunksPerAxis`, and `steps[]` (shape, CSG op, size, etc.).
Wireframe / which step card is expanded are local UI only and are not saved.

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

- `firebase.json` — Hosting site `erica-procedural-world`, public dir
  `app/dist`, SPA rewrite `**` → `/index.html`
- `.firebaserc` — default Firebase project for CLI deploys
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

Public URL: **https://erica-procedural-world.web.app**

---

## Quick checklist

- [ ] `.env.local` filled from `.env.example` (not committed)
- [ ] Google sign-in works locally
- [ ] Firestore rules limit access to `users/{uid}/…`
- [ ] Week 04 Save / Load round-trips voxel settings
- [ ] Hosting build + deploy succeeds
- [ ] Hosting domain listed under Auth authorized domains
- [ ] Storage skipped (no Blaze / no file need)
