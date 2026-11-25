# Multiplayer Schema Validation

Schema: [MULTIPLAYER_SCHEMA.md](MULTIPLAYER_SCHEMA.md)

Status: **static validation only**. The Spacetime CLI/module package is not
installed, per current instruction. This has not been compiled, published, or
run against a real Spacetime host.

## Method

1. Checked the schema against the current SpacetimeDB 2.0 TypeScript docs:
   - [Column types](https://spacetimedb.com/docs/tables/column-types/)
   - [Constraints](https://spacetimedb.com/docs/tables/constraints/)
   - [Indexes](https://spacetimedb.com/docs/tables/indexes/)
   - [Event tables](https://spacetimedb.com/docs/tables/event-tables/)
   - [Key architecture](https://spacetimedb.com/docs/intro/key-architecture/)
2. Extracted the TypeScript schema block from
   `MULTIPLAYER_SCHEMA.md`.
3. TypeScript parser/syntax check:
   - TypeScript `6.0.3`
   - `264` source lines
   - **0 syntax diagnostics**
4. Type-checked against a local declaration stub mirroring the documented
   TypeScript API (`t`, `table`, `schema`, column builders):
   - **0 TypeScript errors** in strict mode.
   - This validates the schema's own TypeScript shape, not the real package API.

## Checks performed

- [x] Imports use `schema`, `table`, `t` from `spacetimedb/server`.
- [x] No `ScheduleAt` import or schedule table after removing periodic seals.
- [x] Every table has at most one primary key.
- [x] Auto-increment keys are single-column.
- [x] No composite primary keys.
- [x] `.unique()` only on supported string/identity/integer columns.
- [x] B-tree indexes only on supported integer/string/identity columns.
- [x] No indexes on `t.array`, `t.object`, timestamps, or payload enums.
- [x] Event tables use `event: true` and supported column types.
- [x] Byte payloads use `t.array(t.u8())`.
- [x] Enums/objects are used as columns but not as index keys.
- [x] One-database-per-room scope removes `roomId` from all room-local tables.
- [x] No periodic tick table, tick timer, or heartbeat table.
- [x] `playerId` is unique in addition to identity, preventing duplicate seats.
- [x] Schema exports all tables through one `schema({...})` object.

## Corrections made during validation

- Removed the scheduled tick table and `ScheduleAt` import because the chosen
  design has no periodic tick sealing.
- Removed `room_ticks`/seal tables and tick-sealed events.
- Removed `roomId` from room-scoped tables after choosing one database per room.
- Added `rooms.headTick`, updated only when a transaction row is appended.
- Added `seats.playerId.unique()`.
- Documented the client model as a safe server-clock delta, not a tick-seal wait.
- Documented arbiter decisions as final.
- Marked MVP scope as public rooms.

## Unresolved until a real Spacetime build

These are not proven by the static check:

- [ ] Exact 2.0 TypeScript module API matches the declaration stub.
- [ ] `.unique()` behavior on `t.identity()` in the installed SDK.
- [ ] Event-table support for enum columns in the installed SDK.
- [ ] Keyframe byte-array size limits and subscription behavior.
- [ ] Generated table/accessor names and client binding shape.
- [ ] Table access permissions/views; current schema marks tables public.
- [ ] `ctx.timestamp` behavior for tick assignment.
- [ ] Spacetime module publish/migration behavior.
- [ ] One-database-per-room provisioning/discovery.
- [ ] Scheduled vs unscheduled reducers: none needed for ticks now, but transaction
      reducers and event-table behavior still need runtime validation.
- [ ] Query/index performance for transaction/flag/keyframe access patterns.

## Required real validation step

When the Spacetime CLI install is approved:

```sh
spacetime --version
spacetime start
# scaffold/publish a minimal module using this schema
# generate client bindings
# run module unit tests
```

The schema should not be treated as production-valid until that step produces a
clean module build and generated bindings.

## Current conclusion

The schema is **syntactically valid and internally consistent** with the chosen
architecture and the documented 2.0 TypeScript API. It is **not yet runtime
validated** against Spacetime itself.
