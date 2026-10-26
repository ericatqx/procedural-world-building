# Backlog and Roadmap

> What happens next in Shadow Ecology 0.3, in priority order. The concept is in [Shadow Ecology planning](shadow-ecology.md); the evidence so far for Living Architecture is in [Living Architecture experiments](../analysis/living-architecture-experiments.md). Dates are not fixed here; order and dependencies are.
>
> **Priority:** **Now** (blocks other work) · **Next** (follows from Now) · **Later**. **Evidence** is what each item must leave behind, so the work shows up in the documentation as research and method, not only as features.

## 1. Living Architecture: research and feasibility (Now)

Decide which growth representation will carry the population, on stated criteria, before building more.

- Review the retained approaches (`overhang3`, `voxel`, and the earlier variants) against the brief in the [experiments](../analysis/living-architecture-experiments.md#the-question): connected at every age, hierarchy, readable causes, continuous growth, affordable.
- Review the variants whose outcome is not recorded (`strata`, `grown2x`, `grown`, `composed`) and add what was seen.
- Decide among: the per-age mesh path, a connected-by-construction occupancy path, or a hybrid. Record the decision and its reasons as a decision, not a result.
- **Evidence:** matched stills of each finalist at the same ages in `docs/images/`; build and display cost measured on a real display; one paragraph per approach on which criteria it meets.
- **Precedents:** for each rule that survives, fill in its row in [Precedent Research](shadow-ecology.md#precedent-research): principle, transformation, and the source consulted.
- **Open:** can a growth rule reach the silhouette that `overhang3` composes by hand?

## 2. Scale and resolution validation (Now, alongside 1)

- Check what survives at Overview, Approach and Explore for the finalists: living unit, organism, landmark ([Visual Direction](shadow-ecology-visual-direction.md#living-architecture-scale-and-legibility)).
- Compare grid and mesh resolution against the 4.1 km island and the Explore camera.
- **Evidence:** stills at the three camera distances; the smallest feature that stays legible at each.

## 3. Week 8: Agents and Scale exercises (Next; course)

- The Week 08 brief is not recorded in this repository yet. Add its scope here when it is issued.
- Intended use: agents as a way into creature behavior, and scale as the lens for item 2 and for how many organisms the world can hold.
- **Evidence:** a tutorial note in the usual form ([template](../tutorials/_template.md)) with a failures-and-changes table and a references section.

## 4. Vegetation and habitat systems (Next, after 1)

- Rebuild vegetation and habitat for 0.3 from the 0.1 and 0.2 rules: habitat as remembered shelter × moisture × footing; vegetation as the opposite requirement. See [Current Implementation](shadow-ecology.md#current-implementation-prototype-01) and [Known gaps](shadow-ecology.md#known-gaps).
- Use the shade and undercrofts that Living Architecture actually makes; do not start until its form is settled enough to cast meaningful shelter.
- **Evidence:** a stated rule per layer; an observed comparison of habitat with and without the architecture's shade.

## 5. Creature behavior and ecological feedback (Next, after 4 and Week 8)

- Creatures as occupants of habitat, interacting with architecture through environmental feedback, not language ([Current conceptual discoveries](shadow-ecology.md#current-conceptual-discoveries); [Creature Explorations](shadow-ecology-visual-direction.md#creature-explorations)).
- One behavior and one form first; the hybrid directions stay exploratory.
- **Evidence:** the behavior rule, the feedback it produces on shelter or growth, and a short observed run.

## 6. Population integration and visual refinement (Later, after 1, 2 and 4)

- Move the chosen representation into the population: per-organism forms from ground, light, water and neighbours; kin connections; lifecycle from establishment to senescence and regeneration.
- Refine playback (no flashing at fast speeds), material and silhouette, and balance (for example how many organisms are senescent late in the timeline); the current numbers are provisional.
- Keep World Time (Daily Cycle and Evolution) and Inspection working through the change.
- **Evidence:** a population view at several World Years; frame rate on a real display.

## 7. Documentation and final presentation (continuous; shape it as work lands)

- Keep [planning](shadow-ecology.md) as the source of truth for concept and status; add a result to the [experiments](../analysis/living-architecture-experiments.md) when an approach is tried, with its label (Observed, Measured, Code-derived, Unverified).
- Fill [Precedent Research](shadow-ecology.md#precedent-research) as sources are read; do not mark a precedent studied without a source recorded.
- Add 0.3 stills to `docs/images/` and update the README when a result is real.
- Later: a 0.2 analysis in the style of [0.1's](../analysis/shadow-ecology-01.md); a 0.3 analysis once the representation is settled; an in-app guide for 0.3; the final presentation assembled from the documented decisions and failures.

## Original feature list (historical)

The first backlog, before the project had a concept. Kept for reference; most of it is now addressed.

- Procedurally generate terrain with varied elevation (done: Week 03, 0.1–0.3)
- Generate mountains, valleys, and other landforms (done)
- Add different biomes (not pursued; a wetland micro-biome is an [exploratory idea](shadow-ecology.md#ecological-inspirations-exploratory))
- Add water / oceans (lakes, rivers and falls in 0.1–0.3)
- Generate vegetation (0.1 and 0.2; not yet in 0.3)
- Simulate weather (0.2, and 0.3's weather timeline)
- Generate cities or settlements (not pursued; Living Architecture is the structure layer)
- Add creatures or populations (organism populations in 0.3; creatures not yet)
- Give agents different behaviors (Week 07 studies; Week 08 next)
- Add a day/night cycle (done)
- Create a history for the world (Parallel Worlds in 0.2; Branching Histories in Week 07)
- Allow users to explore the world interactively (Explore in 0.3)
