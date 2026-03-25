# Software City — Isometric World Rebuild — Complete Implementation Prompt
Date: 2026-03-16
Status: Implementation-ready. Single file replacement only.
Target renderer: React Three Fiber (R3F) + Three.js OrthographicCamera
Reference visual: Kenney city-kit-commercial + city-kit-suburban + city-kit-industrial (see attached images)
Executing model: Claude Opus 4.6 — required for sustained coherence across 800+ line TypeScript file

---

## CRITICAL INSTRUCTIONS BEFORE YOU WRITE A SINGLE LINE

### Step 0 — Read existing files first

Before writing anything, read these files in full:

**1. Read the existing CityMap.tsx:**
```
artifacts/software-city/src/components/city/CityMap.tsx
```
This file contains working logic you must preserve exactly:
- Mouse wheel zoom toward cursor (uses mouse position to zoom into point under cursor, not screen center)
- Pointer drag with 3px threshold before drag activates (`isDragging.current = true` only after `Math.abs(dx) > 3 || Math.abs(dy) > 3`)
- Pointer capture on drag start, release on pointer up
- Tooltip 200ms hide debounce (`hideTooltipTimer` setTimeout of 200ms on mouse leave)
- Minimap collapsible panel with district click to zoom (sets center + zoom level)
- `onVisibleCountChange` callback (called with visible/total building counts)
- F3 debug metrics hook (the parent `CityView.tsx` attaches a keydown listener for F3)
- Season particle system (winter snowflakes, autumn leaves, spring petals, summer empty)
- LOD thresholds `LOD_LOW = 0.4` and `LOD_HIGH = 1.5` driving label and detail visibility
- `connectedBuildingIds` — buildings connected to selected building via roads get green rings
- `resolvedActiveBuildingColors` — active agent building gets colored ring matching agent color
- `flashedBuildings` — buildings flashing red/alarm get ping animation
- `highlightDistrictId` — highlighted district gets brighter border

All of this behavior must be present in the new renderer. The parent `CityView.tsx` is not changing.

**2. Inventory actual GLB files on disk:**
```bash
find artifacts/software-city/public/assets/kenney/packs -name "*.glb" | sort > /tmp/glb-inventory.txt
cat /tmp/glb-inventory.txt
```
Read this output carefully. Every asset path used in the implementation MUST match an actual file from this inventory. Do not invent path variations. Do not assume a filename — verify it against the inventory. The difference between `building-a.glb` and `buildingA.glb` silently breaks the renderer with no error — `useGLTF` returns an empty scene without throwing.

**3. Read current package.json:**
```
artifacts/software-city/package.json
```
Verify React version, Vite version, and existing dependencies before writing imports.

---

## OUTPUT INSTRUCTIONS

Generate the complete `CityMap.tsx` replacement file in a single pass.

- No placeholders
- No `// TODO` comments
- No scaffolding stubs
- No "implement this later" sections
- No markdown fences around the output
- Start directly with the import statements
- The output must be a single complete compilable TypeScript file
- Do not explain what you are doing — output only the file content

---

## SECTION 0 — What You Are Replacing and What You Are NOT Touching

### Replace entirely
```
artifacts/software-city/src/components/city/CityMap.tsx
```
This is the only file being replaced. It is currently an SVG-based city renderer.

### Do NOT touch — ever
- `HUD.tsx` — stays as HTML overlay
- `BuildingInspector.tsx` — stays as HTML panel
- `AppLayout.tsx` — stays as sidebar/layout shell
- `CityView.tsx` — stays unchanged, it is the parent
- `Agents.tsx`, `KnowledgeBase.tsx`, `Landing.tsx` — unchanged
- All backend files (`cityAnalyzer.ts`, `agentEngine.ts`, `orchestrator.ts`, etc.) — frozen
- The `CityLayout` JSON schema from the API — frozen
- All Tailwind/shadcn UI components — untouched
- `package.json` — only additions allowed (new dependencies), no removals or changes

### The integration contract — props interface is frozen

The new `CityMap.tsx` must export a function named `CityMap` accepting exactly these props:

```typescript
interface CityMapProps {
  layout: CityLayout;
  agents: Agent[];
  activeBuildings: Set<string>;
  activeBuildingColors?: Map<string, string>;
  selectedBuildingId: string | null;
  onSelectBuilding: (id: string) => void;
  highlightDistrictId?: string | null;
  flashedBuildings?: Set<string>;
  npcThoughts?: Map<string, string>;
  onVisibleCountChange?: (visible: number, total: number) => void;
}
```

`CityLayout`, `Agent`, `Building`, `District`, `Road` types come from `@workspace/api-client-react` — same as the existing file. Do not redefine them.

### The outer div contract — must match exactly

The existing `CityMap` returns:
```tsx
<div
  ref={containerRef}
  className="w-full h-full relative overflow-hidden bg-background transition-colors duration-1000"
  style={{ backgroundColor: seasonBackground }}
>
```

The new `CityMap` must return the same outer div structure so the parent layout does not break. The `<Canvas>` must be a direct child of this div. HTML overlays (zoom controls, minimap, tooltip) must be absolutely positioned siblings of the Canvas inside this div — not inside the R3F scene.

---

## SECTION 1 — Dependency Installation

Run this before implementing. This is a pnpm workspace — the filter flag is mandatory:

```bash
pnpm --filter @workspace/software-city add three @react-three/fiber @react-three/drei @react-spring/three
pnpm --filter @workspace/software-city add -D @types/three
```

