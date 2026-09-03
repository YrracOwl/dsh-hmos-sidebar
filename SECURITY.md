# Security Policy

## Scope

This repository contains a Windows-only DSH plugin and agent presets. It must not contain HarmonyOS application projects, signing artifacts, device serials, account sessions, or credentials.

## Reporting a vulnerability

Please do not open a public issue for an exploitable vulnerability. Contact the repository maintainers privately through the GitHub Security Advisories feature or the private contact listed in the repository profile. Include affected path/version, reproduction steps, impact, and a suggested mitigation when available.

## Before publishing

Run a secret scanner over both the working tree and Git history. If a credential was ever committed, revoke/rotate it first; deleting the file is not sufficient.
