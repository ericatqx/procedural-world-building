# Strata Refined: performance assessment

> Technical assessment after [Refinement Study 01](refinement-study-01.md). Measured in the Habitat Study (C · Compose, 60 m, Clay) on the development machine, Chrome, dev build. Geometry is unchanged: every fix below was checked to produce the **identical mesh** (a checksum over all vertex positions, compared with and without the fix).

## 1. Where the time goes

A form is built once per page (cached per site, per form, per scale), **synchronously on the main thread**, the first time the scene asks for it. The build has four stages, all driven by the form's distance field (SDF):

| Stage | What it does | Strata Refined, before | after |
|---|---|---|---|
| Mesh: SDF on the grid | the field at every grid point (0.35 m at 60 m) | 3.63 M SDF calls · 7.3 s | 1.74 M calls · 2.1–2.8 s |
| Mesh: surface nets | extracting the surface (53,151 vertices) | (small, inside the above) | — |
| Field normals | gradient of the field at each vertex (6 calls each) | 0.32 M calls · 0.6 s | 0.4 s |
| **Form AO** | 12 rays per vertex marched through the field + a cavity term | **5.92 M calls · 12.2 s** | 5.92 M calls · 8.5 s |
| Ground AO | the same for nearby ground vertices | 0.15 M calls · 0.3 s | 0.24 s |
| **Total** | | **≈ 20.5 s** | **≈ 11–12 s** (warm); 9.3 s observed in the app, cold |

For comparison, Blade costs ≈ 1.3 s in total; the old Strata ≈ 8.6 s.

Why Strata Refined was so slow:
1. **Each SDF call was ~6× the cost of Blade's** (≈ 2.0 µs against 0.35 µs). The leg is 18 capsule segments along two curves, and every call recomputed each segment's end points from the curve and allocated small arrays for it — although the leg never changes. The three lobed shelves add trigonometry per call.
2. **The whole grid was evaluated**, although only cells near the surface matter to the mesher.
3. **AO dominates**: 53,151 vertices × ~111 field calls each.

Everything else was measured and is small:
- **React / plants:** rebuilding the plant instances when the form changes ≈ 50 ms; returning to an already built form ≈ 270 ms in total.
- **Switching views** (all plates, the contact sheets), **light modes** (Silhouette / Values / Clay), **the hour:** 10–21 ms, no geometry or AO recomputed (verified: no build log, no freeze).
- **Switching style** (Data ↔ Compose) remounts the canvas: ≈ 280 ms (materials recompile), geometry stays cached.
- **StrictMode** double-renders in development; the builds are cached, so the second render is a cache hit.
- **First build in a fresh page is 2–4× slower** than later ones (the JavaScript engine has not optimised the code yet). This is the case you hit when you first click.

## 2. Redundant or overlapping work

- **No redundant rebuilds** on camera, mode or hour changes (above).
- **Repeated clicks during a build: yes, a real problem.** The build blocks the page, so clicks made meanwhile queue up, and when it finishes *each* queued form is built in turn. Measured: Fold → Canopy → Brackets clicked in quick succession built all three, **6.96 s blocked** for one wanted result. Nothing runs in parallel (one thread), but the work piles up in series.
- **Shadow map every frame.** The 4096² shadow map was redrawn every frame, although it changes only with the hour, the form or the light mode. Not a build cost, but a constant GPU cost while orbiting, heavier on a weaker machine.

## 3. Fixes applied (small, exact)

