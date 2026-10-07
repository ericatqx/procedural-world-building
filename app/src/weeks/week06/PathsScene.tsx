import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
  type DataTexture,
} from 'three'
import { GRID_EXTENT } from '../../project/grid.ts'
import { createTerrainMaterial, setTerrainDisplay } from '../../project/materials.ts'
import {
  createImprint,
  downhillField,
  PATH_COLORS,
  revealLine,
  TERRAIN_TOP,
  type PathNode,
  type PathStudy,
  type Point2,
} from './paths.ts'
import { streamGeometry, veinGeometry, type MeshLine } from './pathMeshes.ts'
import { advanceStreamTime, createStreamBankMaterial, createStreamMaterial } from './streamMaterial.ts'
import { STUDY_HALF, studyHeight, type StudyTerrain } from './studyTerrain.ts'
import { themeColor } from '../../shared/ui/theme.ts'

/** What the Study section reveals; each applies to the methods that have it. */
export type PathOverlays = {
  nodes: boolean
  /** Connection: the straight link each curve was drawn from. */
  links: boolean
  /** Flow: the downhill direction across the ground. */
  field: boolean
  /** Growth: the line as grown, in a flat plane above the terrain. */
  source: boolean
  /** Growth: drop lines from the plane to the ground. */
  projection: boolean
  /** Growth: the final spline on the ground, drawn as tapered veins. */
  spline: boolean
}

/** Lines ride this far above the ground so they are not lost in it. */
const LIFT = 0.008
/** The flat plane the Growth line is grown in, this far above the highest ground. */
const PLANE_HEIGHT = TERRAIN_TOP + 0.45
const LINK_WIDTH = 2.6
const ACCENT_FALLBACK = '#ff1f1f'
const VEIN_ROUGHNESS = 0.55
/** Veins keep this share of their colour in shade, so they stay pale against the ground. */
const VEIN_SHADE_FLOOR = 0.5
const NODE_RADIUS = { node: 0.042, source: 0.036, confluence: 0.024, anchor: 0.05, end: 0.026 } as const
const FIELD_RESOLUTION = 28
/** Projection drop lines from every this-many growth vertices, and from each line's end. */
const DROP_EVERY = 3
/** Downhill tick length per unit of gradient, and its cap. */
const TICK = { scale: 0.22, max: 0.075, min: 0.02 } as const
/** Vertices with `aBelow` under this are the top surface and the walls' rim, which the imprint moves. */
const TOP_SURFACE = 0.01
const SLOPE_STEP = 0.02

type Height = (x: number, z: number) => number
type Vec3 = [number, number, number]

/** Marks sit on the unpressed ground, so they cap an imprint rather than sink into it. */
const groundHeight: Height = (x, z) => studyHeight(x, z) + LIFT

const onGround = (height: Height, points: readonly Point2[]): Vec3[] => points.map((p) => [p.x, height(p.x, p.z), p.z])

/** A straight line in plan, sampled densely so it follows the ground. */
function draped(height: Height, a: Point2, b: Point2): Vec3[] {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.03))
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = a.x + ((b.x - a.x) * i) / n
    const z = a.z + ((b.z - a.z) * i) / n
    return [x, height(x, z), z]
  })
}

