# Strata Refined as a procedural family: assessment and plan

> Status: **plan only, nothing implemented.** Follows [Strata performance 01](../analysis/strata-performance-01.md) and [Refinement Study 01](../analysis/refinement-study-01.md).

## 0. Habitat Study cleanup (done)

- **C · Compose** now offers only **Original** and **Blade / Strata Refined** (`ACTIVE_FORMS` in `habitat-study/compose/forms.ts`). A retired form remembered from an earlier visit falls back to Original.
- Blade, Brackets, Canopy, Fold, Strata and Original Refined stay defined in code, for reference and because Strata Refined reuses Blade's mass.
- **Is anything unused built?** No. Forms are built only when chosen (on demand, then cached), and nothing at module load is costly: the leg's segment table is 18 entries. No optimisation was needed.

## 1. What the Architecture Lab already provides

| Piece | Where | Reusable for Strata? |
|---|---|---|
| **Family registry**: id, label, growth text, age range and stages, habitat inputs | `architecture-lab/families.ts` | Yes: add a third entry |
| **Habitat model** (light, moisture, resource, ridge, crowding, water distance, size) and its five presets | `families.ts` | Yes, unchanged |
| **Design-first pattern**: `designPorous(seed, site, inputs)` makes a *plan* (seed draws plus habitat rules), then `porousMesh(plan, age)` makes the mesh at an age | `porousDesign.ts`, `porousGrowth.ts` | **The template to follow.** Strata is design-first too |
| **Seed draws** `rv(seed, a, b)`, the same seed under any habitat keeping its arrangement, and habitat rules equal to 1 at the reference | `overhangRefined.ts`, `porousDesign.ts` | Yes, same conventions |
| **Worker pool**: several workers, each spec stays on its worker, per-spec cache (6), a new grow replaces the old one and a busy worker's stale answer is dropped | `labPool.ts`, `labWorker.ts` | **Yes: the answer to UI freezes.** One branch in `growOne` |
| **Lifecycle**: one slider, 7 stages, `lifeAt(L)` giving age, live, dead, recede and ruin | `lifecycle.ts` | Stage model and material yes. The geometry side (`life.at`) is the Overhang generator's own, so Strata needs its own age function, as Porous has |
| **Lifecycle material** (living tissue to mineral skeleton) | `lifecycleMaterial.ts` | Yes, it reads only shader inputs |
| Small-fragment removal (`dropSmall`) | `labWorker.ts` | Yes, as a safety net |
| Stand-in world, terrain context (slope, downhill) | `labWorker.ts`, `terrainContext.ts` | Yes |

The Overhang and Porous code stays unchanged; Strata would be added beside them. The lab's comparison and contact-sheet views currently assume exactly two families (`ArchitectureLab.tsx`, around lines 247–262), so those lines need a small generalisation.

## 2. Strata Refined today: hardcoded vs parameterised

The only parameters today are **scale** and the **frame**: the long axis points toward the sun, and the site sets the ground. Everything else is hand-placed constants, about 40 of them:

| Part | Hardcoded today |
|---|---|
| Mass | radii (16 × 14), waist curve, lean back (0.18 per metre of height), top height 41 and its slope toward the blade |
| Blade | extent (−46 to 64), half-width 18, plan curve (−8·sin), rise (+4 at the tip), crease line and fall, thickness 9 → 2.6, lip 2.2 |
| Leg | two curves with fixed control points (arch out of the mass, sweep up to the blade), radii 4.2 → 5.6 → 2.4, a root-foot ellipsoid at a fixed point |
| Ledge rings | three heights (10.5, 19.5, 27.5), phases, how far each grows out |
| Shelves | three fixed tuples: root position, heading, length, width, height, thickness, droop, lobe phase |

**What holds it together** is also hand-placed:
- the leg's head is set to meet the blade's underside at u = 36, about 33.5 m up;
- each shelf root is set inside the mass at the height of a ring.

Change the blade's length or rise and the leg ends in the air. Move the mass and the shelves float.

## 3. Proposed morphology controls (seven)

Each is drawn from the seed and nudged by the habitat, following the same rules as `overhangRefined.ts`: equal to the reference at the reference habitat, with a floor so the identity never disappears.

