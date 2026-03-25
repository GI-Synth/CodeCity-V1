# Software City World Rebuild Plan

Date: 2026-03-15
Status: Planning only (no renderer/UI implementation in this step)

## 1) Goal
Rebuild the city visuals from scratch so it looks like a coherent isometric game world (similar to the reference image), not random boxes.

This plan focuses on:
- Logical district zoning
- Logical road hierarchy and connectivity
- Utility infrastructure placement
- Blue sky daytime world look
- Complete Kenney asset pack gathering

This plan does not implement code yet.

## 2) Visual Direction (Target)
### Style target
- Isometric 2.5D world
- Clean modular buildings with believable road layout
- Dense but readable city blocks
- Blue sky daytime atmosphere (replace dark cyber look)

### Visual quality rules
- No floating buildings
- No roads terminating into building walls
- No disconnected district islands
- No repeated tile spam patterns without variation
- Every district must connect to at least one arterial road

## 3) City Logic Model (Must Make Visual Sense)
## 3.1 District zoning types
Primary visual zones:
- Commercial
- Suburban
- Industrial
- Utility and infrastructure
- Green/public buffers

### Mapping from software semantics to visual zones
Initial deterministic mapping:
- `api` + `entry` + large `source` clusters -> Commercial core
- `database` + high-complexity backend clusters -> Industrial and utility belt
- `test` + medium/low complexity support files -> Suburban and campus-like zones
- `config` + infra/control files -> Utility compounds and control centers
- `docs` + `assets` -> Civic/green/public-facing edges

## 3.2 District adjacency rules
Hard constraints:
- Industrial should not directly border low-density suburban without a road/green buffer
- Commercial should connect to arterial roads and transit routes
- Utility compounds should be near industrial or at district boundaries
- Suburban should prioritize local roads and lower building height variance

Suggested adjacency matrix:
- Commercial: commercial, suburban, utility
- Industrial: industrial, utility, commercial (buffered)
- Suburban: suburban, commercial, green (buffered from industrial)
- Utility: industrial, commercial, suburban
- Green/public: any (as transition zone)

## 3.3 Block and lot generation
World generation order:
1. Create district polygons from city layout clusters
2. Carve arterial/collector roads first
3. Subdivide into blocks
4. Subdivide blocks into lots
5. Place buildings by district rules and lot size
6. Fill remaining empty lots with props/trees/parking/utilities

Lot sizing rules:
- Commercial: medium to large lots, higher floor variance
- Suburban: small to medium lots, lower floor variance
- Industrial: medium to very large lots, service yards
- Utility: fenced compounds, low/medium structures plus towers/equipment

## 4) Road Network Logic (No More Ugly Nonsense Roads)
## 4.1 Road hierarchy
- Arterial: district-to-district backbone
- Collector: district internal connectors
- Local: block access roads
- Service roads: industrial and utility access
- Elevated and bridge segments only when needed by terrain/network crossings

## 4.2 Graph construction algorithm
Deterministic approach:
1. Compute district centroids
2. Build minimum spanning tree for guaranteed connectivity
3. Add loop edges for redundancy (target cycle ratio)
4. Snap graph edges to road tile grid
5. Validate intersections and endpoint legality
6. Generate collectors inside district boundaries
7. Generate locals from block subdivision

Validation constraints:
- Every building lot must reach a traversable road
- No dead-end arterials
- No impossible turns at modular junctions
- Intersections must use valid junction pieces (crossroad, T, bend, roundabout)

## 4.3 Road module system (from gathered assets)
Road kit supports:
- Straight, bend, split, intersection, crossroad, roundabout
- Side roads and driveways
- Barrier variants
- Slant/high/bridge pieces
- Bridge pillars and traffic props

Road piece index captured in:
- `artifacts/software-city/public/assets/kenney/roads-pieces.txt`

## 5) Utility Logic
Utility layer requirements:
- Power generation nodes (industrial belt)
- Substations/distribution near commercial/suburban boundaries
- Water and drainage corridors where applicable
- Service access roads for all utility compounds

Placement rules:
- Utility nodes cannot block arterial flow
- Utility compounds must be reachable by service roads
- High-impact utility visuals should be separated from suburban by buffer roads/green strips

