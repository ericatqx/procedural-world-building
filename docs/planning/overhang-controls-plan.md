# Overhang (Refined): direct morphology controls, assessment and proposal

> Status: **proposal, nothing implemented.** Strata stays in the lab as an experimental family. No changes to the main world, the generator (`project03/livingOverhang3.ts`), the lifecycle or other labs.

## 1. How an Overhang is made today

```
habitat ──► formFromHabitat (livingEcology.ts) ──► base OrganismForm
                                                     │
seed + habitat + terrain ──► refinedForm (overhangRefined.ts) ──► OrganismForm (+ compose)
                                                     │
                       growOverhang3(world, seed, { life: true, form })   ← the world's generator, unchanged
                                                     │
                       life.grown() (mature) / life.at(age, state) (stages)  ← lifecycle, in the lab worker
```

**Already procedural, from the seed:**
- **Masses:** the three masses' heights, widths, positions and lean (`compose.tops`, `widths`, `shifts`, `lean`), plus an optional fourth mass (`extra`).
- **Cantilever:** its reach, swing, rise, thickness and width.
- **Supports:** whether an outlier body carries the shelf's end, the number and placement of extra piers, and whether the reference pier stays.
- **Other features:** the old shelf, and how loose the outlines are (`soft`).
- **Inside the generator:** the strata bands, the cleft and the recesses, from its own random stream.

**From the habitat:**
- **Base form:** keep height, reach, spread, shelf lift, asymmetry, shore, dominance, curtain, mezzanine and low mass (`formFromHabitat`).
- **Refined rules:** climb, broadening, reach scaling, swing with crowding and slope, thicker shelves when exposed, more piers on slopes, branch arms where the place is rich and lit.

**From the lifecycle:** `life.at(age, state)` regrows the same form at any age. Every stage reads the one `OrganismForm`, so anything that changes the form changes every stage consistently.

## 2. Parameters that could become sliders

All of these already exist in `OrganismForm` or `OverhangCompose`, so no generator change is needed:

| Morphology | Parameter | Where it acts in `growOverhang3` | Visual effect | Caveat |
|---|---|---|---|---|
| **Height** | `form.keep` (× every mass's height) | line 266 | tall tower ↔ low keep | **Changes the random draws that follow** (the strata-band loop at ~318 draws per band up to the tallest mass), so cleft, recesses and later details re-roll |
| **Reach** | `form.reach` (× the cantilever's length from the keep face) | 367 | long ↔ short gesture | none expected, to verify |
| **Undercroft height** | `form.shelfLift` (× the shelf's height) | 368 | a tall, open undercroft ↔ a low, sheltered one | none expected |
| **Supports** | `form.outlier` (second body under the shelf end), plus `compose.piers` (count) and `keepPier` | 428, 495, 833 | carried by a body ↔ free cantilever on piers ↔ braced | Toggling the outlier may change later draws (to verify) |
| Shelf thickness | `compose.shelfThick` | 375 | slender ↔ massive slab | none |
| Swing / rise | `form.swing`, `form.rise` | 374, 384 | plan curve / tilt of the cantilever | none |
| Massing | `compose.widths`, `form.spread` | 299, — | narrow towers ↔ broad base | none |
| Layering | `compose.layering {lip, warp}` | 704, 719 | strata ledges | **Rejected visually** in Refinement Study 01 (sharp artifacts); not recommended |
| Openness | `compose.soft`, the recesses | 676 | outline looseness | weak and indirect; not recommended |

## 3. Recommended first controls (four)

1. **Height** (`keep`): the strongest change to the silhouette.
2. **Reach** (`reach`): the cantilever's gesture.
3. **Undercroft** (`shelfLift`): the openness and shade space under the shelf. This is the most relevant to Shadow Ecology.
4. **Supports** (three steps: *carried* = outlier on; *braced* = no outlier, seed piers + 1; *free* = no outlier, 0–1 piers). Structurally this is the most legible change.

Shelf thickness would be a cheap fifth if needed.

## 4. How overrides coexist with everything else

- **Apply after `refinedForm`, as multipliers on its result** (1 = neutral). Seed and habitat stay fully active: a contact sheet of six seeds at "Height ×1.2" still shows six different individuals, each 20% taller than it would be. A slider never replaces the seed's value with an absolute one.
- **Clamp to the ranges the generator already accepts**, so no slider produces a form the generator has never seen:
  - `keep` 0.6–1.5;
  - `reach` 0.55–1.6;
  - `shelfLift` 0.75–1.5.
- **Supports** is a choice, not a multiplier. *Carried* keeps the seed's own pier list. *Braced* and *free* set `outlier: false` and keep, extend or trim the seed's pier list; any extra piers are placed evenly along the shelf, so no new random draws are needed.
- **Lifecycle unchanged.** Overrides change only the `OrganismForm` passed to `growOverhang3`, which builds the same lifecycle from it. Maturity stays the mature mesh, stages regrow from the overridden form, and `lifecycle.ts` and the lifecycle material are untouched.
- **Caching unchanged.** The overrides join the `Spec` (`overhang?: {height, reach, undercroft, supports}`), and the worker caches by the whole spec, so moving a slider back finds the earlier specimen.
- **Re-rolled detail.** Height, and possibly Supports, shift later random choices: the strata bands, cleft and recesses differ slightly. The proposal is to accept this and say so in the slider's tip. Avoiding it would mean changing the generator's random stream, which would also change the world's organisms, so that's out of scope.
- **Not in the world.** The world's worker calls `growOverhang3` without these overrides, so nothing changes there.

## 5. Implementation proposal (small, about 80 lines, lab only)

1. **`architecture-lab/overhangControls.ts`** (new): an `OverhangOverrides` type, the slider specs, and `applyOverrides(form, o)`, which multiplies and clamps `keep`, `reach` and `shelfLift`, and maps Supports to `outlier` and `compose.piers`.
2. **`labWorker.ts`**: `Spec.overhang?`; in `growOne`, `form = applyOverrides(form, spec.overhang)` right after `refinedForm` (and after `base` for the Original variant). One line in the existing path.
3. **`ArchitectureLab.tsx`**: four sliders under **Individual** when the family is Overhang, debounced like the seed, with a **Reset** button. This is the same pattern as Strata's controls.
4. **Check** (no screenshot matrix): for one seed, compare the mature form at each slider's ends, check the seven lifecycle stages at one setting, and run the six-seed sheet at one setting. Record any re-rolled details and the build time (Overhang takes a few seconds per specimen in the workers).

Strata keeps its own controls and stays as is.
