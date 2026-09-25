# dsh-hmos-sidebar Maintenance Guide

## Purpose and Boundaries

Windows-only HarmonyOS developer workbench. The package has three faces:

- `lib/index.js`: Host action-level `/hmos/api/*` RPC only, plus the optional official settings namespace `hmos-sidebar`.
- `lib/client.js`: self-contained Web floating ball/panel in `shell.overlay`, plus the official Settings card on BOTH settings seats (legacy `settings.plugin.item` keyed `hmos-sidebar` for ≤ 0.1.5, rc.2 keyed row seat `plugins.row.config` keyed `ROW_CONFIG_KEY`).
- `lib/dcli-tools.mjs` via export `./tools`: `dcli__*` model tools mounted separately by an agent preset.

Never register the model tools from the main bundle. Never accept arbitrary argv in Web RPC. Preserve the package's Windows-only contract (`package.json#os`, runtime guards, docs, tests).

## Key Files

- `lib/environment.js`: one source of truth for CLI, Studio, hdc, hvigor, json5, project roots, and dynamic environment resolution.
- `lib/index.js`: Host route fence, body limit, action validation, path containment, device/build/deploy operations.
- `lib/client.js`: Shadow-DOM workbench, current-session cwd handling, bounded project discovery, persisted geometry.
- `lib/dcli-tools.mjs`: tool definitions and tool implementations.
- `bin/dsh-hmos-sidebar.mjs`: explicit `install-presets` CLI. It resolves `@deepseek-ai/dsh-agent-preset` from the target profile to pick the payload shape: on ≤ 0.1.5 it copies `presets/<id>/` into `<DSH_HOME>/.agent-presets/<id>/`; on ≥ 0.1.7-rc.1 it merges one `cordis:include` row per preset into a marked block of the profile's `cordis.patch.yml`. Conflict protection and timestamped backups apply to both shapes, and text outside the marked block is never rewritten. `--mode auto|directory|declarative` forces the shape; `--profile-dir` names the profile (default: cwd).
- `presets/native-harmonyos/agent.cordis.yml`: the directory payload (≤ 0.1.5) of the direct PTC presentation preset.
- `presets/native-harmonyos.declarative.yml`: the same preset as an `@deepseek-ai/dsh-agent-preset` declaration (≥ 0.1.7-rc.1), mounted by `cordis:include`.
- `presets/liangshen-native-harmonyos/agent.cordis.yml` and `presets/liangshen-native-harmonyos.declarative.yml`: deferred Liangshen promotion and its per-session PTC switch, in both payload shapes. `tool-bootstrap.mjs`, `custom-bash.mjs`, and `dsh-compat.mjs` stay in the directory and are reached from the declaration through the `./presets/liangshen-tool-bootstrap` and `./presets/liangshen-custom-bash` subpath exports. These files are the authoritative sources for both npm-bundled presets; user-level copies are deployment artifacts.
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
- Settings namespace `hmos-sidebar` owns exactly two booleans, `popup.keepCollapsed` and `ball.hideWithoutProject`, both defaulting to `true` (quiet mode: no auto-expand popup; ball hidden until a HarmonyOS project is probed). The two hosts reach it differently: ≤ 0.1.5 registers the namespace with `ctx.settings.register('hmos-sidebar', …)` and the client binds `settingsScope.bind({ namespace: 'hmos-sidebar' })`, while ≥ 0.1.7 has no `register` at all — the namespace IS the entry's exported `Config`, keyed by the loader entry id `dsh-hmos-sidebar` (the client's first lookup), with both leaves marked `.volatile()` and `ctx.settings.configure({ auto: false }, ctx.fiber)` declaring that this plugin renders its own card instead of a generated page. The marker is applied by capability because the 0.1.5 schemastery has no `.volatile`; an unconditional call would throw at module load. The host half never reads these values (the client owns quiet mode), and the client falls back to identical defaults when the service is absent or not ready. Never add a second persistence path for these flags. The CARD seat is version-dependent too: ≤ 0.1.5 declares `settings.plugin.item` (key `hmos-sidebar`), while 0.1.7-rc.2 REMOVED that slot and a bundle row's configuration seat is the keyed `plugins.row.config`, whose occupant key must equal `` `dsh-hmos-sidebar#dsh-hmos-sidebar` `` = `` `${package.json#name}#<row id in cordis.patch.yml>` `` — the official manager renders the row's configure control only while that exact key sits on its ledger, so a card left on one seat renders nowhere, silently. Register the rc.2 occupant as ONE options object (`{ name, key }`, the slots service reads `options.name`) from inside a non-gating `ctx.inject(['slots'], …)` callback that returns the registration disposer, render a one-liner alone for `view === 'summary'` (inline styles: the card style tag is created lazily by a card render, so the summary can precede it) and the existing card for `'page'`, and never read the host-owned optional `form` prop; `test/client-source.test.mjs` guards the seat, the key derivation and the summary branch.
- DSH tool-presentation identifiers are `native`, `ptc`, and `both`; never reintroduce the removed `code` identifier. `native-harmonyos` must declare `mode: ptc`; Liangshen must keep `promotedPresentation: ptc`, validate `native | ptc`, and call `tools.presentAs('ptc')` after promotion.
- `@deepseek-ai/dsh-persona` rows use `prefix` / `suffix` / `complete` / `includeRuntimeContext`; `prefix` is required since DSH 0.1.5-rc.1 and the pre-0.1.5 `text` key now fails the whole preset mount with `- $.prefix missing required value (at prefix)`. That release also split the persona prompt section into `deployment:persona-prefix` / `deployment:persona-suffix`, so `PERSONA_SECTION_NAMES` in `presets/liangshen-native-harmonyos/tool-bootstrap.mjs` must list the new name (keeping the old names is fine) or the phase-1 assembly loses its persona and the promoted workspace/PTC lines stop applying.
- Each bundled preset has TWO payloads that must stay row-for-row equivalent: `presets/<id>/agent.cordis.yml` (directory, ≤ 0.1.5) and `presets/<id>.declarative.yml` (declaration, ≥ 0.1.7-rc.1). Exactly three deltas are legitimate, all forced by rc.1: `@deepseek-ai/dsh-workflow-worker-thread` → `@deepseek-ai/dsh-workflow-ptc` (row id `workflow-ptc`, no upstream alias), the `skills/` directory located with `createRequire(baseUrl).resolve('dsh-hmos-sidebar/package.json')` instead of `new URL(..., baseUrl)`, and rc.1's product-row vocabulary (`backgroundMode: one-shot` + `maxDepth: provider-managed`, replacing `enableRunInBackground`). A declaration has NO directory of its own, so one of its rows may never name `./file.mjs`; that is why the two Liangshen modules are package subpath exports. After touching either payload, run `node ..\..\..\scripts\preset-declarative-check.mjs` from the workspace root: it parses both with the loader's YAML dialect and fails on any other drift, including persona text.
- A profile package upgrade does not update existing user preset copies. Publish the corrected presets first, then run `pnpm exec dsh-hmos-sidebar install-presets --all --force` from the target profile directory so the profile's installed package owns conflict handling and backups. On ≥ 0.1.7-rc.1 nothing is copied at all: the profile patch only points at the installed package, so upgrading the package refreshes the preset and re-running the installer reports “already current”.

