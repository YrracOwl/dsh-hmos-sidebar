# dsh-hmos-sidebar Release Repository Guide

## Scope

This directory is the Git release checkout for `https://github.com/YrracOwl/dsh-hmos-sidebar`. Package source lives under `packages/dsh-hmos-sidebar/`; the sibling `../dsh-hmos-sidebar/` is a separate local panel/tool development copy with no Git metadata and is not the place to version, tag, or publish.

The package-local `packages/dsh-hmos-sidebar/AGENTS.md` adds implementation, preset, and validation rules. This file owns repository-level release workflow facts.

## Repository Map

- `packages/dsh-hmos-sidebar/`: the npm package and its tests.
- `packages/dsh-hmos-sidebar/presets/`: authoritative source for the bundled `native-harmonyos` and `liangshen-native-harmonyos` presets.
- `.github/workflows/publish-npm.yml`: Windows release workflow; tag pushes matching `v*.*.*` run tests, verify package contents, create the GitHub Release, and publish to npm with provenance.

## Release Workflow

Run package validation from `packages/dsh-hmos-sidebar/`, then run Git operations from this repository root.

1. Update `packages/dsh-hmos-sidebar/package.json#version` and keep the release source/tests synchronized.
2. Run the package-local validation commands from its `AGENTS.md`.
3. Confirm `git status --short --branch`, the `origin` remote, and `git diff --check` before committing.
4. Commit and push `main`.
5. Create and push an annotated tag exactly matching the package version, for example `vX.Y.Z`. A plain branch push does not publish; the tag triggers `.github/workflows/publish-npm.yml`.
6. Verify the Actions run succeeds and confirm the exact version exists in npm. Registry visibility may lag a successful publish briefly.

Never reuse or move an existing release tag. Do not edit the workflow merely to publish one version.

## Installed Profile and Preset Refresh

Publishing or installing a newer package does not overwrite user-level preset copies. When a released version changes bundled presets:

1. Upgrade the profile through `dsh plugin --profile web add dsh-hmos-sidebar@<version>`.
2. From the Web profile directory, run `pnpm exec dsh-hmos-sidebar install-presets --all --force`; it uses the profile's installed package and backs up each existing target before replacement.
3. Restart the existing DSH Web Profile so the Host rebuilds preset standing generations. Do not start a second server for verification.

User preset directories are deployment copies, not the source of truth. Fix preset behavior here, publish it, and refresh through the installer rather than hand-patching those copies.
