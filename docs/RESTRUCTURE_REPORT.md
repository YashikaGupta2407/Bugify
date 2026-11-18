# Repository reorganization report

This report records the checkpoint before the later request to commit and push.
At that checkpoint, the reorganization was complete on `restructure-folders`,
no commits had been created, and HEAD was
`42d1d0b770c52eeed12922c1f5c77c4df32d11a6`.

The final layout contains the extension, website, single shared backend, docs,
fixtures, and archive. Forty-five existing files were relocated: 44 tracked files
using `git mv`, plus the existing untracked review report using a normal move.
Added `docs/STRUCTURE.md` and this report. Existing-file content edits are limited
to path references. No application logic, identifiers, dependencies, or lockfile
contents were changed.

## Complete move map

| Old path | New path |
| --- | --- |
| `JAVASCRIPT_CONVERSION_REPORT.md` | `docs/JAVASCRIPT_CONVERSION_REPORT.md` |
| `PROJECT_RULES.md` | `archive/scaffolding/PROJECT_RULES.md` |
| `REVIEW_REPORT.md` | `docs/REVIEW_REPORT.md` |
| `VERSION` | `archive/scaffolding/VERSION` |
| `backend/src/prisma.js` | `backend/src/config/prisma.js` |
| `backend/src/services/executionService.js` | `archive/backend/src/services/executionService.js` |
| `extension/test-fixtures/js-reference.js` | `fixtures/test-fixtures/js-reference.js` |
| `extension/test-fixtures/js-undefined.js` | `fixtures/test-fixtures/js-undefined.js` |
| `extension/test-fixtures/jsconfig.json` | `fixtures/test-fixtures/jsconfig.json` |
| `extension/test-fixtures/py-index.py` | `fixtures/test-fixtures/py-index.py` |
| `extension/test-fixtures/ts-mismatch.ts` | `fixtures/test-fixtures/ts-mismatch.ts` |
| `extension/test-fixtures/tsconfig.json` | `fixtures/test-fixtures/tsconfig.json` |
| `extension/test-workspace/src/another-error.ts` | `fixtures/test-workspace/src/another-error.ts` |
| `extension/test-workspace/src/app.ts` | `fixtures/test-workspace/src/app.ts` |
| `extension/test-workspace/src/auth.ts` | `fixtures/test-workspace/src/auth.ts` |
| `extension/test-workspace/src/clean.ts` | `fixtures/test-workspace/src/clean.ts` |
| `extension/test-workspace/src/closed-error.ts` | `fixtures/test-workspace/src/closed-error.ts` |
| `extension/test-workspace/src/hidden-error.ts` | `fixtures/test-workspace/src/hidden-error.ts` |
| `extension/test-workspace/src/open.ts` | `fixtures/test-workspace/src/open.ts` |
| `extension/test-workspace/tsconfig.json` | `fixtures/test-workspace/tsconfig.json` |
| `frontend/index.html` | `website/index.html` |
| `frontend/logo.png` | `website/logo.png` |
| `frontend/package-lock.json` | `website/package-lock.json` |
| `frontend/package.json` | `website/package.json` |
| `frontend/src/App.css` | `website/src/styles/App.css` |
| `frontend/src/App.jsx` | `website/src/App.jsx` |
| `frontend/src/main.jsx` | `website/src/main.jsx` |
| `frontend/vite.config.js` | `website/vite.config.js` |
| `model_capabilities.yaml` | `archive/scaffolding/model_capabilities.yaml` |
| `scripts/search_repo.ps1` | `archive/scaffolding/scripts/search_repo.ps1` |
| `scripts/search_repo.sh` | `archive/scaffolding/scripts/search_repo.sh` |
| `scripts/setup_search.ps1` | `archive/scaffolding/scripts/setup_search.ps1` |
| `scripts/setup_search.sh` | `archive/scaffolding/scripts/setup_search.sh` |
| `scripts/validate-agents.ps1` | `archive/scaffolding/scripts/validate-agents.ps1` |
| `scripts/validate-agents.sh` | `archive/scaffolding/scripts/validate-agents.sh` |
| `scripts/validate-all.ps1` | `archive/scaffolding/scripts/validate-all.ps1` |
| `scripts/validate-all.sh` | `archive/scaffolding/scripts/validate-all.sh` |
| `scripts/validate-encoding.ps1` | `archive/scaffolding/scripts/validate-encoding.ps1` |
| `scripts/validate-encoding.sh` | `archive/scaffolding/scripts/validate-encoding.sh` |
| `scripts/validate-skills.ps1` | `archive/scaffolding/scripts/validate-skills.ps1` |
| `scripts/validate-skills.sh` | `archive/scaffolding/scripts/validate-skills.sh` |
| `scripts/validate-templates.ps1` | `archive/scaffolding/scripts/validate-templates.ps1` |
| `scripts/validate-templates.sh` | `archive/scaffolding/scripts/validate-templates.sh` |
| `scripts/validate-workflows.ps1` | `archive/scaffolding/scripts/validate-workflows.ps1` |
| `scripts/validate-workflows.sh` | `archive/scaffolding/scripts/validate-workflows.sh` |

