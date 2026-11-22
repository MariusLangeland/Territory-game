# Release checklist

Run this before tagging or deploying a build. Code and tests remain authoritative;
this is the verification path, not a second specification.

## 1. Version and generated docs

- [ ] Bump `package.json` only for a release batch.
- [ ] Run `pnpm docs:reference`; commit the generated change if any.
- [ ] Run `pnpm docs:check`.
- [ ] Confirm `docs/DECISIONS.md` has an ADR for any design change.
- [ ] Confirm README/AGENTS/SPEC contain no removed feature names.

## 2. Fast and full verification

```sh
pnpm check
pnpm test:fast
pnpm test:stress
pnpm test
pnpm build
```

`test:fast` skips the long simulation and evolution stress files. `test:stress`
runs only those files; run both before a release. `pnpm test` remains the full
single command for CI.

## 3. Browser matrix

Verify in current Chrome or Edge with WebGPU enabled.

### Main game

- [ ] Open `/?seed=1234`; no WebGPU error modal; DEPLOY enabled.
- [ ] Deploy; HUD, leaderboard, minimap, and supply bar match the selected settings.
- [ ] Attack a frontier, pause/resume, and confirm no floating last-action box.
- [ ] Build and upgrade a structure; confirm supply/cost feedback and district highlight.
- [ ] Build a Port and launch a naval landing.
- [ ] Pan/zoom under load; no recurring frame hitch and camera clamps at map edges.
- [ ] Open a narrow viewport and scroll the leaderboard to the last rank.

### Evolution Lab

- [ ] Open `/evolution`; no `/duel` link or route (direct `/duel` returns 404).
- [ ] Start a short run at `1000×`; canvas fills the left area and RATE shows a plausible ticks/s value.
- [ ] Pan/zoom and toggle panels while the worker runs; UI remains responsive.
- [ ] Finish a generation; spreadsheet, Markov graph, and fitness history update.
- [ ] Reload; the generation-boundary session restores paused with RESTORED visible.
- [ ] Continue starts the next generation.
- [ ] DISCARD clears the checkpoint and returns to the idle state.
- [ ] NEW EVOLUTION replaces any saved checkpoint.
- [ ] CSV export/import and saved-bucket loading still work.

## 4. Persistence and failure behavior

- [ ] Reload after a completed generation; saved config/population/reports restore.
- [ ] Reload after starting but before completion; the previous terminal checkpoint remains.
- [ ] Private/blocked IndexedDB mode still allows a run (persistence is best-effort).
- [ ] No uncaught worker errors in the console.

## 5. Final state

- [ ] `git status` is clean.
- [ ] Version in `package.json` and the release tag agree.
- [ ] CI is green.
- [ ] No generated output (`.svelte-kit/`, `build/`, `node_modules/`) is committed.