Do NOT use `npm install`. Do NOT run `pnpm add` at the monorepo root without `--filter`. Both will fail or corrupt the workspace.

### TypeScript JSX namespace fix

If TypeScript complains about JSX element type in R3F components, add this at the top of the file:
```typescript
/** @jsxImportSource @react-three/fiber */
```

### Core stack

| Layer | Technology | Purpose |
|---|---|---|
| 3D engine | Three.js r160+ | Scene graph, geometry, materials |
| React bridge | @react-three/fiber | Declarative Three.js in React |
| Helpers | @react-three/drei | MapControls, useGLTF, Html, Instances, Sky |
| Animation | @react-spring/three | Agent spring movement |
| Camera | OrthographicCamera | True isometric, no perspective distortion |
| Assets | Kenney GLB (on disk) | Actual building and road models |

---

## SECTION 2 — Vite Static Asset Rule (Critical)

Vite does NOT process GLB files through the module system. All GLB paths must be served as static public assets accessed via URL strings. This is non-negotiable.

```typescript
// CORRECT — URL string from public directory
useGLTF('/assets/kenney/packs/city-kit-commercial/Models/GLB format/building-a.glb')

// WRONG — never do this
import modelUrl from './building-a.glb'
import modelUrl from '../../../public/assets/...'
```

The `public/` directory in Vite is served at `/`. So `artifacts/software-city/public/assets/kenney/...` is accessed as `/assets/kenney/...` in the browser.

Every single `useGLTF()` call in the file must use a string path starting with `/assets/kenney/packs/`.

---

## SECTION 3 — Camera Specification

```typescript
// Isometric camera — do NOT change these values
// Light comes from top-left (matching Kenney reference images)
const CAMERA_POSITION: [number, number, number] = [50, 50, 50]
const CAMERA_TARGET: [number, number, number] = [0, 0, 0]
const FRUSTUM_SIZE_DEFAULT = 40

// In the Canvas, use orthographic camera:
<Canvas
  orthographic
  camera={{
    position: CAMERA_POSITION,
    zoom: 1,
    near: 0.1,
    far: 1000,
  }}
  shadows
>
```

The camera angle of 45° azimuth + ~35° elevation from these position values gives the correct Kenney isometric look. The `orthographic` prop on Canvas plus the position vector achieves this without manually constructing the matrix.

---

## SECTION 4 — Coordinate System Contract

Everything in the file must agree on these values. This is the most common source of silent failures.

### World tile unit
```
1 tile unit = 2 Three.js world units
Kenney road-straight.glb = [1, 0.02, 1] in glTF units
After MODEL_SCALE = 2.0, each tile occupies 2×2 world units
```

### Axis orientation
```
X axis: east  (positive = right on isometric screen)
Z axis: south (positive = down on isometric screen)
Y axis: up    (height — buildings grow upward)
Ground plane: Y = 0
Buildings base: Y = 0
Roads: Y = 0.01 (prevents z-fighting with ground)
District pads: Y = 0.005
Props (trees, lamps): Y = 0
Agent spheres: Y = 0.3
```

### Pixel-to-tile conversion

`cityAnalyzer.ts` outputs pixel positions (x, y) in screen space ranging 20–3500+. Convert to tile grid:

```typescript
interface WorldBounds {
  minX: number; minY: number; maxX: number; maxY: number
  tileWidth: number; tileDepth: number
}

function computeWorldBounds(layout: CityLayout): WorldBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  layout.districts.forEach(d => {
    minX = Math.min(minX, d.x)
    minY = Math.min(minY, d.y)
    maxX = Math.max(maxX, d.x + d.width)
    maxY = Math.max(maxY, d.y + d.height)
  })
  const pixelWidth = maxX - minX
  const pixelHeight = maxY - minY
  const tileWidth = Math.ceil(pixelWidth / 60)
  const tileDepth = Math.ceil(pixelHeight / 60)
  return { minX, minY, maxX, maxY, tileWidth, tileDepth }
}

function pixelToWorld(
  pixelX: number,
  pixelY: number,
  bounds: WorldBounds
): [number, number] {
  const TILE_SIZE = 2
  const normalX = (pixelX - bounds.minX) / (bounds.maxX - bounds.minX)
  const normalZ = (pixelY - bounds.minY) / (bounds.maxY - bounds.minY)
  return [
    normalX * bounds.tileWidth * TILE_SIZE,
    normalZ * bounds.tileDepth * TILE_SIZE,
  ]
}
```

Do NOT modify `cityAnalyzer.ts`. All conversion happens in the renderer.

---

## SECTION 5 — District-to-Visual-Zone Mapping

This determines which Kenney pack and which visual style each district uses.

### Zone assignment

```typescript
type VisualZone = 'COMMERCIAL' | 'INDUSTRIAL' | 'SUBURBAN' | 'UTILITY' | 'CIVIC'

function getVisualZone(district: District): VisualZone {
  const buildingCount = district.buildings.length
  switch (district.type) {
    case 'api':      return 'COMMERCIAL'
    case 'database': return 'INDUSTRIAL'
    case 'config':   return 'UTILITY'
    case 'test':     return 'SUBURBAN'
    case 'docs':     return 'CIVIC'
    case 'assets':   return 'CIVIC'
    case 'root':     return 'COMMERCIAL'
    case 'source':
      return buildingCount > 10 ? 'COMMERCIAL' : 'SUBURBAN'
    default:
      return buildingCount > 10 ? 'COMMERCIAL' : 'SUBURBAN'
  }
}
```

