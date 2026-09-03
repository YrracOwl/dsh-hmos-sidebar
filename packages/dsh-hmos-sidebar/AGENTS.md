# dsh-hmos-sidebar Maintenance Guide

## Purpose and Boundaries

Windows-only HarmonyOS developer workbench. The package has three faces:

- `lib/index.js`: Host action-level `/hmos/api/*` RPC only, plus the optional official settings namespace `hmos-sidebar`.
- `lib/client.js`: self-contained Web floating ball/panel in `shell.overlay`, plus the official Settings card in `settings.plugin.item`.
- `lib/dcli-tools.mjs` via export `./tools`: `dcli__*` model tools mounted separately by an agent preset.

Never register the model tools from the main bundle. Never accept arbitrary argv in Web RPC. Preserve the package's Windows-only contract (`package.json#os`, runtime guards, docs, tests).

## Key Files

- `lib/environment.js`: one source of truth for CLI, Studio, hdc, hvigor, json5, project roots, and dynamic environment resolution.
- `lib/index.js`: Host route fence, body limit, action validation, path containment, device/build/deploy operations.
- `lib/client.js`: Shadow-DOM workbench, current-session cwd handling, bounded project discovery, persisted geometry.
- `lib/dcli-tools.mjs`: tool definitions and tool implementations.
- `bin/dsh-hmos-sidebar.mjs`: explicit `install-presets` CLI with conflict protection and backups.
- `presets/`: the two bundled user-level HarmonyOS agent presets.
- `lib/dual-signing.js`: preview-first dual-signing merge and backup behavior.
- `lib/validate.js`: shared validation helpers.
- `cordis.patch.yml`: main Host+Client row only; no personal paths and no tools row.
- `test/`: environment, RPC security, tools, signing, generated AGENTS, and client-source regressions.

## Invariants

- Environment discovery is dynamic per call: config → environment variables → common Windows install locations. Do not cache paths in a way that requires restarting DSH after installing CLI/Studio.
- RPC is POST-only, same-origin/loopback fenced, action-level, and capped at 64 KiB.
- Filesystem actions must stay inside explicitly trusted roots when configured; preserve realpath/nearest-existing-parent handling against `..`, UNC, junction, and reparse-point escapes.
- Do not return secrets. Absolute paths and device serials are intentionally disclosed only to the same-origin local page.
- `dcli__configure_dual_signing` is preview-first (`apply=false`), creates one backup, validates material, and never echoes passwords.
- `dcli__agents_md` is preview-first (`apply=false`), owns only its unique managed-marker block, preserves all text outside it, rejects malformed/duplicate markers, and uses a one-time backup plus atomic replacement when applying.
- The UI is independent of better-sidebar and must remain usable when DevEco/CLI is absent; errors must be actionable.
- Settings namespace `hmos-sidebar` owns exactly two booleans, `popup.keepCollapsed` and `ball.hideWithoutProject`, both defaulting to `true` (quiet mode: no auto-expand popup; ball hidden until a HarmonyOS project is probed). Host registration is an optional nested `ctx.inject(['settings'])`; the client reads the same values via `settingsScope` and falls back to identical defaults when the service is absent or not ready. Never add a second persistence path for these flags.

## Validation

Run from this package root:

```powershell
npm test
node --check lib/index.js
node --check lib/client.js
node --check lib/dcli-tools.mjs
node --check lib/environment.js
node --check lib/dual-signing.js
npm pack --dry-run
```

For Web changes, reconcile with `dsh plugin --profile web add .`, restart the existing `dsh web` process when Host or package location changed, then verify the real `http://127.0.0.1:3080` panel.

## Pitfalls

- Package documentation historically said 40 tools while implementation/tests may assert 41; treat executable definitions/tests as source of truth and keep docs synchronized.
- Main bundle mounting and preset tool mounting are separate lifecycle units; a working panel does not prove tools are visible to an agent.
- `process.cwd()` is a fallback project candidate, not an automatically trusted path-fence root.
- Do not add POSIX fallbacks that imply support; npm `EBADPLATFORM` and runtime guards are deliberate.
- For local development, use the package root as the working directory; do not hard-code a machine-specific path in source or published documentation.