/** Nodes as flat discs with a dark ring, lying on the slope. */
function NodeMarks({ nodes, height }: { nodes: readonly PathNode[]; height: Height }) {
  const shapes = useMemo(
    () => ({
      disc: new CircleGeometry(0.72, 24).rotateX(-Math.PI / 2),
      ring: new RingGeometry(0.72, 1, 24).rotateX(-Math.PI / 2),
      discMaterial: new MeshBasicMaterial({ color: PATH_COLORS.node, polygonOffset: true, polygonOffsetFactor: -3 }),
      ringMaterial: new MeshBasicMaterial({ color: PATH_COLORS.nodeRing, polygonOffset: true, polygonOffsetFactor: -3 }),
    }),
    [],
  )
  useEffect(
    () => () => {
      shapes.disc.dispose()
      shapes.ring.dispose()
      shapes.discMaterial.dispose()
      shapes.ringMaterial.dispose()
    },
    [shapes],
  )
  const meshes = useMemo(() => {
    const filled = nodes.filter((n) => n.kind !== 'end')
    const disc = new InstancedMesh(shapes.disc, shapes.discMaterial, Math.max(1, filled.length))
    const ring = new InstancedMesh(shapes.ring, shapes.ringMaterial, Math.max(1, nodes.length))
    disc.count = filled.length
    ring.count = nodes.length
    const matrix = new Matrix4()
    const rotation = new Quaternion()
    const up = new Vector3(0, 1, 0)
    const normal = new Vector3()
    const position = new Vector3()
    const scale = new Vector3()
    const place = (mesh: InstancedMesh, node: PathNode, index: number) => {
      const dx = (height(node.x + SLOPE_STEP, node.z) - height(node.x - SLOPE_STEP, node.z)) / (2 * SLOPE_STEP)
      const dz = (height(node.x, node.z + SLOPE_STEP) - height(node.x, node.z - SLOPE_STEP)) / (2 * SLOPE_STEP)
      rotation.setFromUnitVectors(up, normal.set(-dx, 1, -dz).normalize())
      position.set(node.x, height(node.x, node.z) + 0.004, node.z)
      scale.setScalar(NODE_RADIUS[node.kind])
      mesh.setMatrixAt(index, matrix.compose(position, rotation, scale))
    }
    filled.forEach((node, i) => place(disc, node, i))
    nodes.forEach((node, i) => place(ring, node, i))
    disc.instanceMatrix.needsUpdate = true
    ring.instanceMatrix.needsUpdate = true
    return { disc, ring }
  }, [nodes, height, shapes])
  useEffect(
    () => () => {
      meshes.disc.dispose()
      meshes.ring.dispose()
    },
    [meshes],
  )
  return (
    <>
      <primitive object={meshes.disc} />
      <primitive object={meshes.ring} />
    </>
  )
}

/** Small screen-sized squares at points, for the vertices of the Growth study. */
function VertexMarks({ points, color }: { points: readonly Vec3[]; color: string }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(points.flat(), 3))
    return g
  }, [points])
  const material = useMemo(() => new PointsMaterial({ color, size: 3, sizeAttenuation: false }), [color])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  return points.length > 0 ? <points geometry={geometry} material={material} /> : null
}

/** Downhill ticks on the ground, longer where it is steeper. */
function DownhillField({ height }: { height: Height }) {
  const segments = useMemo(
    () =>
      downhillField(FIELD_RESOLUTION).flatMap(({ x, z, dx, dz, slope }): Vec3[] => {
        const length = Math.min(TICK.max, Math.max(TICK.min, slope * TICK.scale))
        const x1 = x + dx * length
        const z1 = z + dz * length
        return [
          [x, height(x, z), z],
          [x1, height(x1, z1), z1],
        ]
      }),
    [height],
  )
  return <Line points={segments} segments color={PATH_COLORS.tick} lineWidth={1.2} transparent opacity={0.7} />
}

/** Flow: the drainage network as channels in the Project's water colours, over a wet bank, their streaks running downstream. */
function Streams({ study, time }: { study: PathStudy; time: number }) {
  const materials = useMemo(() => ({ water: createStreamMaterial(), bank: createStreamBankMaterial() }), [])
  useEffect(
    () => () => {
      materials.water.material.dispose()
      materials.bank.dispose()
    },
    [materials],
  )
  useFrame((_, delta) => advanceStreamTime(materials.water, delta))
  const geometry = useMemo(
    () => streamGeometry(study.paths, study.network?.reaches ?? [], time),
    [study, time],
  )
  useEffect(
    () => () => {
      geometry.water.dispose()
      geometry.bank.dispose()
    },
    [geometry],
  )
  return (
    <>
      <mesh geometry={geometry.bank} material={materials.bank} renderOrder={0} />
      <mesh geometry={geometry.water} material={materials.water.material} renderOrder={1} receiveShadow />
    </>
  )
}

