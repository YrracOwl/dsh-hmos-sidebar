# Contributing

1. Keep the plugin and each preset independently reviewable.
2. Do not add personal absolute paths, local HarmonyOS projects, HAP/APP files, signing materials, `.env` files, or user data.
3. Run the package tests, JavaScript syntax checks, `npm pack --dry-run`, and `git diff --check` before submitting a pull request.
4. Update the package README and preset metadata when user-facing installation or tool counts change.
5. Never print credentials, passwords, device serials, or private configuration in tests, logs, screenshots, or issue reports.