| Fix | Where | Effect | Quality |
|---|---|---|---|
| **Coarse-to-fine grid.** Evaluate block corners (every 4 steps) first; blocks that cannot contain the surface (corners all farther than the block's diagonal × 2.5) are interpolated, the rest evaluated exactly | `fillField` in `forms.ts` (all field forms) | SDF calls on the grid −42 to −57% for every form; mesh ≈ 2× faster | **identical mesh** for Blade, Brackets, Canopy, Fold, Strata, Strata Refined (checksums equal) |
| **Leg segments precomputed**, evaluated without allocation | `limbSegs` / `limbFast` | per-call cost of Strata Refined ≈ −30% (mesh, normals and AO all benefit) | identical |
| **Exact early-outs**: a ledge ring, the leg or a shelf is skipped when a cheap lower bound proves it cannot change the smooth union | `strataRefined` | mesh −30% more (2.06 s vs 3.0 s, measured on/off) | identical (checked on/off) |
| **Latest click wins.** The scene follows the chosen form 80 ms later, so clicks made while a form builds collapse into the last one; the readout shows "Building…" first | `HabitatStudy.tsx` | Fold → Canopy → Blade quickly: only Blade built, **1.4 s** blocked instead of ~7 s | no change |
| **Shadow map on change only** (hour, form, scale, light mode, view kind), for 4 frames | `ComposeScene.tsx` | GPU cost while orbiting drops to the main pass only | shadows verified to follow the hour |

Development hooks added (no effect unless called): `profileForm` (stage timings and SDF call counts), `setCoarseToFine`, `setFieldBounds` (to re-check that the mesh is unchanged).

**Result:** Strata Refined's first build ≈ 20 s → ≈ 9–12 s here. It is better, but **still not acceptable for an interactive world**: on a machine 2× slower that is still a ~20 s freeze and Chrome's "Page Unresponsive" warning.

## 4. What would actually solve it (proposed, not done)

In order of value. 1 and 2 are the real fixes; 3 is a quality trade-off.

1. **Build in a Web Worker** (recommended). The SDF, mesher, normals and AO are pure functions of the site's frame and the terrain height; nothing needs the DOM. The page would never freeze, whatever the cost, and the UI could show progress. The world already has this pattern (`project03/livingWorker.ts` builds organisms off the main thread). Cost: moderate. The worker needs the terrain seed and the frame passed in, and returns the mesh's arrays, as `livingWorker` does.
2. **Cache built meshes in IndexedDB**, keyed by the form's code and the site, as the world already does for organisms (`livingOverhangAsync.ts`). The second visit is instant. Cost: small, once 1 exists.
3. **Cheaper AO** (≈ 70% of what remains):
   - sample the already computed field grid (trilinear) instead of the exact SDF in the ray march; or
   - bake AO on a coarser copy of the mesh and transfer it.

   Either is likely 3–5× faster, but the shading changes slightly. It is only the study's clay shading, but it is not exact, so it needs your OK.

## 5. Could Strata Refined become a procedural family in the world generator?

**Short answer: yes in principle, but it is a substantial integration, not a port.**

What exists today:
- Strata Refined is one **hand-tuned shape**: about 40 constants in a fixed local frame (mass position, blade length and curve, leg control points, three shelves with heights and headings, ring heights). It has no notion of seed, habitat or age.
- The world's organisms come from `growOverhang3`. That generator takes an `OrganismForm` (keep height, reach, spread, shelf lift, rise, swing, asymmetry, shore, dominance…) planned per organism from its habitat. It labels every part (keep, shelf, outlier, pier…) because the **lifecycle** (arrival, growth, recession, `life.at(age)`) is driven per part. It runs in the worker, with a coarse first pass and IndexedDB caching.

What a "Strata family" would need:
1. **Parameterisation.** Map the form's constants to the existing `OrganismForm` vocabulary, which fits well:
   - reach → blade length
   - keep → mass height
   - shelfLift → blade height
   - swing → blade curvature
   - shore → leg foot toward the water
   - asym → shelf count and sides
   - mezzanine → the low shelf

   This part is natural.
2. **Constraints instead of constants.** Today the leg's head is placed by hand to meet the blade's underside, and the shelves' roots by hand inside the mass. For variations these must be *derived* (e.g. the leg ends where the blade's underside is at that point along it), or some seeds will produce floating legs or shelves. Moderate work.
3. **Lifecycle parts.** For growth and decay to work, each part of the field has to report which part it belongs to: mass as the keep, blade as the great shelf, leg as a pier, shelves as the mezzanine or lower shelf. Then `livingLife` can give it arrival and recession times. This is the **largest piece of work** and the riskiest.
4. **Cost at world scale.** Without the study's AO (the world has its own materials), the mesh alone is ≈ 2–3 s per reference-sized organism on the main thread. In the worker, cached, with the world's coarse first pass for distant organisms, that is workable for ~40 organisms on first load, and instant afterwards.

Realistic options:
- **A. Keep the Original in the world**, and carry Strata Refined's qualities (long gesture, open undercroft, layered shade) into the visual stage through surface treatment and linework. No integration cost; fits the timeline. *(Your own note: "those qualities may be better developed through surface treatment".)*
- **B. Strata Refined for the Reference Overhang only**, built in the worker and cached, with the rest of the population unchanged. Bounded effort (fix 1 above plus a small lifecycle mapping); the hero structure changes, the ecology code doesn't.
- **C. A full Strata family** in `growOverhang3`. Days of work, mostly in constraints and lifecycle; only worth it if the whole island's architecture should change character.

**My recommendation:** **A** for the art-direction phase, keeping **B** as a later, bounded step if the hero plate needs Strata's silhouette. **C** is out of proportion to the current goal.
