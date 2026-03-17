# Game Design Document — City Builder
**Version 1.0 · March 2026**

---

## Table of Contents

1. [Overview](#1-overview)
2. [Core Pillars](#2-core-pillars)
3. [Technical Foundation](#3-technical-foundation)
4. [World & Grid](#4-world--grid)
5. [Zoning System](#5-zoning-system)
6. [Buildings](#6-buildings)
7. [Infrastructure](#7-infrastructure)
8. [Economy](#8-economy)
9. [RCI Demand Model](#9-rci-demand-model)
10. [Labor System](#10-labor-system)
11. [Happiness & Services](#11-happiness--services)
12. [Simulation Loop](#12-simulation-loop)
13. [Progression & City Levels](#13-progression--city-levels)
14. [Player Controls & UI](#14-player-controls--ui)
15. [Terrain & Landscape](#15-terrain--landscape)
16. [Current Gaps & Future Work](#16-current-gaps--future-work)

---

## 1. Overview

**Genre:** Browser-based isometric city builder
**Platform:** Web (desktop browser, no install required)
**Engine:** Three.js r160, vanilla ES modules, no bundler
**Perspective:** Fixed isometric orthographic camera (45° XZ, ~35° elevation)
**Grid:** 40×40 tiles

The player starts with €50,000 and an empty plot of land bisected by a river. They zone land for housing, commerce, and industry; build roads to connect zones; and supply power and water to keep the city running. The simulation runs in real time — one game-day per real second — and taxes flow in every 30 game-days (one game-month).

The win condition is open-ended: grow the population through the city level thresholds, keep the budget positive, and balance the competing demands of residents, businesses, and factories.

---

## 2. Core Pillars

| Pillar | Description |
|--------|-------------|
| **Systemic Depth** | Every zone type depends on the others. Residential provides workers; Commercial needs workers AND industrial supply; Industrial needs workers AND commercial buyers. Removing one leg collapses the others. |
| **Resource Clarity** | Power and water are not hidden behind abstraction — the player sees exact kW needed vs. available and exact water units. Shortage immediately penalises tax income via the infrastructure efficiency multiplier. |
| **Cause & Effect Feedback** | Every placement immediately updates HUD stats. The debug panel exposes every simulation variable. Modal dialogs break down every score factor so players understand *why* demand is high or low. |
| **Low Barrier to Entry** | Runs in any browser. One click to zone, drag to paint roads. No tutorial required — the startup hint + bootstrap auto-spawn get the first building placed within seconds. |

---

## 3. Technical Foundation

| Concern | Implementation |
|---------|---------------|
| Renderer | Three.js WebGL, PCFSoft shadows, pixel ratio capped at 2× |
| Camera | `OrthographicCamera`, zoom 0.3×–4.0×, pan via OrbitControls middle/right drag or WASD/arrows |
| Building meshes | `THREE.Group` (zone buildings) or `THREE.Mesh` (services/infra). Zone buildings use procedural geometry: gable-roof houses (ExtrudeGeometry), office blocks with parapets, factory sheds with chimneys |
| Grid | 40×40 tile objects in a 2-D array; floor tiles are shared BoxGeometry, per-tile MeshLambertMaterial for colour |
| Modules | `main.js` → wires scene, grid, city, terrain, UI; `city.js` → simulation (no Three.js); `grid.js` → tile state + mesh management; `buildings.js` → definitions + mesh factory; `economy.js` → pure budget functions; `terrain.js` → procedural landscape; `ui.js` → DOM/HUD; `scene.js` → Three.js setup + labor colour updates; `modals.js` → stat drill-down dialogs |
| Simulation cadence | 1 real second = 1 game-day; SIM_TICK every 5 days; MONTH_END every 30 days |

---

## 4. World & Grid

### 4.1 Grid Properties

- **Size:** 40×40 tiles (1,600 tiles total)
- **Tile footprint:** 1 world unit × 1 world unit
- **Floor tile thickness:** 0.06 world units (TILE_H)
- **Tile types:** `empty`, `zone`, `road`, `service`, `infra`, `terrain`
- **Terrain subtypes:** `river`, `forest` (field removed)

### 4.2 Tile Data

Each tile stores:

```
type, zoneType, terrainType, isBridge
building { id, def, mesh, fillPercentage, residents, jobs, level,
           laborState, laborStateTurns, recovering, baseColor }
connected (road access)
happiness, desirability, pollution, landValue
serviceCoverage { police, fire, hospital, education, parks }
```

### 4.3 Road Access

A tile is **connected** if it is a road/bridge tile OR is directly orthogonally adjacent to one. Unconnected zone tiles do not receive auto-spawned buildings and are not counted in demand calculations.

---

## 5. Zoning System

Zoning is **free** — the player paints zone types onto empty (or forest) tiles. A building auto-spawns on a zoned tile once:
- The tile is connected to road
- Demand for that zone type ≥ 20
- Power and water capacity is sufficient
- The building type is unlocked at the current city level

Zone painting supports single-click and drag-to-rectangle. Right-click cancels the active tool.

| Zone | Colour | Auto-spawns |
|------|--------|-------------|
| R — Residential | Green | `residential_low` |
| C — Commercial | Blue | `commercial_low` |
| I — Industrial | Grey | `industrial_low` |

**Bootstrap spawns:** To break cold-start deadlocks, one building per zone type is force-spawned at month-end regardless of demand score, provided road access and infrastructure requirements are met.

---

## 6. Buildings

### 6.1 Zone Buildings

| Building | Zone | Capacity/Jobs | Power | Water | Notes |
|----------|------|---------------|-------|-------|-------|
| Residential (Low) | R | 6 residents (at 100% fill) | 1 | 1 | Fill grows 15%/month toward 100% |
| Commercial (Low) | C | 3 jobs | 2 | 1 | Needs industrial supply; 20 shoppers for full efficiency |
| Industrial (Low) | I | 10 jobs | 5 | 3 | Pollutes radius 6; supplies up to 5 commercial buildings |

**Fill percentage:** Zone buildings start at 10% occupancy and grow by `15% × remaining capacity` each month, asymptotically approaching 100%. Residential tax income and power/water consumption both scale with fill.

### 6.2 Service Buildings

| Building | Cost | Upkeep | Effect | Radius | Unlock |
|----------|------|--------|--------|--------|--------|
| Police Station | €8,000 | €1,500/mo | Crime −20 | 8 | Lvl 1 |
| Fire Station | €8,000 | €1,500/mo | Fire protection +20 | 8 | Lvl 1 |
| Primary School | €5,000 | €1,000/mo | Happiness +5, Edu +1 | 6 | Lvl 1 |
| Hospital | €25,000 | €4,000/mo | Happiness +15 | 12 | Lvl 2 |
| High School | €12,000 | €2,500/mo | Happiness +8, Edu +2 | 10 | Lvl 2 |
| University | €30,000 | €6,000/mo | Happiness +12, Edu +3 | 15 | Lvl 3 |
| Small Park | €1,000 | €200/mo | Happiness +5 | 4 | Lvl 1 |
| Medium Park | €3,000 | €500/mo | Happiness +10 | 7 | Lvl 2 |
| Large Park | €8,000 | €1,200/mo | Happiness +20 | 12 | Lvl 3 |

Service coverage uses linear falloff: `strength × (1 − dist/radius)`, summed across all service buildings within range, capped at 100 per coverage type.

### 6.3 Infrastructure Buildings

See [Section 7 — Infrastructure](#7-infrastructure).

### 6.4 3D Meshes

| Zone | Mesh description |
|------|-----------------|
| Residential | Box body (64% of total height) + dark-red gable roof (ExtrudeGeometry triangular prism, 36% of height) |
| Commercial | Office block (92% of height) + four-sided flat-roof parapet (8% of height) |
| Industrial | Factory shed (78% of height) + offset chimney cylinder (extends above shed) |
| Services/Infra | Plain box (height per definition) |
| Bridge | Road deck + four railing bars + corner posts (THREE.Group) |

---

## 7. Infrastructure

### 7.1 Power

Power is pooled globally (not routed). All generators contribute to a shared `powerAvailable` total; all buildings draw from it.

| Building | Cost | Upkeep | Output | Unlock |
|----------|------|--------|--------|--------|
| Diesel Generator | €3,000 | €600/mo | 150 kW | Lvl 1 |
| Coal Power Plant | €10,000 | €2,000/mo | 600 kW | Lvl 1 |
| Solar Farm | €20,000 | €500/mo | 400 kW | Lvl 3 |
| Nuclear Plant | €80,000 | €3,000/mo | 2,000 kW | Lvl 5 |

**Capacity planning reference (500 residents):**
- ~84 R + ~105 C + ~21 I buildings ≈ 399 kW demand, ~252 water units demand
- Starter: Diesel Gen + Small Pump = €5,500 capital + €1,100/mo upkeep

### 7.2 Water

Water is pooled globally identical to power.

| Building | Cost | Upkeep | Output | Unlock |
|----------|------|--------|--------|--------|
| Small Water Pump | €2,500 | €500/mo | 80 units | Lvl 1 |
| Water Pumping Station | €8,000 | €1,500/mo | 320 units | Lvl 1 |

### 7.3 Roads & Bridges

- **Road:** €100/tile, no upkeep. Placed by click or drag-to-line along the dominant axis (horizontal or vertical).
- **Bridge:** €150/tile, €2/mo upkeep. Automatically placed when a road is drawn over a river tile. Visually distinct (blue deck with steel railings).

Zone building power/water consumption scales with `fillPercentage`. Abandoned buildings contribute zero consumption.

### 7.4 Infrastructure Efficiency

```
powerRatio = powerAvailable / max(powerNeeded, 1)
waterRatio = waterAvailable / max(waterNeeded, 1)
infraEfficiency = clamp(min(powerRatio, waterRatio), 0.2, 1.0)
```

`infraEfficiency` is applied as a multiplier to **all zone tax income** (R, C, and I) each month. A shortage never drops efficiency below 20% — cities always earn something.

---

## 8. Economy

### 8.1 Monthly Tax Income

Tax is collected once per game-month (30 days). The formulas below show pre-multiplier values:

| Zone | Formula |
|------|---------|
| R | `residents × €10` (residents = capacity × fillPercentage) |
| C | `€50 × cTaxMultiplier` (cTaxMultiplier scales with I-supply coverage, min 50%) |
| I | `€80 × fillPercentage` |

**Applied multiplier chain (C and I):**
```
rawTax → × cTaxMult (C only) → × laborEfficiency → × infraEfficiency
```
**Applied multiplier chain (R):**
```
rawTax → × infraEfficiency
```

Abandoned C/I buildings contribute €0 to tax regardless of multipliers.

### 8.2 Upkeep Expenses

Services and infrastructure pay monthly upkeep. Zone buildings have zero upkeep — residents and businesses cover their own costs.

### 8.3 Starting Budget

€50,000. No loans are currently implemented.

### 8.4 Financial Modal

Clicking the money HUD stat opens a breakdown showing:
- Income by zone type (R / C / I)
- Expenses grouped by building category with counts
- Net this month and last month
- Current balance

---

## 9. RCI Demand Model

Demand is recalculated every 5 game-days. Scores are 0–100 and drive both auto-spawn and the RCI bar display.

### 9.1 Derived Totals

```
totalResidents  = Σ(capacity × fill) for R buildings   [= population]
totalWorkers    = totalResidents × 0.60                 [60% are working-age]
totalShoppers   = totalWorkers                          [same pool shops too]
cJobs           = cBuildings × 3   (non-abandoned only)
iJobs           = iBuildings × 10  (non-abandoned only)
totalJobs       = cJobs + iJobs
laborEfficiency = clamp(workers / max(totalJobs, 1), 0.0, 1.0)
```

### 9.2 R Demand Factors

| Factor | Weight | Formula |
|--------|--------|---------|
| job_availability | 0.80 | `clamp(effectiveJobs / max(workers,1) / 2, 0, 1)` |
| happiness | 0.20 | `cityHappiness / 100` |

**R demand bonus when jobs exceed workers:**
```
jobSurplusRatio = clamp(totalJobs / max(workers, 1), 1, 3)
rBonus          = (jobSurplusRatio − 1) / 2 × 100
```
At 2× job surplus: +50 to rScore. At 3× surplus: +100 (clamped).
Bootstrap floor: 10 if any C or I buildings exist.

### 9.3 C Demand Factors

| Factor | Weight | Formula |
|--------|--------|---------|
| worker_supply | 0.40 | `clamp(workers / max(cJobs×2, 1), 0, 1)` (×0.3 if workers < 50% of cJobs) |
| customer_base | 0.35 | `clamp(shoppers / max(cBldg×20, 1), 0, 1)` |
| supply_chain  | 0.25 | `suppliedC / cBldg` (0.10 if no I buildings) |

Bootstrap floor: 10 if R tiles exist; 15 if I exists and C=0.

### 9.4 I Demand Factors

| Factor | Weight | Formula |
|--------|--------|---------|
| worker_supply | 0.45 | same structure as C |
| market_demand | 0.55 | `clamp(1 / (iBldg×5/cBldg), 0.1, 1.0)` (0.10 if no C; 1.0 if no I yet) |

Bootstrap floor: 10 if R tiles exist; 15 if C exists and I=0.

### 9.5 Labor Demand Suppressor

When workers are scarce, C and I demand is suppressed before bootstrap floors are applied:

```
workerShortageRatio   = laborEfficiency                 [0–1]
laborDemandMultiplier = workerShortageRatio ^ 1.5

cScore *= laborDemandMultiplier
iScore *= laborDemandMultiplier
```

| Worker coverage | Multiplier |
|-----------------|-----------|
| 100% | 100% (no effect) |
| 60% | ~47% |
| 50% | ~35% |
| 30% | ~16% |
| 10% | ~3% |

---

## 10. Labor System

### 10.1 States

Every C and I building has a `laborState` that is updated once per game-month:

| State | Colour | Tax | Jobs counted | Power/Water |
|-------|--------|-----|-------------|-------------|
| `ok` | Base colour | Full | Full | Full |
| `struggling` | Darkened + orange tint | × laborEfficiency | Full | Full |
| `abandoned` | Near-black (0x222222) | €0 | Excluded | Zero demand |

### 10.2 State Transitions

```
ok          → struggling : laborEfficiency < 0.80 (immediate)
struggling  → ok         : laborEfficiency ≥ 0.80 for 1 month (recovering flag set)
struggling  → abandoned  : laborEfficiency < 0.25 for 2 consecutive months
abandoned   → struggling : laborEfficiency ≥ 0.40 for 1 month (recovering flag set)
```

The `recovering` flag triggers a transitional mesh colour: 40% lerp from near-black toward base colour.

### 10.3 Visual Feedback

Mesh colours are updated in `scene.js` whenever the `laborStateChanged` event fires. The info panel (tile click) shows status, cause, and recovery hint for struggling/abandoned/recovering buildings.

---

## 11. Happiness & Services

### 11.1 Per-tile Happiness

Computed monthly per tile from service coverage:

```
happiness = 50
          + police    × 0.10
          + fire      × 0.10
          + hospital  × 0.20
          + education × 0.20
          + parks     × 0.10
          − pollution × 0.50
```
Clamped to [0, 100].

### 11.2 City Happiness

Average `tile.happiness` across all R tiles with buildings. Penalty: −15 if power shortage; −15 if water shortage.

### 11.3 Pollution

Industrial buildings emit pollution in a Manhattan-distance radius of 6 tiles with falloff:

```
pollution contribution = 40 × (1 − dist / 6)
```

Pollution directly suppresses tile happiness through the formula above.

### 11.4 Land Value

`landValue` lags 10% toward `desirability` each month (exponential moving average). Currently stored but not yet wired to tax rates.

### 11.5 Service Coverage Calculation

On every service placement or demolition:
1. Reset all coverage fields to 0
2. For each service building: iterate tiles within radius, add `strength × (1 − dist/radius)`
3. Cap each coverage field at 100
4. Recompute tile happiness immediately

---

## 12. Simulation Loop

```
Every real second (1 game-day):
  day++
  if day % 5 == 0 OR isMonthEnd:
    getStats() → calcPowerWater() → _updateSimulation()
      ├─ infraEfficiency
      ├─ non-abandoned job totals
      ├─ _calculateRCIDemand()    (→ laborEfficiency, workerShortageRatio, RCI scores)
      ├─ _autoSpawn()             (demand-driven + bootstrap)
      └─ _checkLevelUp()

  if isMonthEnd (day > 30):
    _updateFillPercentages()     (grow zone buildings 15%/month)
    grid.runMonthlyTileCalcs()   (pollution → desirability → landValue → happiness)
    _updateLaborStates()         (ok / struggling / abandoned transitions)
    processMonth()               (economy.js: taxes + upkeep)
    → subtract abandoned building tax
    → apply laborEfficiency × infraEfficiency multipliers
    → update money, lastMonthNet
    emit 'monthProcessed'
```

---

## 13. Progression & City Levels

City level unlocks higher-tier buildings and is determined by population:

| Level | Population threshold | Notable unlocks |
|-------|---------------------|-----------------|
| 1 | 0 | All starter buildings |
| 2 | 500 | Hospital, High School, Medium Park |
| 3 | 1,500 | University, Large Park, Solar Farm |
| 4 | 3,000 | (reserved) |
| 5 | 6,000 | Nuclear Plant |
| 6 | 12,000 | (reserved) |
| 7–9 | 25k / 50k / 100k | (reserved) |
| 10 | 250,000 | (reserved) |

Level-up triggers a gold toast notification and emits `levelUp` to unlock toolbar buttons.

---

## 14. Player Controls & UI

### 14.1 Toolbar

Bottom-mounted, scrollable. Groups:

| Group | Tools |
|-------|-------|
| Select / Demolish | Inspect tile, bulldoze |
| Zones | R zone, C zone, I zone |
| Services | Police, Fire, Hospital, Schools, Parks |
| Infra | Diesel Gen, Coal Plant, Solar Farm, Nuclear, Small Pump, Water Station, Road |

Locked buildings show at 40% opacity; clicking them does nothing. Tooltips show cost, upkeep, and output.

### 14.2 HUD (Bottom Bar)

| Stat | Click action |
|------|-------------|
| 💰 Balance | Opens Financial modal |
| 📈 Monthly net | (display only) |
| 👥 Population | Opens Population modal |
| ⚡ Power used/available | (display only, colour-coded) |
| 💧 Water used/available | (display only, colour-coded) |
| 😊 Happiness | Opens Happiness modal |
| 🏙️ City level | (display only) |
| RCI bars | Opens RCI Demand modal |

### 14.3 RCI Bars

Three vertical fill bars (R green, C blue, I grey) in the bottom-right corner. Height = demand %. Hover tooltip shows per-factor scores. A ↑ badge appears when the bootstrap floor is holding demand up artificially.

### 14.4 Info Panel (Top Right)

Single-tile drill-down on click. Shows building stats, fill, residents, road access, happiness. For C/I buildings: laborState badge (⚠ Struggling / ✖ Abandoned / ↑ Recovering) with cause and recovery hint.

### 14.5 Debug Panel (Top Left)

Toggle button (top-left corner) reveals a live panel with sections:
- **Population:** residents, average R fill
- **Labour Market:** workers, C-jobs, I-jobs, balance, labor efficiency, struggling count, abandoned count, C/I demand multiplier
- **Zones:** building and zone counts for R/C/I
- **Infrastructure:** power available/needed/surplus, water available/needed/surplus, infra efficiency
- **RCI Demand:** per-zone demand score with per-factor breakdown and ✓/✗ thresholds
- **Economy:** balance, last month net, happiness

### 14.6 Modals

| Modal | Trigger | Contents |
|-------|---------|----------|
| Financial | Click money stat | Income by zone, expenses by building type, net, balance |
| Population | Click pop stat | Totals, employment rate, zone breakdown |
| Happiness | Click happiness stat | Modifier table (services, pollution, infrastructure) |
| RCI Demand | Click RCI bars | Per-zone demand with factor scores and modifier rows |

### 14.7 Drag-to-Build

- **Road:** drag along one axis to place a straight road line
- **Zone:** drag a rectangle to paint zone type over multiple tiles
- Live drag-info tooltip shows tile count, cost, bridge count, and blocked tile count

### 14.8 Camera

| Action | Control |
|--------|---------|
| Pan | WASD / arrow keys, or middle/right mouse drag |
| Zoom | Scroll wheel (0.3×–4.0×) |
| Rotate | Disabled |

---

## 15. Terrain & Landscape

### 15.1 River

A diagonal strip ~2 tiles wide running from (0, 8) to (39, 28). River tiles are type `terrain` / `terrainType river` and cannot be built on except with bridges. The river is cosmetic blue; no water supply is derived from it.

### 15.2 Forest Clusters

Three procedurally generated circular clusters (radii 4–6, with irregular noise-offset boundaries). Forest tiles are **overbuildable** — placing a zone, road, or building on a forest tile removes the tree meshes and converts the tile to the appropriate type. Trees are tracked in a module-level Map keyed by tile coordinates; `clearForestAt(scene, x, z)` removes them via a callback wired in `main.js`.

Approximately 60% of forest tiles have a 3D tree: a brown cylinder trunk (CylinderGeometry) and a green cone crown (ConeGeometry), placed with ±0.15 tile jitter.

### 15.3 Cleared Terrain

Fields were removed from the landscape. Only river and forest remain as non-empty terrain types.

---

## 16. Current Gaps & Future Work

The following systems are designed or partially scaffolded but not yet implemented:

| Feature | Status | Notes |
|---------|--------|-------|
| Land value → tax rates | Stored, not wired | `tile.landValue` updates monthly but does not yet modify tax income |
| Education level effect | Stored in service definitions, not consumed | `edu_level` provided by schools but not used in demand or tax formulas |
| Crime system | `crime_reduction` provided by police but no crime rate modelled | Police stations add coverage but happiness only benefits from the stats in the formula |
| Multiple building tiers | Only `_low` tier exists | Buildings with `unlockAtLevel 2+` are services/infra; no `residential_mid`, `commercial_mid` etc. |
| Budget deficit / bankruptcy | No enforcement | Negative balance is possible indefinitely |
| Loans | Stub only | No borrowing mechanic |
| Save / load | Not implemented | Game state is lost on page refresh |
| Fire events | Fire protection modelled, no fire spread | `fire_protection` coverage exists but no fire events occur |
| Traffic / congestion | Not modelled | Road capacity is unlimited |
| Larger buildings (2×2, 3×3) | Grid supports multi-tile via `size` field, all buildings are 1×1 | |
| Sound | Not implemented | |
| Multiple city levels / scenarios | Single map only | |
| Win / loss conditions | Open-ended | No formal end state |
| Mobile / touch input | Not implemented | Desktop mouse/keyboard only |