### Visual identity per zone (match Kenney reference images)

**COMMERCIAL** (image 3 reference):
- White building bodies with dark gray horizontal banding
- Blue glass curtain wall panels on tall buildings
- Buildings packed tight, almost no gap between footprints
- Small green accent trim at ground floor storefronts
- Street lamps at every corner
- Cool blue-gray asphalt ground `#8899AA`
- No trees inside core, small trees only at block corners

**INDUSTRIAL** (image 1 reference):
- Dark charcoal/slate building color `#4A5568`
- White trim details and orange/yellow garage door accents
- White cylinder smokestacks with orange banding
- Large yellow cylindrical storage tanks
- Dark gray concrete ground `#7A8088`
- Wide service roads
- Zero trees inside zone core
- Conveyor elements connecting large buildings

**SUBURBAN** (image 2 reference):
- White building bodies
- Bright Kelly green roofs `#4CAF50`
- Orange/brown tree trunks with cone and round tree shapes
- Green ground surface `#88AA88`
- Narrow local roads
- 1-3 trees per house lot
- Varied house footprints (L-shaped, corner units)

**UTILITY**:
- Small dark industrial structures
- Fenced compound appearance
- Dark ground, no trees
- Low-profile buildings only

**CIVIC**:
- Light suburban style
- More open space between buildings
- Green ground, a few trees

---

## SECTION 6 — File-to-Building Model Mapping

### How a file becomes a specific building

Three values from each `Building` object drive model selection:
1. `building.floors` — derived from `Math.ceil(linesOfCode / 50)`, capped at 10
2. `building.complexity` — cyclomatic complexity, capped at 50
3. `building.fileType` — `'class' | 'function' | 'api' | 'database' | 'config' | 'test' | 'entry' | 'unknown'`

### COMMERCIAL zone model selection

```typescript
function getCommercialModelKey(building: Building): string {
  if (building.floors >= 8)                                    return 'commercial-skyscraper'
  if (building.floors >= 5)                                    return 'commercial-large'
  if (building.floors >= 3 && building.fileType === 'api')     return 'commercial-glass'
  if (building.floors >= 3 && building.fileType === 'entry')   return 'commercial-landmark'
  if (building.floors <= 2 && building.fileType === 'config')  return 'commercial-small'
  return 'commercial-medium'
}
```

### INDUSTRIAL zone model selection

```typescript
function getIndustrialModelKey(building: Building): string {
  if (building.complexity >= 40) return 'industrial-large'    // + place smokestack prop
  if (building.complexity >= 20) return 'industrial-factory'
  if (building.complexity >= 10) return 'industrial-warehouse'
  return 'industrial-small'
}
// If building.fileType === 'database': always place storage-tank prop adjacent
```

### SUBURBAN zone model selection

```typescript
function getSuburbanModelKey(building: Building): string {
  if (building.fileType === 'test') return 'suburban-campus'  // flat roof
  if (building.floors >= 4)        return 'suburban-large'
  if (building.floors >= 2)        return 'suburban-medium'
  return 'suburban-small'
}
// If building.hasTests === true: place small tree prop next to building
```

### Building footprint in tiles (from complexity)

```typescript
function getBuildingFootprint(building: Building): { w: number; d: number } {
  if (building.complexity >= 40) return { w: 2, d: 2 }
  if (building.complexity >= 20) return { w: 2, d: 1 }
  return { w: 1, d: 1 }
}
```

### Building Y scale (NEVER scale Y)

Do NOT scale buildings on the Y axis. Height comes from model selection, not Y-scaling. Y-scaling distorts Kenney models. The `floors` value maps to model choice only.

### Building rotation (face the nearest road)

```typescript
function getBuildingRotation(
  buildingWorldX: number,
  buildingWorldZ: number,
  nearestRoadX: number,
  nearestRoadZ: number
): number {
  const dx = nearestRoadX - buildingWorldX
  const dz = nearestRoadZ - buildingWorldZ
  return Math.atan2(dx, dz)
}
```

### Setback from road edge

```typescript
const SETBACK: Record<VisualZone, number> = {
  COMMERCIAL: 0,    // right to sidewalk edge
  INDUSTRIAL: 1,    // 1 tile service yard
  SUBURBAN:   0.5,  // half-tile front garden
  UTILITY:    0.5,
  CIVIC:      0.5,
}
```

### Fallback chain — never crash

```typescript
// If GLB not found: specific → category default → box geometry
// Wrap every useGLTF in Suspense with BoxGeometry fallback
// Log failed path to console.warn — never throw
```

---

## SECTION 7 — Asset Paths

### Critical: verify against disk inventory before using

Run `find artifacts/software-city/public/assets/kenney/packs -name "*.glb" | sort` and verify every path below exists. Correct any that differ from what is actually on disk.

