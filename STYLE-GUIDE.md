# Style Guide

**Status:** v0.2 — Established Direction  
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

## Open Decisions

The following remain intentionally unresolved:

- exact color palette
- final UI layout
- terrain material details
- lighting parameters
- camera conventions
- semantic meanings of future accent colors
- which further views (section, temporal traces) earn a place

These should be resolved through visual tests and added to this guide as the project develops.

---

## Visual Changelog

### v0.2
- Added **Processes Leave Traces** as a core principle.
- Habitat is now read from accumulated shelter, not instant shadow ("Accumulated shelter reveals habitat").
- **2D ↔ 3D** became **Many Ways of Seeing**: world, field, plan, section, and temporal traces as readings of one ecology.
- Typography resolved into three roles: Unbounded for display, system sans for interface, monospace for procedural data. Added a shared type scale and restrained uppercase tracking.
- Recorded studies from the Shadow Ecology prototype.

### v0.1
Initial direction established from the Shadow Ecology concept, visual references, Week 03 visual studies, and interface audit.
