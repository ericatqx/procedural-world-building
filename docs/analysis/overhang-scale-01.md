# Overhang world scale and distribution 01

> Shadow Ecology 0.3. Replaces the temporary 120/90/60 m study toggle (removed). The generator (`livingOverhang3.ts`), lifecycle, Architecture Lab, Strata and Porous are unchanged.

## What changed (`project03/livingEcology.ts`, `project03/livingRefined.ts`)

- **Per-organism final scale.**
  - Every organism keeps its **size class**, the ecological size the ground allows (about 0.25–1.25, from resource, light, room and generation, as before). It's now stored as `sizeClass` on the plan.
  - It's drawn at `form.size = drawnSize(sizeClass)`, where the target width is 60 + 30 × smoothstep(0.25, 1, class), divided by the width per unit of size measured on built meshes (≈ 90 m for refined forms, 122 m for the reference). The reference (class 1) is drawn at 90 m.
  - Height isn't targeted: it follows each form's own proportions.
- **Decisions read the class, geometry reads the drawn size.**
  - **Class:** form dominance (`formFromHabitat`), outlier and old-shelf thresholds, fusion rules, the "kept small" note, the refined form's habitat input.
  - **Drawn size:** mesh size and grid step, the outlier's dry-ground test, the ground drop along the opening, the plan's `height` and `radius`.
- **Spatial systems follow without further changes,** because they already read the plan's `height`, `radius` and `form.size`: selection markers and Look closer framing (`livingSelection.ts`), Dweller homes (`radius + 5`), roots between fused organisms (start inside each footing at 0.34 × radius, thickness from the size), community marks, and competition for light in the population simulation. Shade on the ground and the plants' shade habitat are read from the meshes as drawn.
- **Grounding:** organisms are generated at their size (anchored, grounded), not scaled after the fact. The study's 1.5 m sink and pivot are gone.
- **Density, modestly higher:**

| Setting | Before | Now |
|---|---|---|
| Founder spacing | 300 m | 250 m |
| Good cells per founder | 24 | 20 |
| Maximum founders | 14 | 17 |
| Loners | 7 | 9 |
| Largest colony | 9 | 10 |
| Maximum organisms | 60 | 70 |
| Recruit distance from its member | 46–96 m | 72–130 m (so 60 m+ structures stand clear of their member) |
| Clear room around a recruit | 46 m | 66 m |

  Habitat-based placement is unchanged: founders on prime ground, loners on middling ground far from others, recruits in their member's lee.

## Results (default seed unless noted)

| | Before | Now |
|---|---|---|
| Organisms | 39 | 47 (seed 12345: 50; seed 777: 53) |
| Root links | 4 | 7 (seeds: 10 / 4) |
| Nearest-neighbour distance, quartiles | — | 72 / 72 / 91 / 317 m (open space between colonies kept) |
| Footprint discs overlapping by more than 5 m | 0 | 7 pairs, but **no actual mesh overlap** (built footprints on a 2 m grid share 0 cells in all 7) |
| Planning time | ~260 ms | ~300–1,200 ms (main thread, once per load) |

**Sample from the world pipeline** (`refinedWorldForm` plus built meshes). Keep / Reach / Lift are the form's height, cantilever-reach and undercroft multipliers:

| Organism | Habitat | Class → drawn | Width | Height | Keep / Reach / Lift, habitat → final | Supports |
|---|---|---|---|---|---|---|
| LA-01 (reference) | resource 0.47, lit, crowded | 1 → 0.74 | 90 m | 34 m | 1/1/1 → 1.25/0.95/1.30 | outlier, 2 piers + reference pier |
| LA-18 | poor (0.21), exposed, alone | 0.55 → 0.78 | 67 m | 17 m | 0.81/0.95/1.05 → 0.85/0.95/1.25 | free, 4 piers + reference pier, 1 arm |
| LA-23 | poor (0.23), ridge top | 0.50 → 0.75 | 73 m | 15 m | 0.71/0.95/1.04 → 0.85/0.95/1.08 | free, 4 piers + reference pier, 1 arm |
| LA-02 | rich (0.91), hollow, by water | 0.83 → 0.95 | 86 m | 54 m | 1.26/0.73/0.75 → 1.40/0.95/0.87 | free, 5 piers + reference pier, 2 arms |
| LA-03 | rich (0.91), hollow, by water | 0.86 → 0.97 | 86 m | 56 m | 1.24/0.70/0.75 → 1.40/0.95/1.02 | free, 3 piers, 2 arms |
| LA-10 | rich (0.77), half-hollow, by water | 0.81 → 0.95 | 77 m | 54 m | 1.39/1.07/1.05 → 1.40/1.00/1.04 | free, 5 piers, 2 arms |

**What drives what:**
- **Scale:** width, 67–90 m, from the class.
- **Habitat:**
  - **Height:** 15–17 m on poor, exposed ground against 54–56 m in rich hollows. That's a ratio of height to width from about 0.2 to 0.65, so the forms are not uniformly resized.
  - **Branch arms:** rich, lit ground grows two.
  - **Habitat multipliers:** keep, reach and lift before the seed.
- **Seed:** LA-02 and LA-03 share almost identical habitats but differ in undercroft lift (0.87 vs 1.02), pier count (5 vs 3) and whether the reference pier stays. Mass proportions and the extra mass also come from the seed.

## Limitations

- **Reach barely varies in the world.** `refinedForm` floors the final reach at 0.95, which absorbs most of the habitat's reach variation (habitat 0.70–1.07 → final 0.95–1.00). Widths still differ through scale and arms. Loosening that floor would make reach more expressive, but that's a change to `overhangRefined.ts`, which the lab shares, so I left it.
- **Outliers are rare.** In this sample only the reference has one; the others are free cantilevers on piers. This is unchanged by scale: the outlier needs resource above 0.42, room and dry ground, and then the seed's draw.
- **Widths are approximate.** Width per unit of size varies from about 75 to 98 m, so widths land between about 60 and 95 m.
- **First load rebuilds everything.** The world's IndexedDB mesh cache is keyed on the form, which changed for every organism, so the first load rebuilds all 47 in the worker (about 2–4 s each, spread across the queue). After that they are cached.
- **Main-thread stall:** the longest stall during world load and Look closer was 1.6 s. I didn't attribute it; vegetation and shade-habitat reads run on the main thread, and there are now 8 more organisms to read.
- **Classic style** (`?la=classic`): its reference organism is still grown by the classic worker path without a form, so at 120 m; only its plan radius and height are scaled. Classic is the legacy option, not the default.
- **Habitat Study:** it reads the world's population, so its Original is now the 90 m reference; its fixed design-envelope cameras frame it with more margin.