```typescript
const ASSET_BASE = '/assets/kenney/packs'

const BUILDING_MODELS: Record<string, string> = {
  // Commercial (city-kit-commercial)
  'commercial-skyscraper': `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-a.glb`,
  'commercial-landmark':   `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-a.glb`,
  'commercial-large':      `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-b.glb`,
  'commercial-medium':     `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-b.glb`,
  'commercial-glass':      `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-c.glb`,
  'commercial-corner':     `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-f.glb`,
  'commercial-small':      `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-g.glb`,

  // Industrial (city-kit-industrial)
  'industrial-large':      `${ASSET_BASE}/city-kit-industrial/Models/GLB format/building-a.glb`,
  'industrial-factory':    `${ASSET_BASE}/city-kit-industrial/Models/GLB format/building-b.glb`,
  'industrial-warehouse':  `${ASSET_BASE}/city-kit-industrial/Models/GLB format/building-c.glb`,
  'industrial-small':      `${ASSET_BASE}/city-kit-industrial/Models/GLB format/building-d.glb`,
  'suburban-campus':       `${ASSET_BASE}/city-kit-industrial/Models/GLB format/building-c.glb`,

  // Suburban (city-kit-suburban)
  'suburban-large':        `${ASSET_BASE}/city-kit-suburban/Models/GLB format/building-a.glb`,
  'suburban-medium':       `${ASSET_BASE}/city-kit-suburban/Models/GLB format/building-b.glb`,
  'suburban-small':        `${ASSET_BASE}/city-kit-suburban/Models/GLB format/building-c.glb`,
  'suburban-corner':       `${ASSET_BASE}/city-kit-suburban/Models/GLB format/building-f.glb`,
}

const ROAD_MODELS: Record<string, string> = {
  'straight':     `${ASSET_BASE}/city-kit-roads/Models/GLB format/road-straight.glb`,
  'bend':         `${ASSET_BASE}/city-kit-roads/Models/GLB format/road-bend.glb`,
  'crossroad':    `${ASSET_BASE}/city-kit-roads/Models/GLB format/road-crossroad.glb`,
  'T-junction':   `${ASSET_BASE}/city-kit-roads/Models/GLB format/road-intersection.glb`,
  'end':          `${ASSET_BASE}/city-kit-roads/Models/GLB format/road-end.glb`,
  'curve':        `${ASSET_BASE}/city-kit-roads/Models/GLB format/road-curve.glb`,
  'roundabout':   `${ASSET_BASE}/city-kit-roads/Models/GLB format/road-roundabout.glb`,
  'bridge':       `${ASSET_BASE}/city-kit-roads/Models/GLB format/road-bridge.glb`,
  'split':        `${ASSET_BASE}/city-kit-roads/Models/GLB format/road-split.glb`,
  'driveway':     `${ASSET_BASE}/city-kit-roads/Models/GLB format/road-driveway-single.glb`,
}

const PROP_MODELS: Record<string, string> = {
  'tree-cone':    `${ASSET_BASE}/nature-kit/Models/GLB format/tree-cone.glb`,
  'tree-round':   `${ASSET_BASE}/nature-kit/Models/GLB format/tree-round.glb`,
  'bush':         `${ASSET_BASE}/nature-kit/Models/GLB format/bush.glb`,
  'smokestack':   `${ASSET_BASE}/city-kit-industrial/Models/GLB format/chimney.glb`,
  'storage-tank': `${ASSET_BASE}/city-kit-industrial/Models/GLB format/tank.glb`,
  'street-lamp':  `${ASSET_BASE}/city-kit-roads/Models/GLB format/light-square.glb`,
  'sign':         `${ASSET_BASE}/city-kit-roads/Models/GLB format/sign-highway.glb`,
  'car-sedan':    `${ASSET_BASE}/car-kit/Models/GLB format/sedan-sports.glb`,
  'car-truck':    `${ASSET_BASE}/car-kit/Models/GLB format/truck.glb`,
  'barrier':      `${ASSET_BASE}/city-kit-roads/Models/GLB format/construction-barrier.glb`,
  'cone':         `${ASSET_BASE}/city-kit-roads/Models/GLB format/construction-cone.glb`,
  'bridge-pillar':`${ASSET_BASE}/city-kit-roads/Models/GLB format/bridge-pillar.glb`,
}
```

### Model scale factors

```typescript
const MODEL_SCALE  = 2.0   // all buildings and roads
const TREE_SCALE   = 1.6   // trees
const PROP_SCALE   = 1.5   // street furniture
const CAR_SCALE    = 1.2   // vehicles
```

### Road tile default orientation

`road-straight.glb` runs along the **Z axis** by default. Rotate `Math.PI / 2` around Y to make it run along X.

```typescript
function getRoadRotation(type: string, direction: string, corner?: string, opening?: string): number {
  if (type === 'straight') {
    return direction === 'horizontal' ? Math.PI / 2 : 0
  }
  if (type === 'bend' && corner) {
    const map: Record<string, number> = { NE: 0, SE: Math.PI/2, SW: Math.PI, NW: -Math.PI/2 }
    return map[corner] ?? 0
  }
  if (type === 'T-junction' && opening) {
    const map: Record<string, number> = { N: 0, E: Math.PI/2, S: Math.PI, W: -Math.PI/2 }
    return map[opening] ?? 0
  }
  return 0
}
```

---

## SECTION 8 — Road Network Generation

Roads are physical tile-based GLB pieces — NOT SVG lines between buildings.

### Road generation algorithm

```typescript
function generateRoadTiles(districts: District[], bounds: WorldBounds): RoadTile[] {
  // Step 1: For each district, generate perimeter road tiles (arterial)
  // Step 2: For large districts (>8 buildings), add bisecting collector road
  // Step 3: Classify each tile by neighbor count:
  //   4 neighbors occupied = crossroad
  //   3 neighbors = T-junction (opening faces empty neighbor)
  //   2 opposite = straight (horizontal or vertical)
  //   2 adjacent = bend (corner faces inward)
  //   1 neighbor = end-cap
  // Step 4: Apply rotation per type (see getRoadRotation above)
  // Step 5: Add one bridge: find longest arterial segment crossing district boundary,
  //         raise Y to 3, use road-bridge.glb + bridge-pillar.glb below
}
```

