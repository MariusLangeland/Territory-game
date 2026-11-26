# TERRITORY

A deterministic, WebGPU-rendered pixel territory war with live Spacetime multiplayer rooms.

Every pixel of the atlas is land, ocean, or somebody's country. Buy durable fronts with supply, build structures, capture territory, and eliminate rivals.

## Quick start

**Requirements:** Node.js ≥ 24, pnpm ≥ 11, and a WebGPU browser (current Chrome or Edge).

```sh
pnpm install
pnpm dev
```

Open <http://localhost:5173>. Seed a world with `?seed=1234`.

## Multiplayer

One Spacetime database per room.

1. Select a room from the live directory.
2. The first client creates the room; others join seats.
3. Every seat marks ready.
4. The host starts the match.
5. The tick-0 broadcast locks participation and starts local simulations.
6. Player input is submitted as compact Spacetime ledger rows; the server assigns the tick and clients apply accepted intents to their local simulation.

If the room authority disconnects or pauses, the local simulation pauses.

## Core rules

- Fixed 10 Hz deterministic simulation.
- One **supply** resource pays for cards, upgrades, and fronts.
- Holding **70% of land** wins immediately; an optional timer awards the largest alive state.
- 8–51 states; default 51 (1 human + 50 AI).
- All seven build cards are permanently available.
- Fronts trade strength on contact, idle out after 20 captureless ticks, and refund proportionally when cancelled.
- State structures anchor connected territory against annexation.
- Player-only alliances support one active pair.

Generated costs, formulas, and structure values live in [docs/REFERENCE.md](docs/REFERENCE.md). The canonical rules and behavior live in [docs/SPEC.md](docs/SPEC.md).

## Commands

```sh
pnpm dev            # local Vite server
pnpm check          # Svelte/TypeScript check
pnpm test           # deterministic and subsystem tests
pnpm test:fast      # fast test project
pnpm test:worker    # built-worker smoke test
pnpm check:boundaries
pnpm bench          # map/tick/checksum benchmark
pnpm docs:reference # regenerate docs/REFERENCE.md
pnpm docs:check
pnpm build
pnpm lint
pnpm format
```

## Deployment

Pushing to `main` builds and deploys the static site to GitHub Pages through
`.github/workflows/deploy.yml`.

- Repository Pages source must be set to **GitHub Actions**.
- Project sites use `/<repository>/` as the base path automatically.
- Local builds default to an empty base path.

## Architecture

```text
routes/+page.svelte          page shell, HUD, overlays
components/                  Svelte UI and WebGPU canvas
game/frontend/               frontend command contracts
game/ledger/                 standardized remote/local ledger boundary
game/view/                   match view + worker-owned tick/snapshot host
game/worker/                 worker transport, mirror, protocol
game/simulation/             deterministic simulation subsystems
game/simulation.ts           authoritative simulation facade
spacetime/territory-room/    one-room Spacetime coordinator module
spacetime/territory-lobby/   room directory module
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for module boundaries.

## Docs

- [docs/SPEC.md](docs/SPEC.md) — canonical product and behavior
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — code boundaries and data flow
- [docs/REFERENCE.md](docs/REFERENCE.md) — generated rules reference
- [docs/MULTIPLAYER_SCHEMA.md](docs/MULTIPLAYER_SCHEMA.md) — Spacetime schema

## Current limits

- No rollback on late ledger rows yet.
- No reconnect/keyframe flow yet.
- Room directory status is not synchronised back from room lifecycle.
- Maincloud Free is limited to five databases: one lobby plus four rooms.
- WebGPU is required; there is no fallback renderer.
