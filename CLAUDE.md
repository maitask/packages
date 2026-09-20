# Maitask Packages Rules

Read workspace `AGENTS.md` first. This file adds catalog-only constraints.

- Official packages use `@maitask/*`. Publishing them requires a platform
  administrator.
- Localized metadata belongs in `maitask.locales.en` and `maitask.locales.zh`.
  Flat `maitask.locales.*` keys are fallback defaults only.
- Official option schemas belong in `maitask.schemas`.
- The production package matrix searches the public catalog and does not
  publish packages. New or bumped official versions must exist in production
  before the release gate.

## Quality Gates

Run package-specific tests or `npm pack` from `packages/` when metadata or
runtime behavior changes.

## Git

Follow workspace `AGENTS.md`.
