# Week 3: Procedural Noise and Terrain

## Why This Matters

This exercise teaches a reusable idea in procedural world building:

> Ask math for elevation numbers, then reuse those numbers as both a map and a landscape.

Instead of sculpting terrain by hand, the app samples **procedural noise**, builds a **height field**, optionally runs a **simulation** on it, and shows the result in **2D** and **3D**.

---

## Key Concepts

### Procedural noise and height fields

**Procedural noise** is a function of coordinates:

```text
value = noise(x, z)
```

It is not coin-flip randomness. Nearby points tend to have similar values, so the result looks like hills instead of TV static.

A **height field** (heightmap) is a grid of those values. In this project it is a `Float32Array` of size `resolution × resolution`, with values roughly in `[-1, 1]`.

That grid is the shared data structure of the exercise.

### Frequency, amplitude, and resolution

| Parameter | What it controls | Visual effect |
|---|---|---|
| **Frequency** | How fast noise changes across space | Higher = smaller, tighter features |
| **Amplitude** | How strongly a layer scales height | Higher = taller contribution from that layer |
| **Resolution** | How many samples across the map | Higher = smoother map/mesh, more cost |
| **Weight** | How much a layer counts in the blend | Higher = that layer dominates more |

In code, frequency is applied when sampling:

```text
sample at (x * frequency, z * frequency)
```

Amplitude is applied after shaping. Weight is used when averaging layers together.

### Noise types in this project

All types answer the same question — “what value is here?” — with different looks:

| Type | Feel |
|---|---|
| **Perlin** | Smooth, classic rolling hills |
| **Simplex** | Similar to Perlin, often a bit cleaner |
| **Value** | Patchier / blotchier |
| **Cellular / Worley** | Cells and cracks from nearest feature points |

### Shaping operations

Shaping transforms raw noise after sampling. It does not invent a new world from scratch; it changes the personality of the values you already have.

| Shaping | Idea |
|---|---|
| **None** | Use raw noise |
| **Ridged** | Fold valleys into sharp crests |
| **Billow** | Turn both lobes into rounded hills |
| **Turbulence** | Stack absolute noise at several scales |
| **Terracing** | Snap heights into flat bands |
| **Power Curve** | Sharpen or soften contrast with an exponent |
| **Domain Warping** | Bend sample coordinates before looking up noise |

Useful intuition:

- Ridged ≈ mountain spines  
- Terracing ≈ stepped topography  
- Domain warp ≈ swirled / less grid-like forms  

### Combining multiple noise layers

One noise pass often looks too simple. This exercise stacks **layers**.

Each layer has its own:

- noise type
- frequency / amplitude / weight
- shaping
- enabled / disabled switch

The final height is a **weighted average** of enabled layers (after each layer is shaped and scaled). That is how you mix:

- a low-frequency layer for broad landforms
- a mid layer for hills
- a high-frequency or cellular layer for detail / breakup

Relevant logic lives in `generateHeightmap` / layer blending in `app/src/noise/`.

### Same height data → 2D map and 3D terrain

The important mental jump:

| View | What it does with the height field |
|---|---|
| **2D Map** | paints values as an image (grayscale for height) |
| **3D Terrain** | pushes plane vertices up/down by those values |

So if a bright blob appears in 2D, you should expect a raised area in 3D. They are not separate worlds; they are two readings of one array.

In the Assignment 2 pipeline:

- **2D Map** shows the **noise-generated** base height field
- **Simulation Map / 3D Terrain** show the **simulated** height field (erosion result)

### Noise generation vs simulation

This is one of the biggest conceptual distinctions in the project.

| | Noise generation | Simulation (hydraulic erosion) |
|---|---|---|
| Nature | Deterministic function of coordinates | Stateful process over time |
| Input | World position + layer settings | Current height + water + sediment |
| Output | Initial height field | Modified height field |
| Revisiting | Same place → same base terrain | Carved state is not stored forever |

Noise answers: “What should the land look like here?”  
Simulation answers: “What happens after rain flows across this land for a while?”

### Hydraulic erosion, conceptually

