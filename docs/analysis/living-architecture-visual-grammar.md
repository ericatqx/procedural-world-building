# Living Architecture: visual design guide

The two Living Architecture morphologies are treated differently. **Overhang is refined**: the world's own generator stays the foundation and gets more controlled variation. **Porous Growth is redesigned**: composed first from a few chosen silhouettes, then grown. This guide is what the Architecture Lab prototypes are judged against.

## 1. Shared principles

- **Fictional sessile organisms.** Not human architecture (no flat roofs, grids, right-angled rooms, regular repeats) and not random rock (no shapeless lumps).
- **Hierarchy.** One primary mass, at most one secondary mass, then details. No set of equal parts.
- **Silhouette first.** Blur the form to a flat shape at a distance: it must still read as one object with one gesture, and differ from its siblings.
- **Openings are few and ranked.** One or two large ones, a few secondary ones, small ones only as rhythm. Every opening leads to a space you can name (a shelter, a passage, a window).
- **Thickness is a decision.** Walls and webs stay thick next to their openings. Nothing is a stick, and nothing is a paper-thin plate unless it is a deliberate edge.
- **Every support carries something and ends in the ground.** No floating mass, no pillar that holds nothing.
- **Ground contact is a footprint.** Wider than the form above on at least one side, following the slope, never a point or a flat disc.
- **Variation changes composition, not only scale or surface.** Seed and habitat change proportions, the arrangement of masses, the direction of reach, supports and openings. They never change which forbidden shapes are allowed.

## 2. Overhang: refinement of the original

**Foundation.** The world's Overhang (`livingOverhang3.ts`) stays: a keep of masses on a plinth, strata ledges, a cleft, a great shelf that cantilevers toward the light, an outlier body with a lower shelf, a load rib, buttress fin, pier, toes, mezzanine, curtain, old shelf, and the shaded undercroft. The original remains selectable in the Lab ("Original (world)") and in the world, unchanged.

**What the refinement varies (the seed, within the original's identity).** The strong primary tower stays nearly upright (a lean of a few hundredths at most) and so does the cantilever it carries; habitat never removes either (the keep is floored at 0.85 and the reach at 0.95 of the reference).

| Dimension | Range of variation |
| --- | --- |
| Keep masses | height 0.6x to 1.9x of each of the three masses, footprint 0.8x to 1.35x, where the middle and mouth-side masses stand, an optional second tower behind (about half of seeds) |
| Cantilever | length 0.85x to 1.5x, thickness 0.8x to 1.45x, width 0.8x to 1.2x, rise and fall, swing toward or away from the water side |
| Supports | the outlier takes the shelf's end, or the shelf is a free cantilever (about a third); 0 to 3 extra raking piers, more under longer or free reaches; the original pier may be dropped |
| Outline | how loose the outlines are, whether the old shelf survives |

(A later four-composition version, tower / twin / hub / terrace, is kept in `overhangCompositions.ts` and is not offered: it was judged worse than this one.)

**Biology and lifecycle.** The Overhang is a fictional sessile biomineralizing organism: sunlight (through symbionts in its skin) is the only energy; water and dissolved minerals and nutrients are material; living tissue deposits a mineral skeleton. The habitat rules (open ridge compact and wind-resistant, hollow taller, shore broader where minerals allow, crowded redirected, poor supply smaller) and the seven-stage lifecycle (establishment, juvenile, growing, maturity, senescence, death, remains) are specified in [`docs/planning/shadow-ecology.md`](../planning/shadow-ecology.md#the-overhang-as-an-organism-biology). Maturity is the approved form; the structure keeps its identity through the later stages (the tower and cantilever are weathered, then break, not replaced).

**Habitat** acts on top, as in the world (`formFromHabitat`): light lengthens reach, richer ground raises the keep, exposed ground spreads it, crowding unbalances it, water lengthens roots and toes.

**Forbidden:** a mushroom or anvil (a cap on a central stem); an oversized curved shell; a table or dolmen (a slab on posts); symmetry about any axis; a shelf that is thin and long with no supports; shelves stacked like platters; copy-pasted silhouettes (two seeds that differ only by scale).

**Accept a change only if** the original and refined sheets, side by side under identical conditions, show different arrangements, not just proportions, and the identity (keep, cantilever, supports, undercroft) is still recognisable.

## 3. Porous Growth: experimental, paused

**Direction.** Reference images 4 and 5 are the primary guide: a tall, continuous mass with a scalloped flank (a broad lip, then a narrower waist, tier on tier), large rooms under the lips, big arched openings, thick walls, layered surfaces. Images 1 to 3 give the smooth skin, the deliberate hole, and ribs that leave a spine and rejoin it. Not low, not tubular, not a single arch.

**One family: a vertical cluster.** Two to four tall, thick towers rise from one fused plinth. Each is a wall-like column (a tower is at least about twice as tall as it is wide) built in 3 to 7 tiers, twisting a little. They grow together: feet merged in the plinth; arched bridges join neighbours at heights both reach; one flying buttress comes down to root on the outer side; toes crawl along the ground.

**Openings.** Under every lip, a room: a cave dented into one face (never through), or a wide portal that leaves the two side walls; between lips, windows through the wall, turned a little from each other. Sizes differ by tier and tower. With age the openings keep enlarging past maturity: that is the hook for creature activity later (not implemented).

**Vertical and lateral are one axis.** The place sets `vert`: shade, shelter and crowding make the towers taller, more twisted and closer together; open exposed ground makes them shorter, more numerous in effect, further apart and more bridged, but never wider than the tallest tower is high. Spreading and Ascending are the two ends of this axis, not templates.

**Variation.** The seed sets the number of towers (2 to 4), which is tallest, how they stand along a gentle bow, their girth and tier count, twist, where each opening and bridge falls and how large it is, and where the buttress roots. Habitat never changes a draw, so one seed keeps its identity across places.

**Forbidden:** low horizontal compositions; isolated arches; tubes, limbs and worms; spikes and thin spires; mushroom caps; horns and skulls; stumps and featureless hills; a part that ends without joining or growing from something; many equal holes; symmetry.

**Status.** Paused as a lightweight experiment, available in the Lab and not in the world; it does no work until selected. The first design-first version (twisted column, arch wall, nested arches; `porousArches.ts`) read as tubes and bones and was replaced. The vertical cluster is checked in code (one connected piece in 18 of 18 test meshes, 6 seeds under 3 habitats) and awaits visual review.

## 4. Terrain and habitat (both families)

| Place | Effect on the form |
| --- | --- |
| Slope | the form faces and its toes run downhill; the lowest support goes downhill (both families) |
| Ridge / exposure | lower, broader, longer toes, more lean with the wind |
| Hollow / shelter | taller, narrower, larger openings |
| Water near | toes and roots reach toward it, wider base |
| Crowding | leans away from neighbours, taller, narrower |
| Light | faces the sun; stronger light lengthens reaches |
| Age | young: the base and one leg or the keep only; mature: everything; old: openings widen |

All coordinates are in the ground's own height, so feet, toes and skirts follow the terrain instead of standing on it.

## 5. How to evaluate a prototype

1. Contact sheet, six seeds, one habitat, same camera: do the silhouettes differ in composition, not only size?
2. Same seed across the five habitats: does the habitat change proportion and emphasis while the identity holds?
3. Three ages: does it grow structurally (supports, openings), not only fade in?
4. Check the forbidden list for each composition.
5. For Overhang: original and refined side by side, same seed and habitat.
6. Ground contact on slopes and by water (still to be tested on steeper ground before world integration).
7. Mesh time and connectivity (no detached pieces).
