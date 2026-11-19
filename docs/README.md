# Territory documentation

This directory is the long-term reference for the project. Start with the specification, then follow the topic you are changing.

| Document                           | Authority                                   | Use it when                                                                          |
| ---------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| [SPEC.md](SPEC.md)                 | Canonical product + technical specification | You need the intended game rules, systems, contracts, or acceptance criteria         |
| [EXPERIMENTS.md](EXPERIMENTS.md)   | Temporary deviations from the spec          | You are working on the resource-free attack stress mode or deciding how to retire it |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Current code structure                      | You are adding a feature and need to know which module owns what                     |
| [DETERMINISM.md](DETERMINISM.md)   | Non-negotiable simulation rules             | You touch ticks, random numbers, commands, attacks, map generation, or checksums     |
| [RENDERING.md](RENDERING.md)       | Renderer contract                           | You touch WebGPU, shaders, textures, camera, upload budgets, or visual effects       |
| [NETWORKING.md](NETWORKING.md)     | Target online design (not yet implemented)  | You start the authoritative server, protocol, rooms, reconnect, or anti-cheat work   |
| [PERFORMANCE.md](PERFORMANCE.md)   | Budgets and measurement practice            | You need to know whether a change is fast enough or how to profile it                |
| [ROADMAP.md](ROADMAP.md)           | Delivery plan and acceptance criteria       | You are choosing the next milestone                                                  |
| [DECISIONS.md](DECISIONS.md)       | Architecture decision records               | You want to know why a choice was made before revisiting it                          |

## Documentation rules

1. **The code is the source of truth for current behavior.** If a document and the code disagree, fix the document in the same change (or explicitly mark the document as a future design).
2. **Simulation rules are protocol.** Changing timings, arithmetic, PRNG draw order, map/start generation, attack ordering, or player payloads requires a version bump, updated tests, and a [DETERMINISM.md](DETERMINISM.md) review.
3. **Temporary modes belong in [EXPERIMENTS.md](EXPERIMENTS.md).** Do not quietly present experimental rules as final design.
4. **Every performance claim needs a method.** Add benchmark or browser results to [PERFORMANCE.md](PERFORMANCE.md) with hardware, state scale, and conditions.
5. **Network work is design-first.** Keep [NETWORKING.md](NETWORKING.md) synchronized with `src/lib/game/net/protocol.ts` before implementing a server surface.
6. **Keep screenshots honest.** Images in `docs/media/` should come from the current build and use a documented seed when the layout matters.

## Version map

| Surface                  | Version   | Defined in                                               |
| ------------------------ | --------- | -------------------------------------------------------- |
| Map + start generation   | `3`       | `MAP_VERSION` in `src/lib/game/constants.ts`             |
| Wire protocol draft      | `10`      | `NET_PROTOCOL_VERSION` in `src/lib/game/net/protocol.ts` |
| Application              | `0.6.0`   | `package.json`                                           |
| Simulation tick rate     | 10 Hz     | `TICK_RATE` in `src/lib/game/constants.ts`               |
| Attack stress experiment | `EXP-001` | [EXPERIMENTS.md](EXPERIMENTS.md)                         |
