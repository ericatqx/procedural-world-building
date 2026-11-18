# Strata family 01: a minimal procedural generator

> Implements steps 1–3 of the [Strata family plan](../planning/strata-family-plan.md). Mature form only; seed variation only (no habitat adaptation); not in the world. Where: Labs → Architecture Lab → **Strata**.

## What was built

| File | What |
|---|---|
| `architecture-lab/fieldMesh.ts` | Shared, worker-safe meshing for design-frame fields: the coarse-to-fine fill, meshing with terrain clipping and outward winding, field normals, and a connected-pieces count |
| `architecture-lab/strataField.ts` | `StrataPlan` (every number of the form), `REFERENCE_PLAN`, `strataField(plan)` (the field, the same arithmetic as Strata Refined), `strataBounds(plan)` |
| `architecture-lab/strataDesign.ts` | The controls, `seedControls(seed)`, `designStrata(controls)` with derived joints, shelf limits, `planChecks` |
| `architecture-lab/labWorker.ts` | A `strata` branch, `growStrata`. `Spec` gains an optional `morph` (controls set by hand) |
| `architecture-lab/families.ts`, `ArchitectureLab.tsx` | Strata as a third family. Seven sliders in **Individual** (each shows the seed's value until moved, then "· set"), **From the seed** and **Reference** buttons, a **Checks** line under Specimen. The lifecycle slider is hidden for Strata; the comparison and contact-sheet lists include it |
| `habitat-study/compose/forms.ts` | Strata Refined now comes from `strataField(designStrata(REFERENCE_CONTROLS))` and the shared mesher |

Overhang and Porous generation code is unchanged, and both still build.

## Controls

All seven fitted the same implementation, so Swing and Crease are included:

| Control | Range | Reference | Effect |
|---|---|---|---|
| Reach | 0.75 – 1.25 | 1 | blade length |
| Rise | 0 – 2 | 1 | lift toward the tip (0 level) |
| Mass | 0.8 – 1.25 | 1 | overall height; taller is narrower and leans more |
| Support | 0.5 – 0.85 | 0.73 | where the leg meets the blade: void width |
| Tiers | 0 – 3 | 3 | shelves, in order: great low shelf, leg shelf, small high shelf |
| Swing | −1 – 1.5 | 1 | blade curve in plan; negative curves the other way |
| Crease | 0 – 1.6 | 1 | roof fold, from smooth (0) to folded |

`seedControls(seed)` draws each control deterministically from the seed. The draws favour the middle of each range. Tiers favours 2–3, and one seed in four curves the blade the other way.

## Connections

Every joint is computed from a point on the part it grows from, and moves with that point:
- **Leg head:** the blade's underside at Support, at the same fraction of the blade's width as in the reference.
- **Leg root:** the mass's face at the arch's height.
- **Root foot:** halfway between the two.
- **Shelves from the mass:** rooted on the mass at their own heights; each is also a ledge ring, so a shelf always leaves the mass on a ledge.
- **Leg shelf:** at the same point along the leg's sweep.
- **Mirroring:** when the blade curves the other way (Swing < 0), the shelves mirror to the other side of the mass so they stay under the blade.

Each joint is written as the reference position plus how far its anchor moved. A shelf whose tip would stand farther outside the blade, or higher into its underside, than the reference's own shelf does is shortened until it doesn't.

## Validation

**Reference.**
- `designStrata(REFERENCE_CONTROLS)` equals `REFERENCE_PLAN` exactly, number for number.
- The Habitat Study's Strata Refined mesh is unchanged: same vertex checksum (127045989.38867188), and Blade's is unchanged too.
- In the lab, Reference gives the same checks as the study (32 m void, 14 m headroom, 3 shelves).

**Seeds and extremes** at 60 m. A piece count of 1 means nothing detached:

| Case | Pieces | Void width | Tallest open space | Shelves (lengths, design m) |
|---|---|---|---|---|
| Reference | 1 | 32 m | 8.3 m | 38 / 24 / 28 |
| Seeds 1–6, 7, 23 | 1 each | 22–39 m | 5.5–15 m | 1–3 shelves |
| Reach 0.75 / 1.25 | 1 / 1 | 22 / 41 m | 8.3 / 13.8 m | |
| Rise 0 / 2 | 1 / 1 | 32 m | 8.3 m | |
| Mass 0.8 / 1.25 | 1 / 1 | 31 / 33 m | 6.5 / 10.8 m | |
| Support 0.5 / 0.85 | 1 / 1 | 20 / 38 m | 8 / 14 m | |
| Swing −1 / 1.5 | 1 / 1 | 32 m | 9.5 / 8.3 m | 38 / 24 / 28 after mirroring |
| Crease 0 / 1.6 | 1 / 1 | 32 m | 8.3 m | |
| Tiers 0 | 1 | 32 m | 13.8 m | none |
| All extremes, short / tall / near / swung back | 1 | **14 m** | 7 m | |
| All extremes, long / low / far | 1 | 48 m | 11.5 m | |

No detached supports, floating shelves or invalid meshes appeared in any case. No void closed; the narrowest is 14 m, at the combined extreme.

**Performance.**
- One specimen takes ≈ 2.3–3.4 s, on a worker.
- Six seeds build in parallel across the pool in ≈ 2.8 s.
- The main thread's longest stall is 38–123 ms, while the mesh is handed over for display. The page stays responsive throughout.
- The lab doesn't run the study's clay shading bake (ambient occlusion), which was the main cost there.

## What remains limited

- **Shelves can be shortened a lot.** The rule that keeps shelves under the blade sometimes takes the small high shelf from 24 m down to about 13 m (Mass 0.8, Crease 1.6). It stays attached but becomes minor. A better rule would move the shelf rather than only shorten it.
- **Narrow voids.** Support near the mass combined with short reach gives a 14 m void. It's open but cramped; the next pass could limit Support by Reach.
- **Large parts are fixed.** The shelves' lobe phases, the ring phases and the leg's radii don't vary with the seed. Seeds differ in proportion and arrangement, but not yet in surface character.
- **The roof top is unchanged in kind,** as you decided: it's left for surface treatment.
- **Habitat:** Strata reads only Size. The other habitat inputs have no effect yet.
- **Lab camera:** the single-specimen view frames Strata low and side-on; the framing was set up for the Overhang.
- **Growth and decay are not modelled:** every age shows the mature form, and the lifecycle material shows it as living tissue.
- **The Habitat Study still builds Strata on the main thread,** with its clay shading bake (≈ 9 s cold). It could post the same Spec to the lab's worker pool; that wasn't in this pass.
