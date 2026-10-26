# Shadow Ecology — Planning

> Living document and current source of truth for the concept and the prototype. Working directions, not final decisions.
> Related: [Visual Direction](shadow-ecology-visual-direction.md) · [Living Architecture experiments](../analysis/living-architecture-experiments.md) · [Style Guide](../../STYLE-GUIDE.md) · [Backlog and roadmap](backlog.md)

| | |
|---|---|
| Status | **Shadow Ecology 0.3 is the current project, in development** (see [0.3](#shadow-ecology-03-in-development)). Prototype 0.1 and Project 0.2 are earlier iterations and stay reachable. Concept sections below are current; the implementation sections still describe 0.1. The Living Architecture approach is under review and not finalized ([experiments](../analysis/living-architecture-experiments.md)) |
| Code | `app/src/project/` (0.1), `app/src/project02/` (0.2), `app/src/project03/` (0.3); studies: `app/src/weeks/week06/`, `app/src/weeks/week07/` |
| Last updated | 2026-10-25 |

---

## Concept

**Environmental processes leave traces over time.**

A small floating world sits under a moving sun. Nothing in it is placed by hand: every structure, shadow, plant, path and patch of habitat is the trace of a process acting on the world. Once running, the world records what light, growth, weather and time have done to it.

> Light reveals structure. Shadow reveals habitat. (Style Guide)

### The chain

```mermaid
flowchart LR
    L[Light] --> G[Growth]
    G --> S[Structure]
    S --> SH[Shadow / Shelter]
    SH --> H[Habitat]
    S --> E[Exposed form]
    WT[Weather and time] --> W[Weathering / Decay]
    E --> W
    W -. removes .-> S
```

| Step | Meaning |
|---|---|
| **Light** | A moving sun: direction and height change through the day and, as a stand-in for season, from day to day |
| **Growth** | Light pays for new form. Structures extend where and when they are sunlit |
| **Structure** | Accumulated built form: stepped masses, walls, terraces, cantilevers |
| **Shadow / Shelter** | What the structure blocks. Shadow is instant; shelter is shade that persists over days |
| **Habitat** | Ground sheltered, moist and stable enough for shade-dependent life |
| **Exposure → Weathering** | The counter-process: weather and time wear away what stands open, high and unsupported. It reads form, not sunlight |

### Core tension

**Structures seek light, but the shade they create is what enables other life.**

Growth is drawn to the sun, yet every block it adds takes sun from the ground and from the structure itself. Habitat is a by-product of growth that was never meant for it. Too little structure gives no shelter; too much shades out its own growth. Weathering keeps the balance moving: exposed form wears back, freed ground reopens to growth, and the shade shifts with it. The aim is turnover, not a finished state.

### Living Architecture

**Living Architecture** is the working name for the *Structure* step of the chain: an organism-like structure between architecture and plant life, neither a conventional building nor ordinary vegetation. The relationship to Shadow Ecology is the chain itself, read at the scale of one organism:

- It **grows in response to sunlight and water availability**. Light pays for new form (as in [Growth](#current-implementation-prototype-01)); water is the second input, so growth favours sites with both.
- As it grows, its **physical structure creates shadow and shelter**.
- **Accumulated shadow supports shade-seeking vegetation and other lifeforms**, building habitat over time rather than at once.
- It is **not permanent**. It weathers, decays, fragments and eventually changes structurally, and that change alters the habitats it supports.

This restates the [core tension](#core-tension), [time as memory](#time-as-memory) and the weathering counter-process, and does not replace them: shadow memory and habitat persistence stay as defined. Growth responding to *water* is the one new input, and it is a direction, not a decision.

Scale and legibility, the main open problem for this phase, are in [Visual Direction](shadow-ecology-visual-direction.md#living-architecture-scale-and-legibility).

**Exploration status (0.3).** Several growth representations have been built and compared against the same brief (connected at every age, a substantial primary mass, layered shelves, supported overhangs, negative space that results from growth). None is adopted as final; `overhang3` is the working reference form. What each did and what is unknown: [Living Architecture experiments](../analysis/living-architecture-experiments.md). References and how they are used: [Precedent Research](#precedent-research).

### Realism and fiction

The world is meant to be partly understandable and partly invented.

| Grounded in natural process | Allowed to be fictional |
|---|---|
| Ground terrain, hydrology and soil | Living Architecture |
| Some ecological relationships (moisture, shelter, footing, light) | Specialised, shadow-dependent organisms |
| | Certain creature forms |

The fiction should keep an internal rule behind it (see *Inversion with an internal logic* under [Concept history](#concept-history)) and rest on the grounded processes, so that invented elements still respond to light, water and ground. How the two look together is in [Visual Direction](shadow-ecology-visual-direction.md#realism-and-fiction).

### A grammar of traces

Behind the principle sits a broader procedural grammar:

```text
environmental force → interaction → accumulated memory → visible trace → consequence
```

Where it matters, the world responds not only to its current conditions but to the history of what has happened there. The core tension is its most developed example:

```text
light + structure → repeated shade → remembered shelter → habitat → ecological consequence
```

Prototype 0.1 implements this chain, and weathering in a simpler form (weather is implicit, read through age and form). Other possible manifestations are exploratory, not implemented:
- **Water** contact and flow → erosion, deposition, moisture boundaries, channels
- **Weather and exposure** → wear, scars, material change
- **Movement** → accumulated paths
- **Organisms** → growth, occupation or other traces

### Time as memory

The world's state is its history. What exists now is what has accumulated:
- the architecture: each voxel's age, the simulated time since it was placed
- what has weathered away
- the remembered daily shelter that habitat is built from

The same settings and the same passage of time always give the same world, so time can be replayed as well as watched.

Timescales nest: shadow moves over hours, habitat follows it over days, and architecture grows and turns over across tens of days.

### Many ways of seeing

The ecology is one world state, shown in several representations. Each is a different reading of the same data, never a separate simulation. The 3D world, the plan, the field view and the readouts all read the same state. A new view should reveal a relationship the others hide, not add a new system.

### Concept history

- **2026-10-25 — 0.3 becomes the current project:** Living Architecture is explored through several growth representations, compared in [experiments](../analysis/living-architecture-experiments.md), and the precedents behind it are separated into studied, named and proposed ([Precedent Research](#precedent-research)). The chain and the design position are unchanged; 0.1 and 0.2 are kept as the earlier iterations. A documentation refresh, not a change of concept.
- **2026-10-22 — before Living Architecture:** the structure step is named Living Architecture and its relationship to shade and habitat is stated explicitly ([Living Architecture](#living-architecture)); realism and fiction are separated ([Realism and fiction](#realism-and-fiction)); a wetland micro-biome and hybrid creatures are recorded as exploratory ([Ecological inspirations](#ecological-inspirations-exploratory), [Organisms](#organisms)). Clarifications and open directions; no earlier decision is changed.
- **2026-10-13 — studies after 0.1:** Week 06 (distribution, paths, fields) and Week 07 (Trace Growth, Branching Histories) explored arrangement, environmental response, and what a site keeps after an event. Collected in [Since Prototype 0.1](#since-prototype-01). A record of explorations, not a change to the 0.1 concept.
- **2026-10-07 — traces as a world grammar:** visual research showed that *environmental processes leave traces over time* extends beyond shadow. Light leaves shelter history; water, weather, movement and organisms could leave their own traces. These are not committed systems, but manifestations of one grammar, *force → memory → trace → consequence* ([A grammar of traces](#a-grammar-of-traces)). A conceptual clarification, not an implementation milestone: shadow and remembered shelter remain the primary developed example.
- **Starting premise (early 0.1):** *temporary shadow defines temporary habitat.* The sun moves, so shadow moves, so habitat slides across the world through the day. This proved too instantaneous: shade that lasts an hour is not a place to live. Habitat is now built from **remembered** daytime shelter, so it follows changing shadow over days, not minutes.
- **Earlier directions:** Shadow Ecology came out of four: Living Atlas, Emergent Civilization, Strange Ecology and Inverted Ecology. It keeps these principles:
  - **Inversion with an internal logic:** familiar relationships reversed (architecture adapting to nature, organisms supporting the environment), always with a rule behind them, not just visual strangeness.
  - **Structures have reasons:** location, form and relationships emerge from world conditions (terrain / water / light → sites → growth → paths).
  - **Map ↔ world:** the same systems read as a 2D composition and a 3D world.

---

## Visual Direction

What the world could look and feel like: architecture, organism, geology and scientific model blurring into one formal language, with organisms derived from the same procedural language as the landscape and structures. Exploratory research, not Prototype 0.1 functionality.

The current Are.na research suggests the world could read as an **evolving spatial record of its own processes**. Recurring qualities:
- lines as records of movement, flow, growth or contact: contours, rings, paths, scars, branching and deposits
- repeated simple elements accumulating into complex forms
- quiet continuous fields interrupted by local disturbances
- organic geometry constrained by grids, diagrams or other systems
- ambiguity between architecture, organism, geology and data
- restrained, diagrammatic representation rather than conventional realistic nature

Whenever possible, a visual mark should correspond to actual procedural state rather than being purely decorative.

- Concept visuals, world vocabulary, creature explorations and Are.na search terms: [Shadow Ecology — Visual Direction](shadow-ecology-visual-direction.md)
- Execution and design-system rules: [Style Guide](../../STYLE-GUIDE.md)

---

## Shadow Ecology 0.3 (in development)

0.3 is the current project. It keeps the chain and the design position above and extends them: a larger, more physical island, a living clock, and a first population of Living Architecture. 0.1 and 0.2 are earlier iterations whose rules it draws on; 0.2 is summarised in the [README](../../README.md#shadow-ecology-02), and the implementation sections below still describe 0.1.

| Part | Where it stands (code-derived unless marked) |
|---|---|
| **Terrain and water** | A 4.1 km island: layered noise, drainage into lakes and rivers, a sky and a weather timeline that feed a simple hydrology. Observed in the app |
| **World Time** | One clock with two modes: a Daily Cycle (sun, weather) and Evolution (World Year 0–300, with playback speeds). World Year 120 is the default observation start and the reference organism's calibration, not a special event |
| **Navigation** | Overview, Approach and Explore (first person, pointer lock), with an inspection card for a selected organism |
| **Living Architecture** | Under exploration: several growth representations compared against one brief; a population of organisms with their own ages, ground-driven forms and kin links. Not finalized: [experiments](../analysis/living-architecture-experiments.md) |
| **Vegetation and habitat** | Rules exist in 0.1 and 0.2; not yet rebuilt for 0.3 |
| **Creatures** | Concept and morphology studies only ([Visual Direction](shadow-ecology-visual-direction.md#creature-explorations), Week 07); no 0.3 implementation |

Priorities and order of work are in the [roadmap](backlog.md).

---

## Current Implementation (Prototype 0.1)

Prototype 0.1 began as *static architecture + instant habitat*. It now runs the full chain above, plus water, vegetation and paths as supporting systems.

```mermaid
flowchart LR
    subgraph Static[Read once from terrain]
        T[Terrain] --> HY[Water: lakes, rivers, falls, moisture]
    end
    SUN[Sun, each quarter hour] --> GR[Architecture growth]
    GR --> A[Architecture voxels]
    TM[Weather and time, each quarter hour] --> WE[Weathering]
    A --> WE
    WE --> A
    A --> LF[Traced daily sunlight]
    T --> LF
    LF --> MEM[Sunlight memory, each sunset]
    MEM --> HAB[Habitat]
    HY --> HAB
    LF --> VEG[Vegetation]
    HY --> VEG
    A --> P[Paths]
    VEG --> P
    HAB --> P
```

### World (static)

| Part | Implementation |
|---|---|
| **Terrain** | Floating landmass: a ridge, a knoll and a hollow, plus Week 03 noise; an eroded, fractured rim; a layered cliff (soft beds recessed, hard ledges, gullies, a notch under the cap rock); a stepped hanging underside |
| **Water** | Read from the terrain once, not simulated: depressions filled, flow routed downhill and drainage accumulated. Large basins become lakes, well-drained lines become rivers that cut channels, and rivers reaching the rim fall off. Produces a moisture field |
| **Sun** | A stylised day: rises east at 06:00, crosses south at noon, sets west at 18:00. *Noon sun height* (20–85°) stands in for season |

### Running processes

| Process | Rule | When |
|---|---|---|
| **Light field** | Rays marched towards the sun over the ground grid and through the architecture voxels (the same shadows the shadow map draws). Daily sunlight is the sum over 10 samples between sunrise and sunset, relative to open flat ground | At sunset, or when the settings change |
| **Sites** | Up to 3, clustered where the bare terrain is best lit, flattest and just clear of a water edge | At Reset |
| **Growth** | Each quarter hour of daylight earns a voxel budget ∝ sun strength. It is spent on a grammar of module moves (rise, wall, terrace, cantilever, span, opening, cut), each weighted by *sunlit now · facing the sun · form · water edge · site vigour*. Shaded growth is much slower. Capped at 7,000 voxels | Every tick |
| **Weathering** | Weather and time, not sunlight. Budget ∝ standing volume, day and night, far below growth while small. Moves: unloaded slabs fall, modules wear down two layers at a time to a plinth, edge plinths clear. Each is weighted by *age · openness (open sides) · height (standing proud) · poor support (overhang)*. Freed ground reopens to growth | Every tick |
| **Age** | Every tick advances the architecture clock; a voxel's age is the clock time since it was placed (full after 8 days), so blocks keep ageing while growth is paused | Every tick |
| **Habitat** | `remembered shelter · moisture · footing(slope)`. Each sunset the day's sunlight is blended into a memory (≈ 4-day time constant; night never counts as shelter). Excludes water, architecture and the rim | Each sunset |
| **Vegetation** | The opposite of habitat: needs enough daily sun, plus moisture and footing. Plant form (frond, spire, pod, tier) answers moisture, light and vigour | Rebuilt each sunset |
| **Paths** | Least-cost routes (climbing costly, fords cost extra, lakes and architecture impassable). Sites are joined by a spanning tree, with spurs out to water edges and to vegetation and habitat regions. Reused ground gets cheaper, so trunks form | Rebuilt each sunset |

### Time controls

- **Clock:** Play (1–8×) or scrub the time of day. The sun at each tick drives growth, but only forward time counts days and adds to memory.
- **Day jumps (1 / 10 / 50 / 100):** fast-forward tick for tick. A day earlier than the current one replays from Reset.
- **Determinism:** seeded, so the same settings give the same world.
- **Process toggles:** growth and decay each have an on/off toggle and a 0.25–4× rate multiplier. Habitat has *sunlight limit* and *max slope*.

### Ways of seeing (implemented)

| Representation | What it shows |
|---|---|
| **3D world** | Lit specimen on a black field. Shadow is the lighting itself, never a tint. Colour is semantic: neutral for rock and architecture, cobalt for water, warm olive for vegetation, cool lichen green for habitat, stained into the ground as colonies that coalesce into a mottled crust where it turns suitable, with quiet marks for what the last sunset gained (fresh lichen) and lost (a ghost of hatching); Field only adds hatching and the suitable edge. Architecture wears visibly before decay removes it, as material states that read at viewing distance: intact graphite → weathered (leached to a mottled mineral grey, matte, edges chalking) → heavily weathered (pale friable stone eaten into dark pockets, worn relief, wide joints), strongest where decay weighs the form most. The bottom-left view strip (F Wireframe, C Contours, R Auto rotate) is shared with Weeks 03–05. Contours is off by default; on, all analytical linework appears together: elevation contours, lake depth lines, and river and waterfall flow lines |
| **Material traces** | Architecture colour records its history: fresh blocks are graphite; as simulated time passes, open faces pale and sheltered ones sink to charcoal. Terrain darkens where damp and where paths wear |
| **Field only** | Strengthens the habitat field and clears plants and paths, so the pattern reads alone |
| **Observation plate: Plan** | The same live state as a survey sheet, north up: water, footprints, worn routes, current shade, habitat patches with iso lines, vegetation marks, and the sun on a chart ring |
| **Layer cards and readouts** | Each system as inputs → rule → output → now, plus live counts (voxels, sites, weathered, % suitable, routes) |

### Known gaps

Places where the implementation is still simpler than the concept:
- **Weather is implicit.** Weathering is one uniform weather-and-time process read through form (age, openness, height, support). There is no explicit weather yet (no wind direction, rain or moisture term), and light plays no part: light builds, weather and time erode.
- **Paths and vegetation keep no memory.** They are recomputed from the current state each sunset, so they don't yet leave traces: wear does not accumulate and plants don't persist.
- **Habitat is unoccupied.** It marks where life *could* be; nothing lives there yet, and habitat feeds nothing back except path destinations.
- **Only architecture casts shadow in the light field.** Plants don't.
- **Terrain and water are fixed.** Architecture keeps clear of the water, but water never responds to it.
- **Only one projection.** Plan is the only view on the observation plate.

---

## Since Prototype 0.1

Course work after the 0.1 prototype. These studies are not modules of the Project, and they are not a new thesis. The implementation above is still the world. What follows records what was explored, what it suggested, and which of those suggestions are candidates for a later prototype.

### Post-0.1 course explorations

**Week 06 — Spatial Systems.** One block of terrain, three questions about arrangement. Write-up: [Week 06 — Spatial Systems](../tutorials/06-spatial-systems.md).

| Study | Asks | Explored |
|---|---|---|
| **Distribution** | Where do many things go? | One pipeline for three layers (structures, vegetation, colonies): candidates, a weight, a draw, then spacing. Random and Noise ignore the ground. Environment weights elevation, slope, moisture, light and nearness to water, and each layer weights those fields differently. Layers are placed in order, so later ones avoid structure footprints and read light after the structures' shade. Validity (water, footing, footprints) is a hard rule; a preference only makes ground less likely. |
| **Paths** | How do points become lines? | Connection builds a network: a tree, plus loops where the tree detours too far. Flow reads the ground at every step — streams run downhill, meander, join, and widen with the flow they have gathered. Growth ignores the terrain until the line is projected onto it; with Imprint on, the line presses a groove back into the mesh. |
| **Fields** | What is everywhere at once? | One wind field, steered by the ground (bent along slopes, faster over high ground, slower in the lee) and stirred by eddies. Wind, rain, snow and mist are different particles in that same air. Exposure reads the field at the ground — high, open, or facing the wind — as a sketch of an explicit weather term. Decay itself is not modelled. |

**Week 07 — Branching Systems.** One site: a cantilevered slab, and an organism grown beside it.

| Study | Asks | Explored |
|---|---|---|
| **Trace Growth** | How does one grammar answer an environment? | An L-system read by a 3D turtle. The same word, seed and settings are grown three ways: Free (the grammar alone), Seek light (toward the sun), or Seek shelter (toward the slab's shade). Ground and mass deflect all three. Fresh growth is pale, older growth weathers, and growth that stayed in shelter reads as lichen. |
| **Branching Histories** | What does a world keep after an event? | That site is a shared origin, rewritten by rules. Stage 1 is the structure's fate (stable, slow decay, sudden collapse). Stage 2 is how growth and creatures respond (consolidate, expand, redistribute, contract, colonise, migrate). Stage 3 is inheritance (traces fade, persist, or new growth follows them). Every rule whose condition holds is a branch, so the tree is a possibility space, not a script. World shows what exists now; Traces shows former shade, worn paths, remains and inherited growth. |

### Current conceptual discoveries

Readings of the studies. Exploratory: none of these is a committed rule, and none replaces the 0.1 chain.

- **Different forms, one environment.** Exploratory: different forms may perceive or value the same environment differently. Distribution gives structures, vegetation and colonies different preferences over the same fields. Fields sends wind, rain, snow, mist and exposure through one vector field. Trace Growth keeps one grammar and seed and changes only the response — Free, Seek light, Seek shelter. This sits beside [Many ways of seeing](#many-ways-of-seeing), which is about representations of one state. Here the difference would be inside the world: what a form seeks. Not a Project system.
- **Feedback, not language.** Exploratory: architecture and creatures can interact through environmental feedback rather than language. Branching Histories sends no messages between them. A change in the slab changes shelter and rubble; growth and movement read that; lost shelter, lost growth and movement then settle into former shade, remains and worn paths. Prototype 0.1 already has a quieter version: growth casts shade, and habitat is the by-product. The study only makes that kind of feedback visible across events.
- **Influence after decay.** Exploratory: decay or death does not necessarily end influence; traces can persist. After each event, shade that no longer falls, growth that died and ground that was walked are recorded. A later rule can erase that evidence, leave it, or let new growth take it as a route. This tries the [grammar of traces](#a-grammar-of-traces) on a single site. It is not how the prototype weathers.
- **Legible history.** Exploratory: history can remain spatially legible after its cause disappears. The Traces view draws former shade, trails, remains and inherited growth when the standing slab, the living organism or the creatures' present path may already be gone. Prototype 0.1 remembers shelter, and architecture colour records age. Its paths and vegetation still do not ([Known gaps](#known-gaps)).
- **Unstable categories.** Exploratory: the classification architecture / organism / environment may become unstable through behaviour and time. In the study, rubble is colonised, new growth follows former shade and dead stems, and living growth, remains and fallen mass occupy one site. Prototype 0.1 still builds those as separate systems. Whether behaviour and time should loosen the separation is open, in line with the ambiguity noted in [Visual Direction](#visual-direction), not a decision.

### Project 0.2 direction

0.2 would still be Shadow Ecology: the same chain, deepened. Weeks 06 and 07 are a pool to draw from. Taking something from a study means a rule that serves the chain, not a reproduction of the study.

#### Confirmed foundations

Held by the sections above, and not revised by the later studies:

- **The chain and the tension.** [The chain](#the-chain) and the [core tension](#core-tension) are unchanged. Weathering remains the counter-process. Weather stays implicit until a later prototype decides otherwise.
- **Time as memory.** [Time as memory](#time-as-memory) still holds, including determinism: the same settings and the same passage of time give the same world.
- **Studies are not the Project.** Nothing in Week 06 or Week 07 amends the concept. They are options for 0.2, below.

#### Promising 0.2 candidates

Each is optional. Listed because it touches a known gap or an existing open question, not because the study should be ported.

| Candidate | Would serve | Would not mean |
|---|---|---|
| **Valid ground, then preference** | A placement rule that keeps hard exclusions (water, footing, footprints) separate from soft weights, so unlikely ground thins out instead of stopping at a border | Replacing the growth grammar or the habitat rule with the Week 06 pipeline |
| **Layers that disagree** | Structures, plants and habitat life weighting the same ground differently, and later layers reading shade the structures have cast | Scattering the Week 06 counts and forms into the world |
| **An exposure field** | The missing explicit weather term: a wind direction read as openness, so weathering can favour some faces | Particle weather (rain, snow, mist) as a required feature |
| **Paths that wear** | The gap that routes are rebuilt each sunset and leave no trace: a line that deepens with use, and can fade | Connection's loops, or Flow's meander, as the Project's path model |
| **A trace that alters the ground** | The question of which traces change the world and which stay visual. Growth's imprint — a groove pressed into the mesh — is one small experiment | Grooves as a general terrain system |
| **An occupant of habitat** | The gap that habitat is unoccupied. Trace Growth is a candidate for a form that seeks light or shelter and records age and shade in its material | Importing the L-system as the world's organism |
| **Evidence that outlasts the event** | Former shade, remains, worn paths, and growth that follows them, so later behaviour can read environmental history | The history tree as a mode of the running world |

#### Open questions / experiments

These sit beside the [Prototype 0.1 questions](#open-questions--future-directions). They do not replace them.

- Which candidates, if any, belong in 0.2, and in what order? One deepening of the existing chain is enough to start.
- If something occupies habitat, does it seek shelter, light, or both — and can two forms on the same ground disagree?
- Should weathering stay a reading of age and form, or take an exposure field as an input?
- When structure is lost, what remains spatially legible: rubble, a scar, former shade, the life that was under it?
- Should a later process be allowed to follow an old trace, or only the conditions of the moment?
- How far can architecture, organism and environment blur before the world is no longer readable?

---

## Open Questions / Future Directions

Prototype 0.1 questions, ordered roughly by how directly each one deepens the chain. Questions opened by the later studies are in [Project 0.2 direction](#project-02-direction).

### Growth ↔ shade balance
- Is there a balance point where architecture and habitat coexist, or does the world oscillate? What does the long-run share of habitat look like across noon sun heights?
- Should growth respond to *accumulated* light (a site's history) rather than the sun of the moment?
- Can a structure be *designed* for the shade it casts (architecture adapting to nature)?

### Exposure → Weathering
- Should weather become explicit: a prevailing wind or rain direction that favours faces open toward it, or faster wear near water?
- Should the rock and terrain weather too (Week 03 erosion as a slow force), not just architecture?
- What remains of weathered form? Rubble, scars, ground that remembers a footprint?

### Traces and memory
- Paths as accumulated wear: routes that deepen with use and fade when abandoned.
- Vegetation as persistent state: plants that establish, spread and die back rather than being recomputed.
- Can water contact accumulate as erosion, deposition, moisture bands or shoreline traces?
- Can environmental forces share a common memory-field logic without making every process behave identically?
- Which traces should physically alter the world, and which should remain visual records?
- Can traces become inputs to later processes, so future behaviour depends partly on environmental history?
- One slow clock sampled by faster ones, or nested clocks per process?

### Living Architecture
Current phase (0.3); results so far and open items are in [experiments](../analysis/living-architecture-experiments.md#unresolved). Open, not decided:
- **Scale and legibility first.** In 0.2 it was hard to tell whether blocks were living units, plants or architecture. Resolving this comes before adding behaviour; the investigation is set out in [Visual Direction](shadow-ecology-visual-direction.md#living-architecture-scale-and-legibility).
- How does water availability enter growth: as a site weight, an edge bonus (as now), or a continuing input?
- Can one structure be read at three levels — living unit, complete organism, landmark — without a separate system for each?
- Which kinds of shade does a form make that matter ecologically: cover, depth, duration, moisture held?

### Organisms
- What occupies habitat: individuals, colonies, a continuous field?
- Do organisms follow the shade as it moves over days, or wait for it to return?
- Can life feed back, e.g. organisms supporting structures, or holding moisture?
- What traces does life leave?
- **Creatures (exploratory).** The intended direction is unfamiliar but plausible hybrid lifeforms that borrow recognisable characteristics from birds, fish, cats, horses and swans. These are not literal animal-part combinations or finalised species. Body and behaviour should follow the habitats on offer, including shelter generated by architecture. Forms are in [Visual Direction](shadow-ecology-visual-direction.md#creature-explorations).

### Ecological inspirations (exploratory)
- **Wetland micro-biome.** Hangzhou's Qingshan Lake water forest is an inspiration for a possible wetland patch: trees rising from shallow flooded ground, floating aquatic plants such as duckweed, and waterbirds (swans and cygnets) working among them. What it would test is the relationship between water depth, soil moisture, season and habitat, not a copy of the place. This is **not** a decision to reproduce Qingshan Lake or to turn the island into a green wetland. Look is in [Visual Direction](shadow-ecology-visual-direction.md#ecological-inspirations).
- **More environmental factors.** Soil type, moisture, climate and seasonality could later shape where vegetation goes. Today vegetation reads light, moisture and footing; the rest are possible additions, and connect to *Seasons* under [World systems](#world-systems).
- Does a flooded, vegetated shallow count as habitat in the current sense (sheltered, moist, stable), or as a different kind?

### Many ways of seeing
Candidates, each reading the existing state:
- **Section / elevation:** shade and shelter under overhangs, which a plan hides
- **Chronology:** a strip of one place's light, growth and habitat over days, making memory visible
- **Sun-hours map:** daily sunlight itself, the field that both growth and habitat read
- **Ledger / specimen sheet:** the world summarised as counts and records

How do the 3D world and the 2D projections stay one composition rather than two views?

### World systems
Each should emerge from relationships already in the world, not be placed as decoration.

| System | Could emerge from |
|---|---|
| **Weather** | Cloud as a second, moving shadow layer; rain feeding moisture |
| **Seasons** | Noon sun height cycling over time instead of being a slider |
| **Dynamic water** | Shade holding moisture; runoff re-routed by structures |

### Interaction
- What can the user influence: sun, structures, rules, or nothing (observation only)?

---

## Precedent Research

How references are used in this project: a precedent is only counted as *used* when its design principle, a procedural transformation of it, and the evidence for that transformation are all written down. Most entries below are not there yet.

**Status words.** **Studied**: a write-up in this repository. **Named**: named in the project's design brief or reference board, so a source of ideas; depth of study and source citations are to be confirmed and recorded. **Proposed**: listed as worth investigating; not yet studied. "Transformation" is a *candidate* rule, not an implemented one, unless the Status says so.

### Architectural and spatial precedents (Living Architecture)

Named in the Living Architecture brief as sources of spatial and morphological principles, not shapes to copy.

| Precedent | Design principle | Candidate procedural transformation | Status | Evidence still needed |
|---|---|---|---|---|
| La Fábrica (Ricardo Bofill) | Monumental scale, dominant masses, accumulated age | A dominant keep with a size hierarchy among organisms; age recorded in strata and weathering | Named | Which drawings or texts were studied; how the keep's proportions relate to it |
| Habitat 67 (Moshe Safdie) | Interlocking, offset masses; cantilevers; negative space | Offset stacked lobes or strata, with a limit on unsupported reach | Named | Same; how the reach limits compare to its structure |
| Brion Tomb (Carlo Scarpa) | Layered geometry, material thickness, stepped edges, deep cuts | Stepped strata ledges; recesses cut where tissue recedes | Named | Same |
| House & Restaurant (Junya Ishigami) | Irregular, naturally formed, inhabitable voids | Openings that result from recession and shading, not from placed holes | Named | Same |

### Natural growth precedents (Living Architecture)

From the reference board for the hybrid growth strategy (coral, fungal, tree, mineral). The board's images are not attributed in the repository.

| Precedent | Design principle | Candidate procedural transformation | Status | Evidence still needed |
|---|---|---|---|---|
| Coral accretion | Layered mineral deposition; continuous surface growth | Thickening by the age since a surface was laid down; strata | Named | Specific species or formations; scientific or photographic sources |
| Fungal bracket / shelf growth | Directional branching; shelf-like structures reaching to light | Shelves grown outward from a trunk toward the best light | Named | Same |
| Tree branching and load paths | Hierarchical structure; thicker where load concentrates | Member thickness from the load carried; props where a limb outgrows its carrier | Named | The branching model actually used must be cited (see technique table) |
| Mineral deposition, erosion, cavities | Stratification; differential erosion; overhangs | Strata cut by height; weathering that differs by exposure | Named | Source formations or processes |
| Qingshan Lake water forest (Hangzhou) | Trees from shallow flooded ground; floating plants; waterbirds | A possible wetland patch; see [Ecological inspirations](#ecological-inspirations-exploratory) | Named (exploratory) | Sources; a decision on whether it is a micro-biome in 0.3 |

### Procedural and computational precedents

Originally listed here as "Procedural Works to Study". Study these for specific procedural ideas, not for what the world should look like. For each, ask what is actually procedural: form, appearance, distribution, behavior, structure, time or world logic. A world does not need to proceduralize all of these.

| Reference | Relevant to | Why (original note) | Candidate transformation | Status | Evidence still needed |
|---|---|---|---|---|---|
| **Cloud Gardens** | Architecture growth, vegetation | Organic growth responds to human-made structures and gradually transforms a scene | Vegetation that grows from architecture's own shelter | Proposed | What it does procedurally, from a primary source |
| **Townscaper** | Architecture | A small set of placement rules becomes a recognisable visual language | A small rule set for strata and shelves | Proposed | Same |
| **Wave Function Collapse** | Architecture, structures | Adjacency constraints generate complex architecture, maps and patterns | Adjacency rules between tissue types | Proposed | Same, and whether constraints suit continuous growth |
| **Town to City / settlement systems** | Structures reshape habitat | Local placement rules accumulate into larger patterns instead of designing each building | Population-scale clustering from local rules | Proposed | Same |
| **Physarum / slime mold** | Paths | Agents following local rules form road-, vein- and root-like networks | Kin connections and roots between organisms | Proposed | Same |
| **Reaction-diffusion** | Growth, weathering | Local interactions produce coral-, cell- and rock-like surface patterns | Surface texture and weathering patterns | Proposed | Same |
| **Lenia / cellular automata** | Organisms | Simple mathematical rules generate life-like moving forms | Rule sets for continuous growth | Proposed | Same |
| **Bad North** | Terrain | Constrained variation keeps small generated islands readable and coherent | Readable island scale | Proposed | Same |
| **Monument Valley** | Materials, light | Simple geometry made distinctive through colour, fog and surface direction | Material and light treatment | Proposed | Same |
| **Proteus** | Multiple timescales | Colour, vegetation and seasonal change combine into a sense of place | Nested timescales (day, year) | Proposed | Same |

### Techniques already applied in course studies (Studied)

| Technique | Where | Sources |
|---|---|---|
| Noise, terracing, domain warp, erosion | [Week 03](../tutorials/03-procedural-noise-and-terrain.md) | See that note |
| Density fields, CSG, marching cubes | [Week 04](../tutorials/04-01-voxels.md) | References section there |
| Shader fields and terms | [Week 05](../tutorials/05-shaders.md), [Shader Studies](../analysis/05-shader-studies.md) | References section there |
| Distribution, paths, wind fields | [Week 06](../tutorials/06-spatial-systems.md) | See that note |
| L-systems, branching, histories | [Week 07](../tutorials/07-branching-systems.md) | See that note |

### Techniques used in 0.3 whose sources are not yet recorded

| Technique | Where | Status |
|---|---|---|
| Signed distance fields with smooth blending | Living Architecture variants | Used in code; sources to be recorded |
| Surface nets surface extraction | `livingMesh.ts` | Used in code; source to be recorded |
| Pipe-model sizing of branches | Named in the `network` variant's comment | Used in code; the source to be identified and cited |
| Unsupported-run limit tied to thickness | Several variants | The project's own heuristic; no source recorded |
| Differential accretion by facing | `network` | The project's own term and rule |
