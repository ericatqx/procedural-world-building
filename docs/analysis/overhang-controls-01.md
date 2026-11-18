# Overhang controls 01

> Implements [overhang-controls-plan.md](../planning/overhang-controls-plan.md). Lab only. `livingOverhang3.ts`, the main world, the lifecycle, Strata and Porous are unchanged.

## What was added

- **`architecture-lab/overhangControls.ts`**: `applyOverrides(form, overrides)`, applied after the habitat (`formFromHabitat`) and the seed (`refinedForm`), and before `growOverhang3` grows the form and its lifecycle.
  - **Height**, **Reach** and **Undercroft** multiply `keep`, `reach` and `shelfLift`, clamped to the generator's existing ranges. At 1, the form is returned untouched.
  - **Supports** is either *Seed supports* (the default, unchanged), *Carried* (outlier on), *Braced* (no outlier, at least three piers: the seed's own plus evenly spaced ones), or *Free* (no outlier, no extra piers, only the reference pier).
- **`labWorker.ts`**: `Spec.overhang?`, and one line in the Overhang path. It applies to both the Refined and Original variants.
- **`ArchitectureLab.tsx`**, Individual section for Overhang: three sliders (showing "× 1.00 · as grown" until moved), the four support buttons, and **Reset to seed**. Moves are debounced like the seed. Settings apply to every specimen in view (comparisons and sheets) and to every lifecycle stage. The overrides join the spec only when set, so the worker cache works as before.

## Validation

Seed 7 at the reference habitat unless noted. The checksum is a weighted sum of all vertex positions, so two different meshes give different values.

| Case | Vertices | Height × span | Checksum |
|---|---|---|---|
| No override | 28,594 | 63 × 141 m | 69780192.047 |
| All multipliers at 1 | 28,594 | 63 × 141 m | **69780192.047, identical** |
| Height 0.7 / 1.4 | 24,679 / 29,573 | 45 / 76 m high | changed |
| Reach 0.7 / 1.5 | 26,546 / 29,891 | 124 / 156 m span | changed |
| Undercroft 0.8 / 1.4 | 26,691 / 30,439 | shelf lower / higher | changed |
| Carried | 28,594 | | identical to the default (seed 7 already grows the outlier) |
| Braced / Free | 25,528 / 23,607 | 115 m span (outlier removed) | 3 piers / 0 extra piers |
| Height 1.3 + Braced: Juvenile, Growing, Senescence, Death | 14,067 / 25,542 / 29,578 / 24,326 | 55 / 76 / 76 / 75 m high | each stage regrows from the overridden form |
| Seed 23, then with Height 1.3 + Reach 1.3 + Free | 15,781 → 18,033 | 41 → 51 m high | |
| Open ridge, same override | 30,197 → 26,148 | 53 → 57 m high | |

**In the lab:**
- The default is 28,594 vertices; Braced gives 25,528, the same as the console; Reset to seed returns to 28,594.
- The specimens build in the existing workers, and the page's longest pause was 31 ms.
- Each Overhang specimen takes about 2–4 s to grow, as before.

## Limits

- **Re-rolled detail.** Height, and switching the outlier on or off, can re-roll fine detail (strata bands, cleft, recesses), because the generator draws them from one random sequence. The seed's arrangement is kept. This is noted in the Height tip.
- **Clamping.** Where the habitat already makes a tall keep (the open ridge), Height's upper range is partly clamped at the generator's limit of 1.5, so ×1.3 there adds only 4 m.
- **Supports on Original.** Braced and Free on the Original variant add a composition the Original didn't have, which is the only way to pass piers. This is explicit only: the default Original is untouched.
