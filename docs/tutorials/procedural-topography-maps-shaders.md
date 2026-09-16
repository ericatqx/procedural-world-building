# Session 3: Procedural Topography — Maps and Shaders

## Why This Matters

This session is where the project stops being a blue cube on a grid and starts
becoming a planet. The core skill here is the pipeline that turns *numbers*
into *terrain*: a noise function produces elevation values, those values push
sphere vertices outward, and a shader colors the surface by height.

In the course's learning path this is steps 5–6: noise/heightmaps on a flat
grid, then mapped onto a sphere. Everything that comes later — biomes, water,
vegetation, cities — sits on top of this terrain foundation.

---

## Key Concepts

**Procedural generation**
Creating content from algorithms instead of painting it by hand. "Procedural
topography" means the mountains and valleys are produced by math, not drawn by
an artist. Change a parameter, get a different world.

**Heightmap**
A 2D grid of numbers where each number is an elevation value — higher number
means taller terrain. You can think of it as a grayscale image: white = tall,
black = sea level. The terrain system starts here before mapping onto the sphere.

**Noise**
An algorithm that produces smooth, natural-looking random numbers. Plain
randomness (like flipping a coin) produces jagged, unnatural results. Noise
functions (Perlin noise is the classic one) produce values that change
gradually — neighboring points have similar values — which is why they
produce believable hills and coastlines instead of static.

**Vertices and geometry**
A 3D mesh is made of points called **vertices** connected by triangles. The
sphere you see is actually thousands of flat triangles arranged to look round.
*Displacement* means moving each vertex outward from the sphere's center by
its elevation value. This is what turns a smooth ball into lumpy terrain.

**Material**
In Three.js, a material controls how a surface *looks* — its color, whether
it reflects light, whether it's shiny. A basic material is just "paint this
color." More complex materials can vary color based on data from the geometry.

**Shader**
A small program that runs directly on the GPU (graphics card), once per vertex
or once per pixel, to calculate exactly what color appears on screen. Shaders
are what make the terrain color change by elevation — the GPU runs the coloring
rule millions of times per frame.

**GLSL**
The language shaders are written in (OpenGL Shading Language). It looks similar
to TypeScript/JavaScript in style but runs on the GPU, not in Node.js. In this
project shaders are written as strings inside TypeScript files and handed to
Three.js to compile and run.

**`onBeforeCompile`**
A Three.js hook that lets you *inject* custom GLSL into an existing material's
shader, rather than writing a full shader from scratch. The terrain uses this
to add elevation-based coloring on top of Three.js's built-in lighting.

---

## How It Works

The pipeline has three stages. Each stage transforms the data and hands it to
the next.

```
[ Noise function ]
      |
      |  produces elevation numbers for every point on the sphere
      v
[ Geometry / vertices ]
      |
      |  each vertex is pushed outward by its elevation value
      v
[ Shader / material ]
      |
      |  GPU colors each pixel based on how high that vertex is
      v
[ Rendered frame on screen ]
```

**Stage 1 — Noise to elevation**

The terrain uses two noise layers added together:
- **Macro layer** — low-frequency noise that makes large continental shapes
- **Micro layer** — high-frequency noise that adds surface roughness

Both layers use the vertex's *direction* from the sphere center (not latitude/
longitude angles) as their input. This avoids pinching artifacts at the poles.
The combined output is one elevation number per vertex.

**Stage 2 — Elevation to geometry**

Each vertex is moved *radially* — straight outward from the center — by its
elevation value. Moving along the normal (the direction the surface faces)
keeps the sphere shape intact without introducing any sideways shear.
After all vertices move, Three.js recomputes the surface normals so lighting
still looks correct.

**Stage 3 — Elevation to color (the shader)**

The shader needs to know how "high" each pixel is. The vertex shader computes:

```glsl
vElev = length(position) - uRadius;
```

This is "how far is this vertex from the sphere center, minus the base radius"
— i.e., pure elevation, independent of where on the globe the vertex is.

The fragment shader then maps elevation onto a color ramp — a list of
`{ color, position }` stops, like a gradient editor. The two modes:
- **Gradient** — smooth blend between stops
- **Stepped** — hard color bands at each stop (like a topographic map)

Because the min and max elevation are tracked while building the geometry,
the full ramp always spans the full range of actual terrain — the lowest stop
always lands on the deepest valley and the highest stop on the tallest peak.

---

## Try It

<!-- To be completed after Session 3. -->

<!-- Record results, observations, or screenshots here. -->

---

## What I Learned

<!-- Write this yourself after class and the exercise. What was surprising, confusing, or especially important to remember? -->

---

## References

**Professor's repository**
- `docs/terrain-layer.md` — two-layer noise system, parameters explained
- `docs/sphere-geometry.md` — how the UV sphere is built, vertex displacement pipeline
- `docs/terrain-shader.md` — elevation ramp shader, `onBeforeCompile` injection strategy
- `docs/learning-path.md` — steps 5–6 in the course sequence

**External**
- [Three.js manual — Custom ShaderMaterial](https://threejs.org/manual/#en/shadertoy)
- [The Book of Shaders — Noise](https://thebookofshaders.com/11/)