### Road tile data structure

```typescript
interface RoadTile {
  worldX: number
  worldZ: number
  type: 'straight' | 'bend' | 'crossroad' | 'T-junction' | 'end' | 'bridge'
  direction?: 'horizontal' | 'vertical'
  corner?: 'NE' | 'SE' | 'SW' | 'NW'
  opening?: 'N' | 'E' | 'S' | 'W'
  isElevated?: boolean
  rotation: number
}
```

---

## SECTION 9 — Visual Status System

Code health metrics layer visual state onto building models.

### Status → visual effect

| `building.status` | Visual Effect | Three.js Implementation |
|---|---|---|
| `healthy` | Default, no modification | Normal material |
| `glowing` | Green rim, clean roof | `emissive: new THREE.Color(0x00ff88)`, low intensity 0.15 |
| `warning` | Yellow glow + barrier props | `emissive: 0xffaa00` intensity 0.2 + place barrier props |
| `error` | Orange window glow | `emissive: 0xff6600` intensity 0.3 |
| `fire` | Red glow + particles + point light | `emissive: 0xff2200` intensity 0.5 + particle system + PointLight |
| `dark` | Desaturated, darker | `material.color.multiplyScalar(0.55)` |

### Test coverage → roof appearance

```typescript
function getRoofOpacity(testCoverage: number): number {
  if (testCoverage >= 0.8) return 1.0    // bright, clean
  if (testCoverage >= 0.5) return 0.85   // normal
  if (testCoverage >= 0.2) return 0.7    // slightly weathered
  return 0.5                             // derelict, dark
}
```

### Age → props overlay

```typescript
// age === 'new'    → no extra props
// age === 'modern' → no extra props
// age === 'aged'   → place 1-2 construction-barrier.glb around perimeter
// age === 'ancient'→ place construction-cone.glb × 3 + construction-barrier.glb × 2
```

### Fire building

```typescript
// building.activeEvent === 'fire':
// 1. Set mesh emissive to 0xff2200, intensity 0.5
// 2. Add <pointLight position={[x, 4, z]} color={0xff4400} intensity={2} distance={8} />
// 3. Add particle system: 20 small orange/red Box geometries drifting up with useFrame
// 4. Place construction-barrier.glb on all 4 sides of building
```

### Active agent building

```typescript
// building is in activeBuildings Set:
// Render a pulsing ring (torus geometry) at building base
// Ring color = activeBuildingColors.get(building.id) ?? '#00fff7'
// Ring scale oscillates 1.0→1.3 with useFrame sine wave
```

### Selected building

```typescript
// selectedBuildingId === building.id:
// Render a white selection ring (torus) at building base, larger than active ring
// Connected buildings (connectedBuildingIds): green ring, slightly smaller
// All other buildings when something is selected: reduce opacity to 0.35
```

### Flashed building

```typescript
// flashedBuildings.has(building.id):
// Render a red pulsing ring, larger and faster than active ring
// Add red point light briefly
```

---

## SECTION 10 — Props and Street Dressing

All props use seeded deterministic random. Never use `Math.random()`.

### Seeded RNG (use this exact implementation)

```typescript
function createSeededRandom(seed: number): () => number {
  let s = seed | 0
  return function() {
    s = s + 0x6D2B79F5 | 0
    let t = Math.imul(s ^ s >>> 15, 1 | s)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}
// Seed from district.id string hash:
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}
```

### Commercial district props

```
- Street lamps: every 2 road tiles along all arterial roads
- Trees: 1-3 cone trees at commercial block corners only (not inside blocks)
- Cars: 1-2 parked sedans per block, random rotation ± 5°, random color tint
- Highway signs: at major arterial intersections
- No trees inside commercial core
```

### Industrial district props

```
- Smokestacks: one adjacent to every building with complexity >= 40
- Storage tanks: 1-2 per district, placed in open yard areas
- Trucks: 1-2 parked in service yard of each large industrial building
- Construction barriers: ring around any building with status=warning or age=aged/ancient
- Construction cones: near ancient buildings
- Zero trees inside zone
- Trees only at district boundary (green buffer strip between industrial and adjacent suburban)
```

### Suburban district props

```
- Trees: 1-3 round or cone trees per building lot, placed in front garden area
- Bushes: 1-2 small bushes at house corners
- Cars: 1 sedan per house (in driveway position, 0.5 tiles from front of building)
- Small shrubs along road edges
- Green tree buffer at any boundary shared with industrial district
```

### Prop placement

```typescript
function placeDistrictProps(
  district: District,
  zone: VisualZone,
  bounds: WorldBounds
): PropInstance[] {
  const rng = createSeededRandom(hashString(district.id))
  const props: PropInstance[] = []
  // Place props according to zone rules above
  // Every prop position derived from rng() — never from Math.random()
  // Props must not overlap building footprints
  // Props must not overlap road tiles
  return props
}
```

---

## SECTION 11 — Agent NPC Rendering

### Agent visual specification

