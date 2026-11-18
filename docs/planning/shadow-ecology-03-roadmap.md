# Shadow Ecology 0.3 — Roadmap

> Working roadmap for 0.3, kept short so iterative refinement does not lose the direction. Updated at the end of each round.
> Related: [Planning](shadow-ecology.md) · [Backlog](backlog.md) · [Visual direction](shadow-ecology-visual-direction.md)

| | |
|---|---|
| Last updated | 2026-11-16 (Milestone 1, Phase 1A) |
| Code | `app/src/project03/` |

## Two experiences, one world

Both run on the same deterministic world (seed, terrain, hydrology, ecology, Living Architecture, creatures, time). They differ in audience and purpose.

| | **Explore World** | **How It's Made** |
|---|---|---|
| Audience | Anyone: the piece itself | Classmates, professors: the process |
| Purpose | Experience the island: its light, ecology, creatures, architecture, time and story | Understand how the island is generated and why it looks as it does |
| Default view | Graphic Diorama — Black Stage | Same world, with data layers and explanations |
| Core features | Overview / Approach / Explore cameras, day cycle and evolution, creatures, Living Architecture cards, Guide narrative | Inspect (Point & Inspect, data layers), Build Replay, system explanations, data structures, parameter experiments |
| Rule | No debugging UI in the way; data appears only on request | Every claim backed by the actual data; nothing drawn "for the view only" |

Inspect currently lives in the shared panel (section 04). It is the seed of How It's Made and moves there when that mode exists.

## Milestone plan (agreed after the architecture review)

One shared procedural world, two experiences. Inspect is a tool inside How It's Made, not a third experience. Old versions, Labs, visual
studies and developer tools stay reachable in **Archive & tools**, outside the audience-facing panel.