/** Growth: tapered tubes resting on the ground, pressed ground included. */
function Veins({ lines, ground }: { lines: readonly MeshLine[]; ground: Height }) {
  const material = useMemo(() => {
    const vein = new MeshStandardMaterial({ vertexColors: true, roughness: VEIN_ROUGHNESS, metalness: 0 })
    vein.onBeforeCompile = (program) => {
      program.fragmentShader = program.fragmentShader.replace(
        '#include <opaque_fragment>',
        `outgoingLight = max(outgoingLight, diffuseColor.rgb * ${VEIN_SHADE_FLOOR.toFixed(2)});\n#include <opaque_fragment>`,
      )
    }
    vein.customProgramCacheKey = () => 'week06-vein'
    return vein
  }, [])
  useEffect(() => () => material.dispose(), [material])
  const geometry = useMemo(() => veinGeometry(lines, ground), [lines, ground])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} material={material} castShadow receiveShadow />
}

/**
 * The study terrain alone, with a dry world field so no water reads in it.
 * The geometry is this scene's own copy: the imprint moves its top surface.
 */
function Terrain({
  terrain,
  dryField,
  imprint,
  contours,
  wireframe,
}: {
  terrain: StudyTerrain
  dryField: DataTexture
  imprint: ((x: number, z: number) => number) | null
  contours: boolean
  wireframe: boolean
}) {
  const material = useMemo(() => createTerrainMaterial(dryField, dryField, GRID_EXTENT), [dryField])
  useEffect(() => () => material.material.dispose(), [material])
  useLayoutEffect(
    () => setTerrainDisplay(material, { habitat: false, fieldOnly: false, contours, wireframe }),
    [material, contours, wireframe],
  )

  const { geometry, base } = useMemo(() => {
    const copy = terrain.geometry.clone()
    return { geometry: copy, base: Float32Array.from(copy.getAttribute('position').array) }
  }, [terrain])
  useEffect(() => () => geometry.dispose(), [geometry])

  useLayoutEffect(() => {
    const position = geometry.getAttribute('position') as BufferAttribute
    const below = geometry.getAttribute('aBelow')
    const array = position.array as Float32Array
    array.set(base)
    if (imprint) {
      for (let i = 0; i < position.count; i += 1) {
        if (below.getX(i) < TOP_SURFACE) {
          array[i * 3 + 1] = base[i * 3 + 1]! + imprint(base[i * 3]!, base[i * 3 + 2]!)
        }
      }
    }
    position.needsUpdate = true
    geometry.computeVertexNormals()
  }, [geometry, base, imprint])

  return <mesh geometry={geometry} material={material.material} castShadow receiveShadow />
}