The simulation in `hydraulicErosion.ts` is intentionally simple. Each cell tracks:

- **height** — terrain elevation  
- **water** — water depth  
- **sediment** — dirt suspended in that water  

One step roughly does:

```text
rain
  → water flows downhill (4 neighbors)
  → steep / fast flow erodes (lowers height, picks up sediment)
  → sediment is carried with the water
  → flatter areas deposit sediment (raises height)
  → water evaporates
```

Carrying capacity depends on slope and water amount:

- steep + lots of water → can carry more → carves channels  
- flat / little water → drops sediment → fills basins  

The Simulation Map’s **Height / Water / Sediment** modes only change visualization. They do not change the math.

### World-coordinate navigation

Noise is sampled in an infinite coordinate domain. The visible window is one `resolution × resolution` patch.

WASD / arrow keys move a **world offset** `(x, z)`. Sampling becomes:

```text
sample(worldX + localU, worldZ + localV)
```

Because noise is deterministic:

- moving scrolls into neighboring terrain continuously  
- returning to old coordinates restores the same **base** terrain  

**Why erosion resets when you move:**  
erosion state (water, sediment, carved channels) exists only for the current viewport buffers. This project does not cache every visited region’s eroded history. When the offset changes, the app regenerates the noise height field for the new region and resets simulation buffers from that base. That keeps navigation simple and honest: noise is permanent; erosion is a temporary process on the region you are looking at.

### Generation vs visual / rendering features

Some features change the **data**. Others only change how it **looks**.

| Feature | Changes terrain numbers? | Role |
|---|---|---|
| Noise layers / shaping | Yes | Generates the height field |
| Hydraulic erosion | Yes | Modifies heights over time |
| World offset | Yes (which region is sampled) | Chooses where in the infinite world you are |
| Elevation coloring | No | Vertex colors by height |
| Fog | No | Atmosphere / depth cue |
| Wireframe (`F`) | No | Mesh display mode |
| Water / Sediment map modes | No | Inspect simulation buffers |

Keeping these separate helps you debug: if the shape is wrong, look at generation/simulation. If only the look is wrong, look at rendering.

---

## Mental model / pipeline

```text
world offset (WASD)
        │
        ▼
coordinates on a grid
        │
        ▼
noise layers  →  shaping  →  amplitude  →  weighted blend
        │
        ▼
base height field          ←── deterministic generation
        │
        ├── 2D Map (noise preview)
        │
        ▼
hydraulic erosion          ←── stateful simulation
  (water / sediment / time)
        │
        ▼
simulated height field
        │
        ├── Simulation Map (Height / Water / Sediment views)
        └── 3D Terrain
              ├── vertex displacement
              ├── height-based colors
              ├── fog
              └── wireframe toggle
```

One sentence version:

**Generate a height field from noise, optionally simulate processes on it, then visualize the same numbers in multiple ways.**

---

## Try It

1. Build a landscape with one Perlin layer, then add a second finer layer with lower weight.  
2. Compare Ridged vs Billow on the same base noise.  
3. Switch between 2D Map and 3D Terrain and match bright regions to hills.  
4. Run erosion, then inspect Height / Water / Sediment modes.  
5. Move with WASD, note continuous terrain, then return and confirm the base landforms match.  
6. Toggle fog and wireframe and notice the terrain *data* did not change.

<!-- Record observations or screenshots here after class. -->

---

## What I Learned

<!-- Write this yourself. What surprised you about layers, shaping, erosion, or navigation? -->

---

## References

**This project**
- `app/src/noise/` — noise types, shaping, layer blending, world-offset sampling  
- `app/src/simulation/hydraulicErosion.ts` — rain / flow / erosion / deposition / evaporation  
- `app/src/App.tsx` — tabs, world offset, simulation wiring  
- `app/src/scene/exercises/NoiseExercise.tsx` — height displacement + elevation colors  

**External**
- [The Book of Shaders — Noise](https://thebookofshaders.com/11/)  
- [Red Blob Games — Terrain from Noise](https://www.redblobgames.com/maps/terrain-from-noise/)
