# Structure definitions

Each structure type owns one file:

- `state.ts`
- `mine.ts`
- `barracks.ts`
- `defense-post.ts`
- `command-post.ts`
- `war-academy.ts`

A definition contains its label, rules text, card cost, buildability, accent color, and effect descriptors. Edit the type-specific file for balance or wording; do not add gameplay branches to the UI or simulation for individual types.

Shared machinery:

- `types.ts` — structure/card/effect types.
- `definitions.ts` — aggregate lookup, buildable pool, type list, accents, helpers.
- `registry.ts` — live structure ownership/index registry.
- `index.ts` — public API re-exports.

## Adding a type

1. Add the literal to `StructureType` in `types.ts`.
2. Create a new definition file and export its `*_DEFINITION`.
3. Register it in `STRUCTURE_TYPES`, `BUILDABLE_STRUCTURE_TYPES` (if player-built), and `STRUCTURE_DEFINITIONS` in `definitions.ts`.
4. Add its accent to `STRUCTURE_ACCENTS`.
5. Add its card/map icon and any new effect handling.
6. Add a checksum type code and tests.