```typescript
// Each agent:
// 1. Sphere geometry radius 0.3, Y = 0.3 (sits on road surface)
// 2. Color = agent.color (hex string from API)
// 3. Point light below: color = agent.color, intensity 0.5, distance 4
// 4. <Html> thought bubble above head (Y + 1.5): reuse existing styling
// 5. Spring-animated position: useSpring from @react-spring/three
//    { mass: 1, tension: 50, friction: 10 } — same feel as existing Framer Motion spring

// Status rings (torus geometry around sphere base):
// status=working   → ring color=agent.color, scale oscillates 1.0→1.4 at 1.5Hz
// status=escalating→ orange ring, oscillates 1.0→1.6 at 3Hz
// status=idle      → no ring
```

### Agent position on roads

```typescript
// Snap each agent to nearest road tile center
// Agent world position = [roadTile.worldX, 0.3, roadTile.worldZ]
// If no road tile nearby, place at nearest building entrance
```

### Thought bubble visibility

```typescript
// Show thought bubbles only when camera zoom > threshold (zoomed in)
// Hide when LOD is 'low' or 'mini'
// Content: npcThoughts.get(agent.id) ?? '' — truncate to 40 chars
```

### Spring animation

```typescript
// Use useSpring from @react-spring/three
// Animate to agent.x, agent.y (converted to world coords) when they change
// Same spring config as existing Framer Motion spring in old file
```

---

## SECTION 12 — Sky, Lighting, and Atmosphere

### Sky (mandatory blue daytime — permanent, never dark)

```tsx
// Background color
<color attach="background" args={['#87CEEB']} />

// Atmospheric sky from @react-three/drei
<Sky
  distance={450000}
  sunPosition={[100, 20, 100]}
  inclination={0.49}
  azimuth={0.25}
/>

// Optional light fog for depth
<fog attach="fog" args={['#C8E8F5', 80, 200]} />
```

### Lighting setup

```tsx
// 1. Ambient (fill light — color varies by season)
<ambientLight intensity={0.6} color={SEASON_AMBIENT[layout.season]} />

// 2. Sun (main directional + shadows — light from top-left matching Kenney images)
<directionalLight
  position={[50, 80, 30]}
  intensity={1.4}
  color="#FFF5E0"
  castShadow
  shadow-mapSize-width={2048}
  shadow-mapSize-height={2048}
  shadow-camera-left={-100}
  shadow-camera-right={100}
  shadow-camera-top={100}
  shadow-camera-bottom={-100}
  shadow-bias={-0.001}
/>

// 3. Hemisphere (sky/ground bounce)
<hemisphereLight skyColor="#87CEEB" groundColor="#3A7A3A" intensity={0.4} />
```

### Season ambient colors

```typescript
const SEASON_AMBIENT: Record<string, string> = {
  summer: '#D4E8F5',
  spring: '#D4EFD4',
  autumn: '#EFD4A0',
  winter: '#C8D8E8',
}
```

### Season particles

Preserve the existing season particle system. In the new renderer, implement it as:
- Winter: small white plane geometries drifting down with useFrame
- Autumn: small orange/brown planes drifting down and sideways
- Spring: small pink planes drifting up slowly
- Summer: no particles
- All particles use seeded initial positions, looping via modulo on Y position

### Shadow setup

```tsx
<Canvas shadows>
// Buildings: castShadow receiveShadow
// Road tiles: receiveShadow only
// Ground plane: receiveShadow only
// Trees: castShadow
// Props: castShadow (street lamps, barriers)
```

---

## SECTION 13 — District Ground Zones

```typescript
const DISTRICT_GROUND_COLORS: Record<VisualZone, string> = {
  COMMERCIAL: '#8899AA',
  INDUSTRIAL: '#7A8088',
  SUBURBAN:   '#88AA88',
  UTILITY:    '#7A7A88',
  CIVIC:      '#99AA88',
}

// Under each district, render a BoxGeometry:
// width  = districtWorldWidth + 2 tiles padding each side
// height = 0.01 (very thin slab)
// depth  = districtWorldDepth + 2 tiles padding each side
// position Y = 0.005
// receiveShadow = true
// No castShadow
```

---

## SECTION 14 — Performance Architecture

### Instanced rendering (critical for 300+ buildings)

```typescript
// Group buildings by model key
// Use @react-three/drei <Instances> + <Instance> for each group
// This reduces 300 buildings to ~15 draw calls

// Pattern:
const buildingsByModel = useMemo(() => {
  const groups = new Map<string, Building[]>()
  layout.districts.forEach(d => {
    d.buildings.forEach(b => {
      const zone = getVisualZone(d)
      const key = getModelKeyForZone(b, zone)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(b)
    })
  })
  return groups
}, [layout])

// Then for each group:
<Instances limit={200} castShadow receiveShadow>
  {/* geometry + material from useGLTF */}
  {buildings.map(b => (
    <Instance
      key={b.id}
      position={[worldX, 0, worldZ]}
      rotation={[0, rotation, 0]}
      scale={[MODEL_SCALE, MODEL_SCALE, MODEL_SCALE]}
      color={getStatusColor(b)}
      onClick={() => onSelectBuilding(b.id)}
    />
  ))}
</Instances>
```

### LOD system

```typescript
// Derive LOD from camera zoom level (orthographic camera zoom property)
type LOD = 'full' | 'med' | 'low' | 'mini'

function getLOD(zoom: number): LOD {
  if (zoom > 2.5)  return 'full'   // zoomed in: all details
  if (zoom > 1.0)  return 'med'    // normal: hide cars/small props
  if (zoom > 0.4)  return 'low'    // zoomed out: hide all props, show models
  return 'mini'                     // overview: colored boxes only
}

// full: all models, all props, thought bubbles, all rings
// med:  all models, no cars, no small props, no thought bubbles
// low:  models only, no props, no rings, no labels
// mini: BoxGeometry colored by zone only, no models
```