## Validation

Run from this package root:

```powershell
npm test
node --check lib/index.js
node --check lib/client.js
node --check lib/dcli-tools.mjs
node --check lib/environment.js
node --check lib/dual-signing.js
node --check bin/dsh-hmos-sidebar.mjs
node --check presets/liangshen-native-harmonyos/tool-bootstrap.mjs
npm pack --dry-run
```

Then, from the workspace root, verify the two payloads still describe the same preset:

```powershell
node scripts/preset-declarative-check.mjs
```

To exercise the declarative installer without a ≥ 0.1.7 host, point it at a throwaway profile and force the shape: `node bin/dsh-hmos-sidebar.mjs install-presets --all --mode declarative --profile-dir <tmp-profile> --dry-run` (a real profile only ever gets `--dry-run` unless the user asked for the install).

For Web changes, reconcile with `dsh plugin --profile web add .`, restart the existing `dsh web` process when Host or package location changed, then verify the real `http://127.0.0.1:3080` panel.

## Pitfalls

- Package documentation historically said 40 tools while implementation/tests may assert 41; treat executable definitions/tests as source of truth and keep docs synchronized.
- Main bundle mounting and preset tool mounting are separate lifecycle units; a working panel does not prove tools are visible to an agent.
- When either bundled preset changes, update BOTH of its payloads (directory and declaration) and any custom bootstrap together, retain the PTC source assertions in `test/package-contract.test.mjs`, confirm both preset trees appear in `npm pack --dry-run`, and follow the repository-level version/tag workflow in `../../AGENTS.md`.
- DSH 0.1.7-rc.1 removed the directory preset roster outright: a preset that exists only as `presets/<id>/` is not loaded, and nothing reports an error — it simply never appears in the picker. Installing the declaration on a ≤ 0.1.5 host is the opposite failure: the `@deepseek-ai/dsh-agent-preset` row cannot resolve and the whole Web boot fails with `N entries did not activate`, which is why the installer probes the profile instead of shipping both shapes as bundle patches.
- `tools.presentAs('ptc')` throws in rc.1 when the same scope already declares a static presentation (`one composition selects one presentation`). Liangshen therefore must NOT gain a `tool-presentation` row while its bootstrap switches presentation imperatively; `native-harmonyos` keeps its static `mode: ptc`.
- `process.cwd()` is a fallback project candidate, not an automatically trusted path-fence root.
- Do not add POSIX fallbacks that imply support; npm `EBADPLATFORM` and runtime guards are deliberate.
- For local development, use the package root as the working directory; do not hard-code a machine-specific path in source or published documentation.