| Control | Range | Visible effect | Habitat link |
|---|---|---|---|
| **Reach** | 0.75 to 1.25 × blade length | long gesture or compact | light lengthens, exposure shortens |
| **Rise** | 0 to 8 m at the tip | level blade or one that lifts toward the light | shade raises it |
| **Swing** | −1 to 1 | blade curving toward or away from the open side | crowding and slope swing it away from neighbours and downhill |
| **Mass** | height 0.85 to 1.2, lean 0 to 0.25 | squat, broad mass or a tall, leaning keep | shelter makes it taller; ridge wider and lower |
| **Support** | foot position 0.5 to 0.85 along the blade, side −1 to 1 | where the void opens and how wide it is | the foot moves toward water (shore) |
| **Tiers** | 0 to 3 shelves, and their heights | open hall or layered undercroft | resource and moisture add tiers |
| **Crease** | 0 to 1 | smooth leaf or articulated, folded roof | exposure sharpens it |

These seven give visibly different silhouettes (reach, rise, swing), different spaces (support, tiers) and different surfaces (crease, mass). Everything else should stay derived from them, not drawn.

## 4. Keeping supports and shelves connected

**Principle: connections are derived from the parts they join, never placed.**

1. **The blade as functions.** The blade is described by its centreline `wc(s)`, its top `top(s, q)` and its underside `under(s, q)` along its length s. Every other part asks these functions where the blade is.
2. **The leg's ends are computed.**
   - Head: on the blade's centreline at the chosen foot position, embedded in the underside by more than its radius (`under(s,0) + r`).
   - Root: on the mass's surface, from the mass's own outline (`uc(y)`, its radii) at the arch height, facing the head.
   - Foot: on the ground below the arch, from `landscapeHeight`.

   The curve passes through these points, so it always touches both bodies; the smooth union then fillets the joints.
3. **Shelves grow from the ledge rings.** The ring heights and the shelf heights are one list, so each shelf starts on a ledge. Its root sits inside the mass by 40% of its root thickness, at the mass outline for that height. Each shelf is then limited:
   - **Heading:** within the undercroft sector (between the mass and the leg, under the blade).
   - **Length:** short enough that its tip stays under the blade's plan and clear of the leg.
   - **Height:** at least 3 m above the ground and 3 m below the underside.
4. **Clearances are invariants.** The plan checks minimum headroom under the blade, minimum void width (mass to leg) and minimum shelf spacing, then clamps the controls to keep them. This keeps the study's qualities (an inhabitable undercroft, the great void) for every seed, not just the reference.
5. **Safety net.** After meshing, a connected-component check, like the lab's `dropSmall`, measures any detached piece. In development, a seed sweep reports seeds that produced one rather than silently dropping it.

The reference plan (the reference seed at the reference habitat) must reproduce today's Strata Refined. The study's mesh checksum is the test.

## 5. Avoiding UI freezes

**Reuse the lab's worker pool**:
- add `family: 'strata'` to `Spec`;
- in `labWorker.growOne`, call `designStrata(seed, site, habitat)` and then `strataMesh(plan, age)`.

The pool already runs specimens in parallel, caches each spec, lets the newest request replace older ones and drops stale answers, so regeneration never blocks the page.

Notes:
- **What runs in the worker:** the field, the coarse-to-fine fill (`fillField`), surface nets and normals. The lab doesn't need the study's clay shading bake (ambient occlusion), which was about 70% of the cost. Expected cost: about 1–3 s per specimen, off the main thread.
- **Shared code:** the field and the coarse-to-fine fill move into a shared module (`architecture-lab/strataField.ts`) that both the lab worker and the Habitat Study import. That way there is one implementation.
- **Habitat Study:** it can later post the same Spec to the same pool, which also removes its remaining freeze.
- **Age:** grow the parts in order, as Porous does per primitive. The mass rises first, then the blade extends (its reach clipped by age), then the leg, then the tiers. Senescence and ruin can come later; the lifecycle material already handles living tissue turning to mineral skeleton.

## 6. Implementation plan (for approval)

1. **Extract** `strataField.ts`: the field from a `StrataPlan`, plus `fillField`. Build `referencePlan()` and confirm it reproduces today's mesh (checksum). Habitat Study switches to it. *Small.*
2. **`strataDesign.ts`**: the seven controls from seed and habitat, the derived connections (section 4) and the clearance clamps. *Medium.*
3. **Lab integration**:
   - add a `'strata'` entry to `families.ts`;
   - add the worker branch in `labWorker.ts`;
   - generalise the two-family compare and contact-sheet lines in `ArchitectureLab.tsx`.

   *Small.*
4. **Age**: ordered part growth. *Small to medium.*
5. **Seed sweep**: a contact sheet of 6 seeds × the 5 habitat presets, checking connectivity, clearances and silhouette variety. *Review point.*
6. Only then, decide on the world: the hero organism only (bounded), or the population (needs part labels for the world's lifecycle; larger).

Overhang and Porous stay as they are throughout, and nothing touches `project03/`.
