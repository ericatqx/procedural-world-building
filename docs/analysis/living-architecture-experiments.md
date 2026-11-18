# Living Architecture — Experiments

> A record of the Living Architecture explorations in Shadow Ecology 0.3: what each tried, what it showed, and what is still unknown. **No Architecture approach is finalized.** `overhang3` (the LA-01 reference at World Year 120) is the working reference for morphology; which growth representation will carry the population is an open decision.
>
> Concept and the chain: [Shadow Ecology planning](../planning/shadow-ecology.md#living-architecture) · Look and scale: [Visual Direction](../planning/shadow-ecology-visual-direction.md#living-architecture-scale-and-legibility) · Precedents: [Precedent Research](../planning/shadow-ecology.md#precedent-research) · Roadmap: [Backlog](../planning/backlog.md)

## How to read this

Each statement carries one of these labels.

| Label | Meaning |
|---|---|
| **Observed** | Seen in the running app (the in-app browser or the designer's own screen). "Designer's review" marks a judgement made by the designer, not re-checked here. |
| **Measured** | A number from a run of the code (Node, or the browser console) on the default seed `909387746`. One seed, one machine, informal: not a benchmark. |
| **Code-derived** | Follows from reading the implementation or its header comment; not verified by looking at the result. |
| **Unverified** | A hypothesis or a hope. Needs evidence before it is used as a conclusion. |

## The question

How can a sessile, mineralizing organism grow into something that reads as architecture without being built from architectural parts? The brief for Living Architecture (see [planning](../planning/shadow-ecology.md#living-architecture)) asks, for any approach:

1. **Connected and grounded at every age.** No floating tissue, open shells or detached parts.
2. **Hierarchy.** A substantial primary mass (the keep), layered projecting shelves, load-bearing supports, and meaningful negative space (undercrofts, arches) that results from growth, not from missing geometry.
3. **Causes that can be read.** Light, moisture, structural load, competition and age each visibly shape the form.
4. **Growth that is continuous in time.** Scrubbing and playing years should not flash, blank or swap whole forms.
5. **Affordable.** Acceptable cost to build and to show, with room for a population of organisms.

The target direction ("Interlocking Living Strata", a hybrid stratified language) and its architectural and natural references are in [Precedent Research](../planning/shadow-ecology.md#precedent-research). How much each reference was studied is stated there.

## Comparison

All variants are reachable by URL on the 0.3 page (`?architecture=<flag>`, in `app/src/project03/LivingArchitecture.tsx`). The default is `overhang3` with the population. The earlier variants are kept unchanged for comparison.

| Flag | Representation and goal (code-derived) | Outcome | Limits and failure | Status |
|---|---|---|---|---|
| `grown`, `composed` | Limbs and ribs grown by tips; a hand-composed Hall, Gate and Pavilion kept as a comparison | Not recorded here | The hand-composed build is a human-designed reference, not a growth result | Kept for comparison |
| `grown2` | 2 m cells of thin sheets and pillars on a resource economy: sheets earn from light and water, cost upkeep, are funded from one reserve and pruned | **Observed (designer's review):** flat, roof-like canopies | Code-derived: sheets are thin plates and a cell survives only if it pays for itself. **Unverified:** that the economy is what produced canopies | Superseded |
| `grown2x` | Grown2 with a structural cost and a finite water supply (Experiment 1) | Not recorded here | Not recorded here | Superseded |
| `grown3` | Solid 2 m cells (skin and core) that earn only through open faces; support run limited by thickness (Experiment 2a) | **Observed (designer's review, covering `grown3`, `grown3b` and `grown3c`):** tall columns or thick towers, little meaningful negative space | Code-derived: cells earn only through open faces and a run limit tied to thickness. **Unverified:** why columns result | Superseded |
| `grown3b` | Grown3 with a slenderness limit (Experiment 2b) | Covered by the review above | Not recorded separately | Superseded |
| `grown3c` | Grown3 with persistent scaffold tissue, a dry spell and regrowth (Experiment 3a) | Covered by the review above | Not recorded separately | Superseded |
| `network` (P0) | Continuous graph in metres; tips choose headings by light, crowding, gravity, terrain; oriented boxes accrete differentially (no economy, no ecology) | **Observed (designer's review):** post-and-lintel scaffolding with too little solid mass | Code-derived: the surface is the hard union of oriented boxes, with no blending; the rates and caps are prototype numbers, not ecology | Superseded |
| `field` (P1) | A density field on a 2 m grid grown by orientation, light and moisture speeds, with diffusion as surface tension | **Observed (designer's review):** smooth blobs and mounds, no openings. **Measured:** 3,728 solid cells by default; 4,765 with the grid turned 30°; 47,079 at 45°; 7,697 and 10,583 for two start variations | Result depends on grid orientation and start; sits near a threshold between dissolving and running away; surface tension prevents thin or planar features | Rejected as a representation |
| `strata` (Stage 1) | Thick oriented lobes laid down in epochs on a distance field; light, ground supply and facing score faces; a run limit makes buttresses; shaded lobes recede, which opens spaces (header comment) | Not recorded in the repo | Not recorded in the repo | **Needs the designer's review** |
| `overhang`, `overhang2` | Form first, not growth: a handful of tissue masses (keep, great shelf, foot, curtain, undercroft…), each with a developmental reason, as a distance field at 0.8 m | Not recorded here; `overhang3` revises `overhang2` (header comment) | Code-derived: a composed form with parameters, not an emergent one | Reference line |
| `overhang3` (LA-01) | The Overhang revised as a lifecycle: two bodies, shelves grown along trajectories, supports where the load goes, receding tissue leaving openings; each sample has an arrival and a decay age | **Observed:** the reference at World Year 120; used by the population. **Measured:** about 5 s to build with its lifecycle (Node); a mesh for one age takes about 110–150 ms | Each age is a separate mesh: whole-mesh swaps, worker latency and flicker (see below). Form is set by hand-set masses | Current reference |
| `reveal` | The mature `overhang3` mesh drawn only where tissue has "arrived", with a thin collapse at the front, in one shader | **Observed:** at intermediate ages the form is a cut-open shell with ragged fronts and floating fragments. **Measured:** vertex positions are identical to the reference mesh; about 0.3 s extra to build the attributes | It can only reveal a finished surface | Rejected for intermediate ages |
| `growth` (loft / SDF) | 21 closed tube parts (foundation, keep, shelves, props, shoots), nodes updated each frame; the vertex shader shrink-wraps each vertex onto the smooth union of the parts' distance fields; strata cut by height; late-life thinning and renewal by node | **Observed:** the mature form read as one merged mass with fillets, props and undercroft. **Designer's review:** floating masses at early ages, broken and overlapping surfaces, an increasingly incoherent silhouette | Connection depends on the shader's projection, so it is not guaranteed; per-vertex cost was not measured | Rejected by the designer |
| `voxel` | Occupancy on a 1.5 m grid, grown in the worker (96 ticks); a cell is only added next to an existing cell; light, moisture, load, strata, overhang run and prop rules; surface nets on the blurred occupancy at 40 ages, cached | **Measured:** zero floating voxels at ticks 10, 25, 40, 55, 70 and 95 (flood fill from the ground, Node); 8,243 voxels at the end; growth 0.8–1.4 s in Node; one surface 20 ms on average and 112 ms at most (browser). **Observed (in-app browser, Years 48, 72, 120):** grounded stout cylinder, then a tower with a saucer-like shelf, a lower shelf and a row of props | Plain silhouette (a tower with one dominant shelf and regularly spaced props); growth stalls near tick 55; rounded, slightly rippled surfaces; steps between 40 stored ages, no morph | **Awaiting the designer's visual review** |
| `skeleton` | A tree of nodes grown tip by tip, each from its parent (trunks, limbs, roots, props, late shoots), steered by light, crowding and ground; thickness from the load carried (pipe model); capsule fields merged by smooth union with strata cut by height, meshed at 48 ages (0 to 3); per-node weathering, subtree loss and renewal (`livingSkeleton.ts` header) | **Observed (designer's review):** growth and decay are visibly continuous, with no noticeable flicker and no floating structures while scrubbing. **The morphology is not accepted:** it still reads as stacked horizontal stone plates, with weak structural hierarchy, limited negative space and little architectural or habitat-forming quality. **Measured (Node, seed `909387746`):** 396 nodes grown in 47 ms; flood fill from the ground found 0 floating cells at ages 0.1 to 2.9 except 3 cells at age 2.2 (cause not isolated); per age, 3–15 ms for the field and 20–54 ms for the mesh; **browser:** 48 surfaces averaged 24 ms (maximum 70), no console errors | Code-derived: every limb gets the same flattening (1.9 wide to 0.7 tall), thickness follows one pipe-model rule, and forking produces many similar limbs, so tiers resemble one another; props are few and sit under the plates; cavities and arches are not designed; fusion between members is not implemented. **Unverified:** that these are the causes of the plate-like read | Morphology rejected by the designer; implementation kept |

## What the experiments suggest

These are the readings the evidence supports so far. They are not proven.

- **Connectivity is easier to guarantee by construction than to repair afterwards.** The voxel prototype can only add a cell beside a cell that is there, and the check found no floating tissue. The shader-projection approach and the stage meshes both had to show a connected form at every age and were seen failing to (Observed: `reveal`, and the designer's review of `growth`).
- **Each representation settled into a characteristic form** (roofs, columns, scaffolds, blobs). One reading is that the representation and its scoring pressure together decide the form, not the ecology rules alone. This is a **hypothesis**: the experiments changed the representation and the rules at the same time, so they cannot separate the two.
- **Hand-set composition (`overhang3`) produced the form the designer accepted; emergent growth did not yet.** The open problem is getting a comparable silhouette from rules that stay legible as causes.
- **Continuity and connectivity do not make architecture.** The `skeleton` experiment met the designer's tests for continuous growth and decay and for connected structure with fast per-age meshes (Observed, designer's review; Measured above), yet its form was rejected as stacked plates. This separates two problems: keeping an organism connected and continuous, which parent-dependent growth and occupancy both handled, and producing a convincing silhouette, which none of the emergent approaches has yet done. **Hypothesis:** the missing ingredient is structural differentiation (members that differ in kind and section, designed or emergent cavities and supports), not a better growth representation. Untested.
- **Per-age meshes carry a cost that shaders and occupancy avoid.** Code-derived: the flicker had specific causes (a whole mesh replaced on arrival; the shader's age running ahead of a stale mesh; stage requests queued behind builds). Fixes were made (a dissolve between two meshes, each drawn for the age it was built for, requests ordered by distance). Observed: no console errors in playback tests. **Unverified:** whether the flashing is gone to the eye, because the in-app browser ran at about three frames a second.

## Morphology sketch studies (removed; not accepted)

Three small studies tried new generative principles on a 0.8 m voxel grid (about 38 m at the height cap), isolated from 0.3, then meshed with the shared surface-nets mesher. The designer reviewed all three and none met the standard for Living Architecture; the code was removed, and generation also caused significant browser slowdowns. Results below are from the author's viewing of three seeds each and a Node run; they are not a designer's review of each study.

| Study | Rule | Result |
|---|---|---|
| Accretion and hollowing | Wind-borne material sticks where it first lands if the tissue is still fed through a short path to ground seeps; a separate sun resorbs thickly self-shaded surface tissue | **Observed:** the most promising: at a steep wind angle, one seed gave a tall twin-legged mass with a window, others tall leaning slabs that read as standing stones; at a low angle, a flat ramp. **Measured (Node):** 34–38 m, 1,900–3,000 m³, about 0.5–1.2 s per specimen |
| Differential growth and redistribution | Uneven, leaning growth from several roots; overreaching parts drop a prop or fall; loaded supports thicken | **Observed:** blocks and monoliths on narrow necks when constraints were loose, small lobed or creature-like shapes (one read as a rabbit) when tight; no convincing spans |
| Cumulative growth, erosion and repair | A wind that veers over the organism's life; weathering of old exposed tissue; scar growth at wounds; rot of enclosed old tissue | **Observed:** generic rock-like blobs, then slender leaning spires; history was weak in the form |

**Interpretation (hypothesis, untested):** local voxel rules with no directional field settle into blobs or prisms; only a directional environmental field (Accretion's wind) gave a distinctive silhouette, and its result was still too plain. Two causes were seen in code and results: constraint rules that delete overhangs force vertical extrusions, and uniform growth rules fill the available grid. A through-flow carving stage for passages was proposed and not tried. Generation ran on the main thread, so a worker would be needed for any further use.

## Population built around the reference

Separate from the representation question, 0.3 already runs a population of Living Architecture organisms (code-derived; see the headers of `livingEcology.ts`, `livingLife.ts`, `livingWorker.ts`):

- An environment grid (light, moisture, soil, resource, suitability) places founders, loners and recruits; each organism's size, height, reach, opening direction and outlier follow from its ground, light, water and neighbours. Generation is deterministic from the seed.
- A yearly simulation (shade, root draw, vigor, fusion between mature kin) gives each organism its own age, later life (growth, recession, regeneration) and links. World Year 120 is the reference organism's calibration, not an event for the ecosystem.
- Meshes are built in a worker, cached in the browser, and shown first as a coarse form.
- **Measured (Node, seed `909387746`):** 42 organisms planned, 35 present at Year 120, 7 links by Year 300.

The balance of this population (for example how many organisms are senescent by Year 300) uses provisional numbers and has not been reviewed.

## Unresolved

1. **Which representation carries the population.** Candidates: the per-age mesh path of `overhang3` (known look, known flicker), a connected-by-construction occupancy path (`voxel`, known grounding, plain look), or a hybrid (for example hand-set composition for the mass and occupancy rules for growth). Not decided.
2. **Can a growth rule reach the silhouette that `overhang3` composes by hand?** Needs a stated comparison on the same criteria, with images at the same ages. After `skeleton`, the open part is the silhouette, not connection or continuity.
3. **Scale and resolution.** At 1.5 m voxels and 2.8× coarse forms, which features survive at Overview, Approach and Explore? Not validated.
4. **Performance at population scale.** Per-organism cost is known only for single organisms in Node. Frame rate has not been measured on a real display.
5. **Evidence for the morphology claims** (that stratification, cantilever and undercroft rules correspond to the architectural and natural precedents) is still to be collected; see [Precedent Research](../planning/shadow-ecology.md#precedent-research).

## Evidence still to be gathered

- Matched stills of each retained approach at the same ages, saved under `docs/images/`.
- Frame rate and build cost on the designer's display for the finalists.
- A short statement, per approach, of which brief criteria it meets, with the image or number that shows it.
- Review notes for `strata`, `grown2x`, `grown`, `composed` and the earlier comparisons, which are not recorded here.