Utility asset sources in gathered packs:
- Industrial structures and smokestacks (city-kit-industrial)
- Conveyor and processing props (conveyor-kit)
- Water road overlays/canals (isometric-roads-water)
- Rail utility and freight movement (train-kit)

## 6) Blue Sky World and Atmosphere
Mandatory replacement:
- Replace dark background with daytime blue sky

Sky spec:
- Top gradient: light azure
- Horizon: desaturated warm blue
- Optional sparse cloud layer with slow parallax

Lighting spec:
- Main directional daylight
- Soft ambient fill
- Reduced neon glow effects
- Shadows tuned for readability, not drama

Palette direction:
- Asphalt cool gray
- Concrete neutral gray-blue
- Vegetation natural green
- Building accents restrained (not neon-heavy)

## 7) Assets Gathered (Completed)
All assets were downloaded and extracted into the repo.

Root folder:
- `artifacts/software-city/public/assets/kenney`

Downloaded archives:
- `artifacts/software-city/public/assets/kenney/zips`

Extracted packs:
- `artifacts/software-city/public/assets/kenney/packs`

Source URL manifest:
- `artifacts/software-city/public/assets/kenney/asset-sources.tsv`

Content summary:
- `artifacts/software-city/public/assets/kenney/asset-summary.tsv`

Total footprint:
- ~160 MB

### Gathered pack set
Core city packs:
- city-kit-commercial
- city-kit-suburban
- city-kit-industrial
- city-kit-roads

Support packs for complete world coverage:
- car-kit
- train-kit
- nature-kit
- isometric-roads-water
- 3d-road-tiles
- conveyor-kit
- modular-buildings

### Inventory snapshot (from asset-summary.tsv)
- 3d-road-tiles: 915 files, 302 OBJ, 302 GLTF, 302 MTL
- car-kit: 259 files, 50 FBX, 50 OBJ, 50 GLB
- city-kit-commercial: 219 files, 41 FBX, 41 OBJ, 41 GLB
- city-kit-industrial: 141 files, 25 FBX, 25 OBJ, 25 GLB
- city-kit-roads: 372 files, 72 FBX, 72 OBJ, 72 GLB
- city-kit-suburban: 216 files, 40 FBX, 40 OBJ, 40 GLB
- conveyor-kit: 317 files, 61 FBX, 61 OBJ, 61 GLB
- isometric-roads-water: 47 files, 42 PNG
- modular-buildings: 554 files, 108 FBX, 108 OBJ, 108 GLB
- nature-kit: 3618 files, 329 FBX, 329 OBJ, 329 GLB
- train-kit: 527 files, 103 FBX, 103 OBJ, 103 GLB

License note:
- Kenney city-kit pages indicate Creative Commons CC0.
- Keep pack source URLs for traceability in `asset-sources.tsv`.

## 8) Full Rebuild Execution Plan (When Implementation Starts)
## Phase A - World spec and data contracts
- Freeze district and road logic rules above
- Define renderer-agnostic world schema for zones, blocks, lots, roads, utilities
- Define deterministic seeds so same repo gives same world layout

## Phase B - Asset preparation pipeline
- Normalize asset orientation and scale
- Create per-zone prefab catalog
- Build model LOD set and optional texture atlas strategy
- Prepare road-junction prefab map from roads-pieces index

## Phase C - New world generator
- Generate zones -> roads -> blocks -> lots -> placements
- Enforce adjacency and connectivity constraints
- Generate utility compounds and service access
- Add greenery and props as procedural variation layers

## Phase D - New renderer shell (still separate from old)
- Orthographic/isometric camera
- Blue sky background and daylight lighting
- Instanced rendering for buildings/props
- Selection, hover, and navigation parity hooks

## Phase E - Validation and polish
- Visual coherence checks (roads, district transitions, spacing)
- Performance profiling and LOD tuning
- Final art pass for repetition reduction and landmark identity

## 9) Definition of Done
World is considered valid when all are true:
- City reads as intentional urban plan, not random placement
- Every district has clear visual identity and purpose
- Road network is hierarchical and coherent
- Utility infrastructure is present and logically placed
- Blue sky daytime look is default
- Asset usage comes from gathered Kenney packs with stable mapping

## 10) Immediate Next Step (After Plan Approval)
- Build a world-schema spec document and prefab mapping table from the gathered assets.
- Then start implementation in a new renderer path (without mutating current city renderer until parity is proven).