| Milestone | Scope | Status |
|---|---|---|
| **1A. Experience shell & navigation** | Persistent Explore World / How It's Made switch; experience-specific panel; Archive & tools entry; camera "Explore" renamed "Walk"; camera, time and playback unchanged and shared | **Done, awaiting review** |
| **1B. Interaction architecture** | One pointer router (drag vs click, what is under the pointer); one selection store (place, organism, connection, creature); a shared card shell with entity-specific content (ecological in Explore World, procedural in How It's Made), one anchor and one fade; fixes B1 and B2 | After 1A review |
| **2. Minimal Explore World** | Skippable cinematic intro with a one-line premise; arrival as an observer; entity cards with ecological meaning; creature follow as a contextual control; "How is this made?" link from a card; fix B3 | After 1B |
| **3. Minimal How It's Made** | System Explorer (Terrain, Water, Vegetation, Architecture, Creatures: explanation, data layers, rules); Inspect as the tool; **Build Replay v0** | After 1B |
| **4. Systems & experiments** | Water walkthrough with flow particles; parameter experiments; island-wide architecture layer; creature system; **Build Replay v1** | After 3 |
| **5. Polish** | Visual QA (structure colour fidelity, night water, lake lines), animation, performance, accessibility | Ongoing, after 2 and 3 |

**Build Replay, two distinct stages.**
- **v0 (Milestone 3), stage visibility.** Steps through terrain → water → vegetation → architecture → creatures by showing each system's finished
  result in turn (the existing visibility toggles). Honest and cheap; not a simulation of the build.
- **v1 (Milestone 4), animated procedural construction.** Each stage drawn as it is computed (uplift and erosion, flow particles and lakes
  filling, fields and communities, growth, creatures placed), with a scrubber. Needs the builders to expose intermediate states.

**Blocking bugs found in the review** (to fix in the phase that touches them):
- **B1, hover dimming (1B).** Every hover sets the island highlight to the hovered category; in the Water layer all non-water surfaces,
  structures included, are "Land", so hovering water dims structures to near-black (`exploreData.tsx › applyFocus`, `visualDiagnostics.ts ›
  diagChunk`). Hover should update the readout and legend only; surfaces outside a layer keep one fixed, undimmed neutral.
- **B2, structure banding (1B).** The three-tone light planes fall back to the mesh's own normal on everything but the terrain
  (`visualStudyWorlds.ts › stageHour`: `SunNdlR = SunNdl`), so curved structures band white and grey. Planes on terrain only.
- **B3, structure self-shadow (2).** Structures are double-sided and cast and receive shadows (`LivingArchitecture.tsx`); thin shells
  self-shadow into dark violet patches. Front-face shadow side or a per-material bias, and the terrain's grazing exemption.
- Optional: structure colour fidelity (the Black Stage draws all structures in one stone, ignoring their own age and vitality colours, with a
  distance-dependent fold darkening).

## Backlog (not scheduled)

- **Explore World:** stylized field camera; observation journal; advanced narrative beyond the intro and Guide; bioluminescence and nocturnal
  creature behaviour; sound.
- **How It's Made:** dependency diagrams between systems; side-by-side parameter comparisons; exporting data views.
- **Interface:** a dedicated World Bar for camera and time (placement to be evaluated after 1A); sidebar visual redesign.

### Phase 1A results

**Built.** A persistent bar under the title: *Explore World | How It's Made* and a quieter *Archive & tools* entry. The panel per experience:
- **Explore World:** World controls (camera, time, playback), Creatures (species, individual, creature camera; split out of World controls),
  About this world (the former World details).
- **How It's Made:** World controls, How it's made (data layers, Show in the world, Systems · coming), World parameters (the former Advanced
  settings: seed, weather and sun, terrain and water, architecture morphology preview, vegetation influence).
- **Archive & tools:** World controls, Versions & labs (the 0.3 / 0.2 / 0.1 tabs, the version description and Labs, moved from the header),
  Visual studies (the former Visual filters, including Dark Table), Developer tools. Choosing an experience closes it.
- Camera mode "Explore" is labelled **Walk** (its value and behaviour unchanged). Nothing was removed.

**World Bar decision.** Camera, time and playback stay in the panel's first section, shared by both experiences: the least invasive layout,
kept for review. A dedicated bar (bottom or top of the viewport) remains an option for later.

**Verified.** Panel contents per experience and in the archive view; camera labels; Visual studies switch the look and back; Developer tools'
readouts; experience switch closes the archive; time slider and Approach work; a structure click opens its popup in Explore World and the
Inspect card (no popup) in How It's Made. `npm run build` (with `tsc -b`) passes.

**Known gaps.** The one-line version description now lives only in the archive (the intro's premise will replace it in Milestone 2). The
Guide's and hints' text still say "Explore" where they mean the Walk camera.

## UI structure (proposed 08H; switch and How It's Made panel built in 08I)

The sidebar is already full, so the split happens above it, not inside it.

```
┌ header ─────────────────────────────────────────────────────────────┐
│ Shadow Ecology   0.3 · 0.2 · 0.1        [ Explore World | How It's Made ] │
└─────────────────────────────────────────────────────────────────────┘
 viewport (shared world, same camera)              sidebar (changes with the experience)
```

- **One switch in the page header**, beside the version tabs: *Explore World* | *How It's Made*. The world, camera and time stay as they are when
  switching; only what is layered over the world and what the sidebar holds change.
- **Explore World** (default). Sidebar: World controls (camera, time, creatures), World details, Visual filters, Advanced. Over the world: the
  Living Architecture and creature cards, the Guide narrative, Explore's place cursor. No data layers, no probe.
- **How It's Made.** Sidebar becomes a list of **chapters in build order**: Terrain → Water → Vegetation → Architecture → Creatures (the same
  order Build Replay will use). Each chapter: two or three sentences on the system, its data layers (today's Inspect topics), and later its
  parameters to try. Over the world: the legend (bottom left), the probe crosshair and hover readout, pinned cards. Time and camera move to a
  compact strip at the bottom of the viewport, shared by both experiences.
- **Build Replay** (later) is a scrubber in that bottom strip in How It's Made: drag through the stages; the current chapter follows the scrubber.
- **What moves where.** Inspect (section 04) leaves the Explore World sidebar and becomes How It's Made's chapters. Visual filters stay in
  Explore World (they are about the look, not the process).

## Completed (0.3, through Round 08G)

**World systems.** Terrain with geology map (slope, convexity, cliff, near-water) and relief; lakes, rivers with confluences and mouths, rim falls; ecology fields (light, moisture, habitat) and ground weights; Lab plants on the island; Living Architecture with growth, fusion and lifecycle; creatures; day cycle, weather timeline, evolution years.

**Black Stage visual.** Geological rock model (formations, mudstone lenses, scree, staining); pink-to-purple stratified underside; teal water with depth tones, translucent shallows and sand bed; river current and fall streaks with bounded flow animation; three-tone light planes on the smoothed relief normal (no level-of-detail flicker), violet cast shadows from the shadow map only; continuous sunset and sunrise; night with readable materials; hot-reload safeguard for shader modules.

**Stability fixes.** Lake surface overlaps and outlet shelves; terrain skirts leaking through lakes (centroid depth); erased shadows on glancing slopes; shadow stepping during playback; shadow-map recompiles at the horizon; probe readings under haze.

**Inspect (first version).** Five topics (Terrain, Water, Vegetation, Architecture, Light) over the data views; legend overlay with two-way highlighting; hover readout via a GPU probe of what each view actually draws; Point & Inspect callout from the world's data; cast shadow now kept separate from the day's ecological light.

## Current issues

| Issue | Status |
|---|---|
| White dotted lines over lakes (reported) | Not reproduced. Terrain leaks and wind-ripple lines fixed; needs a screenshot with time and camera |
| Inspect card: rock unit ignores the strata's ±12 m warp; "Colour here" uses raw ground weights (the render averages over 20–45 m); shadow ray traces terrain only | Known approximations, stated in code |
| Architecture layer: data exists only in habitat tiles near the camera, so the map read as an incomplete patchwork | Withdrawn from Inspect in 08H. To return as an island-wide map of footprint, shelter and shade (needs the habitat computed for every structure, not only near the camera) |
| Night water and night palette | Tuned in 08G; needs review in motion |
| Midday stays soft (high sun lights most faces) | Physically expected; revisit only if it reads flat |

## Future work

**Explore World.** Bioluminescence and nocturnal creature behaviour; narrative pass on the Guide; Explore-mode refinements; sound.

**How It's Made.** A separate mode with:
- **Build Replay**, fast and deterministic: terrain → water → vegetation → architecture → creatures, each stage drawn as it is computed, with a scrubber.
- **System explanations:** one page per system (geology, hydrology, ecology, architecture, creatures) linked to Inspect layers.
- **Data structures:** the fields and maps (16 m island fields, geology and relief maps, ground weights, habitat tiles) shown as they are stored.
- **Parameter experiments:** seed, noon height, rain, ecology thresholds, with side-by-side results.

**Interface.** Sidebar redesign (later, not now); move Inspect into How It's Made.

## Priorities

1. Visual stability and identity of the Black Stage (08G done; review in motion).
2. Inspect as a clear, accurate tool (08G done; move into How It's Made).
3. How It's Made shell and Build Replay.
4. Explore World features (night life, narrative).
5. Sidebar redesign.

## Round log

| Round | Focus | Outcome |
|---|---|---|
| 08D | Lighting restore, night water, hot-reload safeguard | Done |
| 08E–08F | Dark Table qualities, Inspect topics and click card | Done; shading too busy, cards overlapped |
| 08G | Cleaner planes, night water, hide sun disc; Inspect callout, one card per click, roadmap | Done (details below) |

### Round 08G results

**Done.**
- Light planes cut on the relief normal alone (no mesh-facet share), wider plane edges, 80 % plane / 20 % gradient: fewer, larger forms. Turned-away faces a neutral cool grey; violet reserved for shadow-map cast shadows.
- Illustrated accents reduced to the mudstone-bed outlines (cliff-brow and crest lines removed: they read as contour clutter close up).
- Night water and falls lit by the land's own moonlight, with a quarter of their saturation removed: they dim with the island.
- Sun disc hidden (`SHOW_SUN` in LandscapeView.tsx); sun direction and lighting unchanged.
- Inspect: one card per click (a structure click opens only its own card); anchored callout (diamond marker, leader line, compact summary, Details); card clear of the panel; ring hidden while dragging and while Approach/Explore placement owns the pointer; section title fixed as "Inspect"; Architecture layer labelled (footprint, shelter, shade, near the camera only) with a key-only legend; shared fade-in/out for Inspect and Living Architecture cards (`cardMotion.ts`).

**Verified in the browser.** Same camera at 15:30, 17:36, 22:00; three close orbit steps (no plane flicker); clicks on terrain, water, a structure (organism card only), near the sidebar (card left of the panel), and a drag (no card); Details expands; type-check and build pass.

**Unresolved.**
- Lake dotted lines: still unreproduced.
- The Architecture map cannot be highlighted from its legend (it is a separate overlay); key only.
- Card approximations (strata warp, raw weights, terrain-only shadow ray), as above.
- Dev server: Vite re-bundling dependencies can leave a stale page after many edits; restart the server if the canvas stays blank.

### Round 08H results

**Done.** Inspect has its own probe crosshair (a DOM mark at the pointer) and no longer draws Explore's ground ring, so no ring is left after a
structure click; hover readouts follow the shown layer whether or not pinning is on (the switch is now "Pin a card on click"); readouts for
surfaces a layer is not about are gone; a camera mode change or placement clears any card, readout or crosshair; Living Architecture cards
fade in on every new selection (organism or connection), and the creature card shares the entrance; the Architecture layer is withdrawn.

**Next for the structure.** Build the header switch and move Inspect into How It's Made (above), before Build Replay.

### Round 08I results

**Built.**
- **The switch** (`experience.ts`): *Explore World | How It's Made* beside the version tabs. Same world, camera and time. Switching to How It's
  Made clears Explore's selection; switching back resets the data layer to the final render and removes any pinned card, readout or legend.
- **Explore World:** the panel as before minus Inspect (World controls, World details, Visual filters, Advanced). Living Architecture keeps its
  own picker and card. No probe, crosshair or readout.
- **How It's Made:** the panel shows World controls, a *How it's made* section (Data layers: Normal, Terrain, Water, Vegetation, Light; the
  "Show in the world" toggles; a *Systems · coming* list of the five walkthroughs and Build Replay), Advanced. World details and Visual filters
  are hidden there.
- **Inspect, one rule:** hover gives a one-line readout (the layer's reading, or in Normal the place's or structure's title and first line);
  click pins ONE card (a new click replaces it). Structures are inspected by the same diamond, leader and card, from their simulation state
  (`organismState`: stage, age, vigor, light and moisture, root links; growth and resources under Details); root connections likewise. The
  Living Architecture picker stands down in How It's Made, so its popup never opens there. "Pin a card on click" is gone.
- **One animation:** every card, anchor, ring and leader fades in over 150 ms on mount, keyed by what it shows; removal is immediate; no
  transitions, no exit delays (the 08G `cardMotion.ts` is removed); a card is hidden until its first placement. The hover readout has no entrance.
- **Placement:** the callout card never covers its anchor (beside it, else below or above).

**Layers versus walkthroughs.** The four data layers show what the data is at each place now; they are not explanations of how it was made.
The future system walkthroughs (Terrain, Water, Vegetation, Architecture, Creatures) explain the process, step by step. Water's layer shows the
hydrology's result (rivers, lakes, flow direction); the Water walkthrough must also show the flow particles that trace the drainage.

**Verified in the browser.** Explore: hover shows nothing; a structure click opens its own popup. How It's Made: hover on ground, on a structure
and in the Terrain layer; clicks on ground, another place, a structure and ground again (one card each time, replaced, never the popup);
150 ms fade on every new card (ground and structure alike); switching back clears everything; the card clear of its anchor. `npm run build`
(includes `tsc -b`) passes.

**Open.** The time and camera strip at the bottom of the viewport (proposed) is not built: How It's Made still uses the panel's World
controls. Walkthroughs and Build Replay are placeholders only.

### Recommended next task

**Review Phase 1A's layout, then Phase 1B (interaction architecture)**: one pointer router, one selection store, a shared card shell with
entity-specific content, one anchor and one fade, with B1 and B2 fixed in the same pass. Build Replay waits for Milestone 3 (v0).
