# Territory Rules Reference

This is the generated single source of truth for the rules numbers that live in
Territory's game code. Version, constants, supply economy, structures, attack
formulas, and match setup are extracted from the source; only the prose outside the
`AUTOGEN` marker pairs is hand-written.

## How to update docs

Regenerate the marked blocks with `pnpm docs:reference` (wired to
`scripts/docs-reference.ts`). The code and its tests are authoritative: change the
source first, then regenerate. Do not hand-edit content between a
`<!-- AUTOGEN:... START -->` marker and its matching `<!-- AUTOGEN:... END -->`
marker; `--check` exists to catch drift, and a manual edit inside a block is
overwritten on the next write.

To verify without writing, run `pnpm exec tsx scripts/docs-reference.ts --check`.

## Version

<!-- AUTOGEN:version START -->

- App version: `0.77.0` (from `package.json` `version`).

<!-- AUTOGEN:version END -->

## Core constants

<!-- AUTOGEN:constants START -->

Values are read from `src/lib/game/constants.ts` and structure definitions.

- `MAP_VERSION` — map generation revision: `5`.
- `MAP_WIDTH` — map width in pixels: `4096`.
- `MAP_HEIGHT` — map height in pixels: `2048`.
- `PLAYER_COUNT` — maximum states per match: `51`.
- `NAVAL_SPEED_PX_PER_SECOND` — boat speed along a sea route: `80`.
- `TICK_RATE` — simulation ticks per second: `10`.

<!-- AUTOGEN:constants END -->

## Supply economy

<!-- AUTOGEN:economy START -->

Supply is the only resource; cards, upgrades, and front launches all spend it.

- **Starting supply:** `STARTING_GOLD` = `90`.
- **Income per second:** `BASE_GOLD_INCOME + floor(territory / SUPPLY_INCOME_TERRITORY_DIVISOR) + COMMAND_POST_SUPPLY_PER_SECOND × Command Post stacks` = `3 + floor(territory / 3000) + 1 × Command Post stacks`.
- **Cap:** `SUPPLY_CAP_BASE + floor(territory / SUPPLY_CAP_TERRITORY_DIVISOR) + War Academy cap × War Academy stacks` = `120 + floor(territory / 1000) + 80 × War Academy stacks`.
- **No hard maximum:** neither income nor cap is globally capped; both grow with territory and structure stacks.

<!-- AUTOGEN:economy END -->

## Structures

<!-- AUTOGEN:structures START -->

Definitions come from `src/lib/game/structures/`. A buildable defense aura covers its whole district; State auras use their radius.

### `state` — STATE

- **Cost:** none (not buildable).
- **District range:** none (aura anchor).
- **Description:** Anchors protected territory; projects a +20 friendly-defense aura.
- **Effects:**
  - `defense-aura` — +20 defense, radius 16 px, `max` stacking.

### `artillery` — ARTILLERY

- **Cost:** `1000` supply (buildable).
- **District range:** `64` px.
- **Description:** Active: inaccurate barrage, 1 shell per level within 140 px. Each shell costs 300 supply and cannot destroy a State.
- **Effects:**
  - `artillery` — range 140 px, cooldown 6 s (60 ticks), 1 shell per level, 300 supply per level.

### `barracks` — BARRACKS

- **Cost:** `240` supply (buildable).
- **District range:** `44` px.
- **Description:** +1 attack strength level. Attack cost rises by 40; speed and piercing use log2 scaling.
- **Effects:**
  - `barracks-power` — +1 attack strength level per stack.

### `fortification` — FORTIFICATION

- **Cost:** `30` supply (buildable).
- **District range:** `40` px.
- **Description:** +1 defense to every friendly pixel in its district.
- **Effects:**
  - `defense-aura` — +1 defense, district-wide (radius ignored), `add` stacking.

### `command-post` — COMMAND POST

- **Cost:** `80` supply (buildable).
- **District range:** `32` px.
- **Description:** +1 supply per second, paid continuously.
- **Effects:**
  - `supply-income` — +1 supply per second.

### `war-academy` — WAR ACADEMY

- **Cost:** `60` supply (buildable).
- **District range:** `32` px.
- **Description:** +80 supply cap.
- **Effects:**
  - `supply-cap` — +80 supply cap.

### `jammer` — JAMMER

- **Cost:** `160` supply (buildable).
- **District range:** `32` px.
- **Description:** Global aura: -1 effective enemy Barracks level per stack.
- **Effects:**
  - `barracks-suppression` — −1 effective enemy Barracks level per stack.