### GLB preloading

```typescript
// Preload all models at component mount — not lazily
// useGLTF.preload() for each path in BUILDING_MODELS, ROAD_MODELS, PROP_MODELS
// This prevents pop-in as user pans the city
```

### Performance targets

```
60fps on modern laptop with 304 buildings visible
Max draw calls: 200 (instancing achieves this)
Max vertices: 500k visible
One shadow-casting directional light only
Shadow map: 2048×2048
```

---

## SECTION 15 — Interaction System

### Camera controls

```typescript
// Use @react-three/drei MapControls
// Lock rotation: maxPolarAngle and minPolarAngle set to same value
// Allow: pan (drag), zoom (scroll)
// Zoom: adjust camera.zoom, NOT camera.position
// minZoom: 0.15, maxZoom: 8

// Preserve existing zoom-toward-cursor behavior:
// On wheel event, compute the world point under cursor
// Adjust camera position to keep that point stable while zooming
// This is the most important interaction behavior to preserve
```

### Zoom controls (HTML overlay)

```typescript
// + button: camera.zoom *= 1.4, clamp to maxZoom
// fit button: compute zoom to show all districts, animate to it
// - button: camera.zoom *= 0.7, clamp to minZoom
// Position: absolute top-left, same as existing implementation
```

### Building click

```typescript
// onClick on each building mesh/instance
// Check isDragging.current — do not fire click if drag occurred
// Call onSelectBuilding(building.id)
```

### Building hover

```typescript
// onPointerOver: set hoveredBuilding, clear hideTooltipTimer
// onPointerOut: start hideTooltipTimer (200ms debounce before clearing)
// This matches the existing 200ms debounce behavior exactly
```

### Tooltip

```typescript
// Position: fixed top-center of container (not inside R3F scene)
// Same content as existing tooltip: name, filePath, type, LOC, coverage
// Hide at LOD='low' or LOD='mini'
```

### Minimap

```typescript
// Preserve existing minimap exactly — same HTML structure, same collapsible behavior
// District click: animate camera to district world center position
// Use lerp animation over 500ms: useFrame lerps camera.position toward target
```

### Dependency legend

```typescript
// Preserve existing dependency legend (shows when a building is selected)
// Render as HTML overlay, same position as existing (bottom-left)
```

---

## SECTION 16 — CityMap.tsx File Structure

```
CityMap.tsx
├── /** @jsxImportSource @react-three/fiber */
├── Imports (React, R3F, Drei, Three.js, spring, types)
├── Type definitions
│   ├── VisualZone
│   ├── LOD
│   ├── RoadTile
│   ├── PropInstance
│   └── WorldBounds
├── Constants
│   ├── TILE_SIZE, MODEL_SCALE, TREE_SCALE, PROP_SCALE, CAR_SCALE
│   ├── LOD thresholds
│   ├── ASSET_BASE
│   ├── BUILDING_MODELS, ROAD_MODELS, PROP_MODELS
│   ├── DISTRICT_GROUND_COLORS
│   ├── SEASON_AMBIENT
│   └── SETBACK
├── Helper functions
│   ├── computeWorldBounds()
│   ├── pixelToWorld()
│   ├── getVisualZone()
│   ├── getCommercialModelKey()
│   ├── getIndustrialModelKey()
│   ├── getSuburbanModelKey()
│   ├── getBuildingFootprint()
│   ├── getBuildingRotation()
│   ├── getRoadRotation()
│   ├── getStatusEmissive()
│   ├── getRoofOpacity()
│   ├── getStatusColor()
│   ├── createSeededRandom()
│   ├── hashString()
│   ├── placeDistrictProps()
│   └── generateRoadTiles()
├── Sub-components
│   ├── <GroundPlane />
│   ├── <DistrictPad district zone bounds />
│   ├── <RoadNetwork tiles />
│   ├── <BuildingMesh building worldX worldZ zone lod />
│   ├── <DistrictBuildings district zone bounds lod />
│   ├── <DistrictProps district zone bounds lod />
│   ├── <SelectionRing worldX worldZ color />
│   ├── <AgentNPC agent bounds />
│   ├── <FireEffect worldX worldZ />
│   └── <SeasonParticles season />
├── <CityScene props />
│   ├── Sky + color + fog
│   ├── Lights (ambient + directional + hemisphere)
│   ├── GroundPlane
│   ├── districts.map → DistrictPad + DistrictBuildings + DistrictProps
│   ├── RoadNetwork
│   ├── agents.map → AgentNPC
│   ├── selectedBuildingId → SelectionRing
│   ├── fire buildings → FireEffect
│   ├── SeasonParticles
│   └── MapControls (pan + zoom locked rotation)
└── export function CityMap(props: CityMapProps)
    ├── containerRef (div)
    ├── Outer div (w-full h-full relative overflow-hidden)
    ├── <Canvas orthographic shadows gl={{ antialias: true }}>
    │   └── <Suspense fallback={null}>
    │       └── <CityScene />
    ├── HTML: Zoom controls (absolute positioned, top-left)
    ├── HTML: Hover tooltip (absolute positioned, top-center)
    ├── HTML: Dependency legend (absolute positioned, bottom-left)
    └── HTML: Minimap panel (absolute positioned, bottom-right)
```

---

## SECTION 17 — Behaviors Preserved From Existing CityMap.tsx