The `frontend/` directory rename also carried its ignored installed dependencies
and build output. The fixture directory move carried the existing Python cache.
No contents were deleted. Root `README.md`, `.gitignore`, `docker-compose.yml`,
and `.env.example` remain at the root. The extension source, media, tests, and
vendored compiler remain under `extension/`. Backend middleware remains grouped
under `backend/src/middleware/`.

## Updated references

- Backend controller imports and test mocks now use `src/config/prisma.js`.
- The backend website test now reads `website/src/App.jsx`; its CSS import stub
  matches `./styles/App.css`.
- Extension tests, fixture launch arguments, and HTML preview location labels
  point to the relocated fixtures.
- VS Code and Antigravity host scripts use `../fixtures/test-fixtures` from the
  extension directory. Root and extension-local ignored launch configurations
  resolve their fixture arguments from their respective workspace roots.
- Existing READMEs, report references, and archived script usage paths received
  path updates. Existing documentation findings and setup problems were retained.

## Baseline and final verification

| Check | Before moves | After moves |
| --- | --- | --- |
| Extension package test script | 67 passed, 0 failed | 67 passed, 0 failed |
| Additional extension trustworthy-suggestions suite | 17 passed, 0 failed | 17 passed, 0 failed |
| Backend tests | 58 passed, 4 failed | 58 passed, same 4 failed |
| Website production build | Passed, 27 modules | Passed, 27 modules; identical asset names and sizes |

Additional final checks:

- `node --check` passed for 54 application, test, seed, and archived JavaScript
  files. Vite checked website JSX. Intentional broken-code fixtures and vendored
  compiler files were excluded from application syntax checks.
- All 27 extension source modules loaded with VS Code stubbed. Activation
  registered all seven manifest commands, the sidebar, code actions, and status
  bar. Deactivation and subscription disposal completed. This was a Node smoke
  check with a stub, rather than a live editor UI session.
- Scanner and fix-validator source hashes match the starting snapshot, so their
  compiler-resolution order is unchanged. Both relocated fixture workspaces
  selected the vendored scanner compiler. Forcing the initial validator
  `require("typescript")` to fail successfully used vendored TypeScript 5.9.3
  and produced a verified full-file correction.
- The backend application loaded with its real routes and Prisma client and
  served `/api/health` with HTTP 200 on an ephemeral localhost port.
- Prisma validated `backend/prisma/schema.prisma`. The seed command remains
  `node prisma/seed.js` relative to `backend/`; all four migration SQL files and
  the migration lock are intact. Seeds and migrations were not executed.
- Both local editor launch configurations resolve their extension and fixture
  paths. Extension `main`, package scripts, Vite entry and proxy, dotenv loading
  directory, and Compose named-volume paths remain valid.
