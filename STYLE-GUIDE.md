# Style Guide

**Status:** v0.3 — Established Direction\
**Project:** Procedural World Building  
**Concept:** Shadow Ecology  
**Visual library:** [Procedural World Visual Inspirations](https://www.are.na/erica-tang-9qecvysqjno/procedural-world-visual-references) on Are.na (evolves as references are collected)

## Direction

**An evolving scientific specimen, not a fantasy landscape.**

The world should feel like a living procedural system being observed, mapped, and revealed.

Visual character:

**Precise × Strange × Alive**

The project should remain abstract and symbolic rather than realistic. Geometry, light, shadow, line, movement, and color should help reveal how the procedural system works.

**Beautiful from afar, interesting when inspected closely.** The intended reaction:

**Beautiful → Zoom in → Inspect → Discover relationships → Understand the world differently**

---

## Core Principles

### 1. World First
The procedural world is the primary visual element. Keep the canvas dominant and let interface elements support observation rather than compete with it.

### 2. Dark Field
Use deep charcoal and near-black environments with neutral gray and off-white geometry. Preserve silhouettes and spatial readability even in dark areas.

### 3. Light Reveals Form
Use directional light and meaningful shadow to communicate geometry and structure.

Shadow is only the instant: it moves with the sun and is drawn as lighting, never as a tint. Habitat is slower. It is read from shelter that persists over days.

**Light reveals structure. Accumulated shelter reveals habitat.**

### 4. Processes Leave Traces
The world should show how it changed, not just how it is now. Growth, shelter, exposure, weathering, and decay can leave visible evidence:

- fresh vs aged surfaces
- pale exposed faces vs dark sheltered ones
- worn ground where paths repeat
- habitat that settles only where shade has lasted

Traces are records of process. They are not decoration.

### 5. Data Becomes Graphics
Use visual elements to reveal procedural information rather than as decoration.

- contour → field / elevation
- wireframe → structure / topology
- line → flow / connection
- trace → movement / history
- tone → age / exposure
- accumulated shelter → habitat / protection
- saturated color → active state / force / change

### 6. Color Means Something
Keep the default world predominantly neutral. Use bold color selectively when it communicates something meaningful in the system: each color belongs to one kind of matter or one state.

Do not use saturated color simply as decoration.

### 7. Many Ways of Seeing
The same ecology can be read through different representations, each revealing a different layer:

- **World:** the lit 3D specimen
- **Field:** a single quantity drawn on its own, such as habitat or height
- **Plan:** an abstract survey sheet, north up
- **Section:** what happens under overhangs and inside masses
- **Temporal traces:** how one place changed over days

Every view reads the same world state. A new view should reveal a relationship the others hide, not add another simulation.

The project can move between scientific visualization and spatial environment rather than always behaving like a conventional 3D game world.

---

## World

### World principles
- **Realistic rules, speculative life, stylized representation.** The world obeys plausible physical and ecological constraints; its organisms are invented; both are drawn in a stylized way.
- **Plausible, simplified constraints.** Light, moisture, slope, elevation, and water decide where life can stand. Keep each rule simple enough to read.
- **Fictional organisms, consistent rules.** Every species grows, ages, responds to its surroundings, and interacts by one set of rules, wherever it is seen.
- **Sculptural, not photoreal.** A cohesive visual language of form, silhouette, and restrained natural colour.
- **One world-space scale.** A plant has one position, height, and canopy footprint in every camera mode and level of detail. Distance changes how much is drawn, never how big or where.
- **Observer first; overlays are optional.** The default world is what an observer would see. Coverage, habitat, light, and moisture are overlays the viewer turns on; their colours are never baked into the terrain or plants.

### Geometry
Prefer abstract, structural, and biological forms over literal or realistic objects.

### Material
Favor restrained matte surfaces. Prioritize geometry, silhouette, light, and shadow over realistic textures or decorative material effects. Where surface variation appears, let it record process (age, exposure, moisture, wear).

### Composition
Use negative space deliberately. Explore top-down, orthographic, axonometric, specimen-like, sectional, and close-up views when appropriate rather than relying only on a conventional game camera.

---

## Interface

The interface should feel like **annotations around an experiment**, not a game HUD or settings dashboard.

- Keep the world visually dominant.
- Prefer spacing and typography over cards and containers.
- Use thin rules and restrained surfaces.
- Avoid large stacks of rounded panels.
- Preserve functional clarity.

### Typography
Three typefaces, each with one role:

| Role | Typeface | Use |
|---|---|---|
| **Display / identity** | Unbounded | Major exercise and project titles only |
| **Interface** | System sans | Navigation, controls, buttons, section titles, prose |
| **Procedural data** | Monospace | Values, parameters, coordinates, equations, states, readouts, technical annotation |

Monospace marks what the system is reporting:

`WORLD X 000.00`  
`RES 064`  
`FREQ 4.000`  
`SEED 0042`  
`STATE ACTIVE`

**Scale:** one small shared scale. Display for titles, a card-title step, then four tight interface steps (body, controls, labels, annotations). Hierarchy comes from role, case, and color more than from size.

**Uppercase:** used for labels, not for prose, and always lightly tracked. There are two widths: a standard tracking for most caps, and a wider one for headers that name a region (panel, section, inset). Titles are set slightly tight.

The type tokens live in `app/src/index.css`. Add to the scale rather than introducing one-off sizes.

---

## Avoid

- Photorealistic landscapes
- Generic fantasy environments
- Generic low-poly game aesthetics
- Neon / cyberpunk styling
- Futuristic or machine-like styling
- Cute, overly playful, or strongly dreamy tone
- Glassmorphism
- Dense technical dashboards
- Excessive rounded cards
- Decorative procedural effects without meaning
- Arbitrary gradients or color
- Realistic nature textures
- Visual complexity for its own sake

---

## Visual Studies

Initial Week 03 studies established:

- **Specimen:** dark field, neutral matter, directional light, shadow, negative space
- **Field:** contour and topographic drawing as an information layer
- **Signal:** saturated color works best when tied to procedural state or change

A heavily posterized terrain treatment was tested and rejected. Graphic clarity should come from composition, geometry, contrast, line, and information hierarchy rather than arbitrary tonal bands.

The Shadow Ecology prototype established:

- **Trace:** architecture tone records age and exposure; habitat reads as a granular field built from remembered shelter
- **Plan:** the live world as an abstract survey sheet beside the 3D view

---

## Color Palette Exploration

**Status: Exploring.** Three candidate palettes are being compared. None is chosen, and none is assigned to a world element yet: the aim is to learn how the colors relate, not to fix what each one means. The direction they serve is black and white, strong graphic composition and sculptural form, with restrained color and a few saturated accents (see *Color Means Something*).

Each palette has two neutrals (black and a light gray), one saturated blue, and two supporting colors. The chips below render from the hex codes on GitHub.

### A: Cobalt, Olive, Rust · *Exploring*

![Palette A swatches](docs/images/palettes/palette-a.svg)

`#000000` `#E6E6E6` `#0047AB` `#74776B` `#A3320B`

A cool, clear blue against a gray-green neutral and one burnt, earthy accent. Quiet and mineral, with the rust reading as weathering, heat or iron.

- **Terrain:** olive gray as stone and ground tone, with rust sparingly for exposed or oxidized strata.
- **Water:** cobalt as the saturated signal.
- **Vegetation:** the olive reads as living matter without becoming green.
- **Living Architecture:** light gray and olive for tissue, rust for age or stress.
- **Creatures:** rust as a small, warm mark against the cool field.

### B: Cobalt, Bronze, Red · *Exploring*

![Palette B swatches](docs/images/palettes/palette-b.svg)

`#000000` `#E6E6E6` `#0047AB` `#C89933` `#BF0603`

The warmest and most graphic of the three: primary-like blue, metallic bronze and a pure red. High contrast, with a poster or specimen-plate character; it needs the most restraint to avoid reading as bright or toy-like.

- **Terrain:** mostly black, white and gray, with bronze limited to highlights such as crests or lit faces.
- **Water:** cobalt.
- **Vegetation:** bronze as a dry or seasonal state rather than a green.
- **Living Architecture:** bronze as mineralized or metallic tissue.
- **Creatures:** red as a rare signal of activity or life.

### C: Electric Navy, Olive · *Exploring*

![Palette C swatches](docs/images/palettes/palette-c.svg)

`#000000` `#EFEFEF` `#090C9B` `#646E68` `#4F5D2F`

A deep, vivid blue with two green-gray neutrals and no warm accent. The most natural and the most restrained: color separates blue from everything else, and the rest stays tonal.

- **Terrain:** the gray-green as ground and rock tone.
- **Water:** electric navy, strong against the light neutral.
- **Vegetation:** the dark olive as the only plant-like color, kept dense and low in value.
- **Living Architecture:** light gray, with the gray-green for sheltered or aged surfaces.
- **Creatures:** dark olive, close to the ground tone; any color emphasis would have to come from the blue.

### How these will be judged

By rendered tests in the world, not by swatches. The questions: does the blue stay a signal and not a theme; do the neutrals keep the form legible and sculptural; does the palette stay restrained with all five colors on screen; and does it keep a distinct place for data overlays, which stay optional and are not baked into materials. Until then the world keeps its current neutral palette.

---

## Open Decisions

The following remain intentionally unresolved:

- exact color palette (three candidates are being explored: see *Color Palette Exploration*)
- final UI layout
- terrain material details
- lighting parameters
- camera conventions
- semantic meanings of future accent colors
- which further views (section, temporal traces) earn a place

These should be resolved through visual tests and added to this guide as the project develops.

---

## Visual Changelog

### v0.3
- Added **Color Palette Exploration**: three candidate palettes (A Cobalt/Olive/Rust, B Cobalt/Bronze/Red, C Electric Navy/Olive), all marked Exploring.
- Added **World principles** (realistic rules, speculative life, stylized representation; consistent scale across modes and levels of detail; observer-oriented, with optional data overlays).

### v0.2
- Added **Processes Leave Traces** as a core principle.
- Habitat is now read from accumulated shelter, not instant shadow ("Accumulated shelter reveals habitat").
- **2D ↔ 3D** became **Many Ways of Seeing**: world, field, plan, section, and temporal traces as readings of one ecology.
- Typography resolved into three roles: Unbounded for display, system sans for interface, monospace for procedural data. Added a shared type scale and restrained uppercase tracking.
- Recorded studies from the Shadow Ecology prototype.

### v0.1
Initial direction established from the Shadow Ecology concept, visual references, Week 03 visual studies, and interface audit.