### `port` — PORT

- **Cost:** `200` supply (buildable).
- **District range:** `0` px.
- **Description:** Naval landing port. Build on a shore; enables sea landings and protects sea-linked territory.
- **Effects:**
  - [object Object]

<!-- AUTOGEN:structures END -->

## Attack formulas

<!-- AUTOGEN:formulas START -->

Derived from `src/lib/game/constants.ts`; `src/lib/game/simulation.ts` applies them every tick.

- **Pixel defense:** `defense = BASE_DEFENSE_OFFSET + elevation + OCCUPIED_DEFENSE_BONUS + auraDefense` = `1 + elevation + 1 (owned) + auraDefense`.
- **Effective levels:** `effectiveLevels = max(0, attacker Barracks stacks − defender Jammer stacks)`.
- **Log tier:** `logTier = 31 − clz32(effectiveLevels + 1)` for positive levels, otherwise `0`; equal to `floor(log2(effectiveLevels + 1))`.
- **Attack power:** `power = ATTACK_DAMAGE_PER_TICK + logTier × ATTACK_ORDER_DAMAGE_BONUS` = `30 + 15 × logTier`.
- **Defense piercing:** `pierce = logTier × ATTACK_ORDER_DEFENSE_PIERCE` = `logTier × 1`.
- **Durable strength:** `strength = ATTACK_STRENGTH_BASE + effectiveLevels × ATTACK_STRENGTH_BONUS` = `1000 + 200 × effectiveLevels`.
- **Launch cost:** `cost = ATTACK_SUPPLY_COST_BASE + effectiveLevels × ATTACK_SUPPLY_COST_BONUS` = `30 + 40 × effectiveLevels`.
- **Capture cost:** each captured cell spends `max(1, defense − pierce)` attack points and the same amount of durable strength.
- **Per-tick budget:** a front spends up to `power` attack points per tick and samples `LEAST_RESISTANCE_SAMPLE_SIZE` = `10` frontier cells, capturing the cheapest affordable one.
- **Contact damage:** mutual fronts trade `ATTACK_ATTRITION_BASE + opponentLogTier × ATTACK_ATTRITION_BONUS` = `100 + 50 × opponentLogTier` durable strength once per pair per tick.
- **Idle timeout:** a front that captures nothing for `ATTACK_IDLE_TICKS` = `20` ticks dies.
- **Cancellation refund:** `refund = floor(cost × remainingStrength / initialStrength)`.

#### Effective-level scaling

```text
levels logTier power pierce strength cost
0      0       30    0      1000     30
1      1       45    1      1200     70
2      1       45    1      1400     110
3      2       60    2      1600     150
4      2       60    2      1800     190
5      2       60    2      2000     230
6      2       60    2      2200     270
7      3       75    3      2400     310
8      3       75    3      2600     350
9      3       75    3      2800     390
10     3       75    3      3000     430
```

<!-- AUTOGEN:formulas END -->

## Match setup

<!-- AUTOGEN:match START -->

Presets come from `src/lib/game/match-config.ts`; growth layers come from `src/lib/game/growth/`.

### Map presets

- `standard` — STANDARD · 4096×2048 (width 4096 px, height 2048 px).
- `compact` — COMPACT · 3072×1536 (width 3072 px, height 1536 px).
- `clash` — CLASH · 2560×1440 (width 2560 px, height 1440 px).

### State count

Allowed: `8`, `16`, `24`, `32`, `51`. Default: `51`.

### Bot difficulty

- `relaxed` — RELAXED: slower bot economy and attacks.
- `standard` — STANDARD: baseline deterministic AI.
- `ruthless` — RUTHLESS: more frequent bot attacks.

### Match timer

- `0` — no timer.
- `10` — 10-minute timer.
- `20` — 20-minute timer.
- `30` — 30-minute timer.

Default: `0` (no timer).

### Growth model

Player matches are locked to `organic` growth (ORGANIC: Deterministic random frontier selection; irregular, organic lobes.).


### Atlas limits

Custom atlases accept width 512–8192 px, height 256–8192 px, and at most 67,108,864 total cells.

### Default match settings

`states` = `51`, `mapPreset` = `standard`, `mapWidth` = `4096`, `mapHeight` = `2048`, `difficulty` = `standard`, `timerMinutes` = `0`, `botCommandPostStacks` = `0`.

<!-- AUTOGEN:match END -->