- The old-path scan found no obsolete concrete repository paths outside the
  excluded protected/generated content. Old paths in this move-map report are
  intentional; synthetic test inputs and inert packaging exclusions are retained.
- No checked-in CI workflow was present.

The four backend failures are the same endpoint tests at
`backend/test/extension.test.js:50`, `:61`, `:72`, and `:109`. With localhost
access enabled, port 5000 returned HTTP 403; the listening process was macOS
Control Center. The initial sandboxed run could not connect to localhost.
The final baseline comparison uses the localhost-enabled runs. No provider
requests, database seed, or migrations were run by the verification smoke check.

## Preservation and approved adjustments

- Your pre-existing `extension/media/bugify.css` changes remain byte-for-byte
  identical to the starting worktree. They remain uncommitted.
- Your existing untracked review report now lives at `docs/REVIEW_REPORT.md`.
  Only its file-path references were updated; it remains untracked.
- All 128 protected files checked, including fixtures, media/CSS, vendored
  TypeScript, and Prisma files, retain their starting bytes.
- A hash audit accounted for all 226 starting files: 206 were byte-identical
  after mapping their new paths, and 20 differed only by exact path replacements.
  All 226 files were unchanged during the documentation phase and final check.
- The new branch was created from the existing committed HEAD while preserving
  the dirty worktree, as approved. Nothing was stashed, discarded, or committed.
- Both root and extension-local ignored `.vscode/` settings were retained to
  preserve the two workspace launch contexts. Their fixture arguments were
  updated; existing obsolete extension-local build tasks were left unchanged.
- As approved, relocating `test-workspace/` removes its eight files from the
  VSIX inventory. No other package entries were added or removed. All 103
  vendored TypeScript package entries remain included. No new VSIX was built.

## Archived files

Twenty files were retained under `archive/`:

- `archive/backend/src/services/executionService.js`: unused mock executor;
  no runtime importer was found.
- `archive/scaffolding/PROJECT_RULES.md`, `model_capabilities.yaml`, and `VERSION`:
  generic methodology rules, optional model registry, and scaffolding version.
- `archive/scaffolding/scripts/`: both `.sh` and `.ps1` versions of
  `search_repo`, `setup_search`, `validate-agents`, `validate-all`,
  `validate-encoding`, `validate-skills`, `validate-templates`, and
  `validate-workflows` (16 scripts). Exact paths appear in the move map above.

## Noticed but not fixed

- Database password mismatch: `backend/.env.example` uses `postgres`; Compose
  uses `postgrespassword`.
- The root setup guide omits seeding, while controllers require the seeded demo
  user. Existing overview, API examples, and extension capability claims contain
  outdated material. Only existing-document paths were updated.
- Backend endpoint tests depend on a running API and seeded database; they do
  not isolate those dependencies. Port 5000 is occupied in this environment.
- Ignored extension-local editor settings reference missing compile/watch
  scripts and `out/`. The root launcher has no build task.
- Prisma warns that the existing `package.json#prisma` configuration is
  deprecated. No configuration migration or dependency upgrade was made.
- Host scripts retain their existing absolute macOS application paths.
- Archived GSD scripts refer to methodology scaffolding absent from this
  checkout. They were archived rather than repaired.
- `.vscodeignore` retains the now-inert `test-fixtures/**` exclusion.

## Git state at the pre-publication checkpoint

Commits created: **0**. The `git mv` rename entries are staged; subsequent path
edits remain unstaged. The review report, structure guide, and this report are
untracked. Local editor configurations remain ignored. Your existing CSS edit
remains separate and unstaged.

See [STRUCTURE.md](STRUCTURE.md) for the folder map and run/test commands.
Existing reports are [REVIEW_REPORT.md](REVIEW_REPORT.md) and
[JAVASCRIPT_CONVERSION_REPORT.md](JAVASCRIPT_CONVERSION_REPORT.md).