export function PathsScene({
  terrain,
  dryField,
  study,
  time,
  overlays,
  imprint,
  imprintDepth,
  contours,
  wireframe,
}: {
  terrain: StudyTerrain
  dryField: DataTexture
  study: PathStudy
  /** Generation step shown; Infinity for the finished run. */
  time: number
  overlays: PathOverlays
  imprint: boolean
  imprintDepth: number
  contours: boolean
  wireframe: boolean
}) {
  const { method } = study
  const lengths = useMemo(
    () =>
      study.paths.map((line) =>
        line.points.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - line.points[i - 1]!.x, p.z - line.points[i - 1]!.z)), 0),
      ),
    [study],
  )
  const paths = useMemo(
    () =>
      study.paths.flatMap((line, index): MeshLine[] => {
        const points = revealLine(line, time)
        return points ? [{ points, depth: line.depth, length: lengths[index]!, index }] : []
      }),
    [study, time, lengths],
  )
  const sources = useMemo(
    () =>
      study.sources.flatMap((line) => {
        const points = revealLine(line, time)
        return points ? [points] : []
      }),
    [study, time],
  )
  const nodes = useMemo(() => study.nodes.filter((n) => n.time <= time), [study, time])

  // The spline presses into the mesh, and the mesh then carries the spline.
  const offset = useMemo(
    () =>
      method === 'growth' && imprint
        ? createImprint(
            paths.map((p) => p.points),
            imprintDepth,
          )
        : null,
    [method, imprint, paths, imprintDepth],
  )
  const surface = useMemo<Height>(() => (offset ? (x, z) => studyHeight(x, z) + offset(x, z) : studyHeight), [offset])
  const height = useMemo<Height>(() => (x, z) => surface(x, z) + LIFT, [surface])

  const growthStudy = useMemo(() => {
    if (method !== 'growth') {
      return null
    }
    const dropped = sources.flatMap((points) =>
      points.filter((_, i) => i % DROP_EVERY === 0 || i === points.length - 1),
    )
    return {
      plane: sources.map((points) => points.map((p): Vec3 => [p.x, PLANE_HEIGHT, p.z])),
      planeVertices: sources.flat().map((p): Vec3 => [p.x, PLANE_HEIGHT, p.z]),
      groundVertices: dropped.map((p): Vec3 => [p.x, height(p.x, p.z), p.z]),
      drops: dropped.flatMap((p): Vec3[] => [
        [p.x, PLANE_HEIGHT, p.z],
        [p.x, height(p.x, p.z), p.z],
      ]),
    }
  }, [method, sources, height])

  const frame = useMemo(
    (): Vec3[] => [
      [-STUDY_HALF, PLANE_HEIGHT, -STUDY_HALF],
      [STUDY_HALF, PLANE_HEIGHT, -STUDY_HALF],
      [STUDY_HALF, PLANE_HEIGHT, STUDY_HALF],
      [-STUDY_HALF, PLANE_HEIGHT, STUDY_HALF],
      [-STUDY_HALF, PLANE_HEIGHT, -STUDY_HALF],
    ],
    [],
  )

  const accent = useMemo(() => new Color(themeColor('--signal', ACCENT_FALLBACK)), [])

  return (
    <>
      <Terrain terrain={terrain} dryField={dryField} imprint={offset} contours={contours} wireframe={wireframe} />

      {method === 'connection'
        ? paths.map((path) => (
            <Line
              key={path.index}
              points={onGround(height, path.points)}
              color={accent}
              lineWidth={LINK_WIDTH}
              toneMapped={false}
            />
          ))
        : null}
      {method === 'flow' ? <Streams study={study} time={time} /> : null}
      {method === 'growth' && overlays.spline ? <Veins lines={paths} ground={surface} /> : null}

      {method === 'connection' && overlays.links
        ? sources.map((points, i) => (
            <Line
              key={i}
              points={draped(height, points[0]!, points.at(-1)!)}
              color={PATH_COLORS.link}
              lineWidth={1.4}
              dashed
              dashSize={0.05}
              gapSize={0.035}
            />
          ))
        : null}

      {method === 'flow' && overlays.field ? <DownhillField height={height} /> : null}

      {growthStudy && overlays.source ? (
        <>
          <Line points={frame} color={PATH_COLORS.source} lineWidth={1} transparent opacity={0.35} />
          {growthStudy.plane.map((points, i) => (
            <Line key={i} points={points} color={PATH_COLORS.source} lineWidth={1.6} />
          ))}
          <VertexMarks points={growthStudy.planeVertices} color={PATH_COLORS.source} />
        </>
      ) : null}
      {growthStudy && overlays.projection && growthStudy.drops.length > 0 ? (
        <>
          <Line
            points={growthStudy.drops}
            segments
            color={PATH_COLORS.projection}
            lineWidth={1}
            dashed
            dashSize={0.03}
            gapSize={0.03}
          />
          <VertexMarks points={growthStudy.groundVertices} color={PATH_COLORS.projection} />
        </>
      ) : null}

      {overlays.nodes && nodes.length > 0 ? <NodeMarks nodes={nodes} height={groundHeight} /> : null}
    </>
  )
}