This section is a checklist. Every item must be present in the new file.

### Mouse/touch interaction
- [x] Wheel zoom toward cursor point (not screen center)
- [x] Left-drag to pan
- [x] 3px threshold before drag activates (`Math.abs(dx) > 3 || Math.abs(dy) > 3`)
- [x] Pointer capture on drag start (`setPointerCapture`)
- [x] Pointer release on `onPointerUp` and `onPointerLeave`
- [x] Click fires only when `isDragging.current === false`
- [x] Tooltip 200ms hide debounce on mouse leave

### Visual state
- [x] Selected building: white selection ring
- [x] Connected buildings: green ring (from `connectedBuildingIds`)
- [x] Dimmed buildings: 0.35 opacity when selection active
- [x] Active agent building: colored ring matching `activeBuildingColors`
- [x] Flashed buildings: red ping animation
- [x] Highlighted district: brighter/stronger border
- [x] Season background color affects ambient light color
- [x] Season particles (winter/autumn/spring/summer)

### HUD and overlays
- [x] `onVisibleCountChange(visible, total)` callback called each frame
- [x] Zoom % indicator (bottom-left text)
- [x] LOD label ('overview' / 'detailed' / empty)
- [x] Zoom +/fit/- buttons (top-left)
- [x] Hover tooltip (name, path, type, LOC, coverage)
- [x] Dependency legend when building selected
- [x] Minimap panel (collapsible, district list, click to navigate)

### Camera
- [x] Zoom toward cursor (mouse wheel)
- [x] Pan (drag)
- [x] Fit button resets to show all districts
- [x] Initial center computed from district bounds

---

## SECTION 18 — What NOT To Do

- **Do NOT modify `cityAnalyzer.ts`** — data contract is frozen
- **Do NOT modify `CityView.tsx`** — parent is frozen
- **Do NOT add Three.js or R3F to any file other than `CityMap.tsx`**
- **Do NOT import GLB files via ES module imports** — use URL strings only
- **Do NOT scale buildings on Y axis** — use model selection for height
- **Do NOT use `Math.random()`** — use `createSeededRandom()` everywhere
- **Do NOT use `position: fixed` inside Canvas** — use R3F `<Html>` or absolute-positioned div siblings
- **Do NOT load the same GLB URL more than once** — use `useGLTF` caching, share instances
- **Do NOT remove any prop from `CityMapProps`** — interface is frozen
- **Do NOT make the background dark** — blue sky is permanent
- **Do NOT put agent AI logic or health scoring in `CityMap.tsx`** — pure renderer only
- **Do NOT use `pnpm add` without `--filter @workspace/software-city`**
- **Do NOT output the file wrapped in markdown code fences** — raw TypeScript only

---

## SECTION 19 — Reference Images (Attached)

Three images are attached to this prompt. Extract the following from each:

**Image 1 — Industrial district reference:**
- Dark charcoal building color `#4A5568` on all factory structures
- Orange/yellow accent on garage doors and pipe elements
- White cylinder smokestacks with orange banding
- Large yellow cylindrical storage tank (prominent, top-right of image)
- Dark gray concrete ground surface throughout
- Wide service roads with clear lane markings
- Absolutely zero trees inside the zone
- Conveyor/pipe elements connecting adjacent large structures

**Image 2 — Suburban district reference:**
- Bright white building bodies on all houses
- Bright Kelly green roofs `#4CAF50` — this is the dominant color of the zone
- Orange/brown tree trunks with cone and round canopy shapes
- Green ground surface
- Narrow local roads
- 1-3 trees per house lot in front garden area
- Varied house footprints — L-shapes, corner units, detached garages

**Image 3 — Commercial district reference:**
- White building bodies with dark gray horizontal banding (2-3 bands per floor group)
- Blue glass curtain wall panels on tall towers
- Buildings packed with almost no gap between footprints
- Small green accent trim at ground floor storefronts
- Street lamps at all corners
- Elevated highway overpass in background — this is the bridge landmark
- Clear hierarchy: very tall towers next to mid-rise next to low retail

Match these visual characteristics exactly in the corresponding zones of the generated city.

---

## SECTION 20 — Definition of Done

The implementation is complete when ALL of the following are true:

**Visual**
- City renders in Kenney isometric style with actual GLB models
- Commercial zones match image 3: white towers, dark banding, glass panels, packed layout
- Industrial zones match image 1: dark charcoal, orange accents, smokestacks, no trees
- Suburban zones match image 2: white walls, green roofs, trees, green ground
- Roads are physical GLB tile pieces — not lines, not SVG
- At least one elevated bridge/overpass landmark visible
- Street lamps at road intersections
- Trees in suburban and commercial boundaries
- At least one smokestack in industrial zone
- Buildings face roads
- Blue sky always visible
- Directional shadows on ground plane
- Buildings in fire status glow red with particles

**Interaction**
- Clicking a building calls `onSelectBuilding` → BuildingInspector opens
- Zoom toward cursor works on mouse wheel
- Pan works on drag with 3px threshold
- Zoom +/fit/- buttons work
- Minimap district click pans camera to district
- Tooltip shows on hover with 200ms debounce on leave

**Performance**
- 60fps with demo dataset (304 buildings) on modern laptop
- Instanced rendering active (confirmed by checking draw calls < 200)

**Code quality**
- No console errors
- TypeScript compiles with zero errors
- No modifications to any file except `CityMap.tsx` and `package.json` dependency additions
- All GLB paths verified against actual disk inventory
