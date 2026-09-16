# Procedural World Building

A collection of weekly experiments exploring procedural generation
techniques for world building using React and Three.js.

## Progress

| Week | Topic | Key Concepts | Notes |
|------|-------|--------------|-------|
| 2 | Three.js Basics | scene, geometry, camera, lighting, OrbitControls | [Cube Exercise](...) |
| 3 | Procedural Maps & Terrain | noise, height fields, frequency, amplitude, shaping, layers, hydraulic erosion | [Noise & Terrain](docs/tutorials/week03-procedural-noise-and-terrain.md) |
| 4 | Erosion & Biomes | — | — |

## Current Experiment

### Procedural Maps & Terrain

![Procedural terrain](docs/images/week03/terrain-3d.png)

Week 3 explores procedural noise as a height field, layering and shaping
noise to generate terrain, and modifying the resulting terrain through
hydraulic erosion.

## Repository Structure

- `app/` — React + Three.js application and weekly exercises
- `docs/tutorials/` — notes explaining procedural techniques
- `docs/planning/` — project planning and feature backlog
- `docs/analysis/` — analysis and experiments
- `docs/images/` — screenshots of weekly work
- `references/` — visual and conceptual references

## Running Locally

```bash
cd app
npm install
npm run dev

