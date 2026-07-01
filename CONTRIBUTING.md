# Contributing to Maitask Packages

Thank you for helping improve the official Maitask package collection. All contributions must follow the workflow below to ensure packages remain production-ready.

## 1. Pick or Propose a Package
- Open an issue describing the change (new package, feature, or fix).
- Ensure the package scope follows the naming convention `@maitask/<name>` and targets Node.js 18+.

## 2. Local Development
- Duplicate an existing package as a starting point if needed.
- Implement changes with TypeScript definitions when appropriate.
- Provide a production `example.json` and ensure it is included in `package.json.files` when that allowlist is present.
- Define display metadata under `maitask.locales.en` and `maitask.locales.zh`. If a package only has one neutral label set, use flat `maitask.locales.display_name`, `description`, `category`, and `keywords` as the default fallback.

## 3. Validation Checklist
- `npm install` and `npm run lint` (if available).
- `npm test` or relevant script (if applicable).
- `npm pack` to confirm the publish artifact.
- `scripts/publish_to_plane.sh <package-dir>` for registry publish dry-runs against a development Plane instance when changing package metadata or artifacts.
- Manual smoke test via Maitask Runtime:
  ```bash
  cd ../../runtime
  cargo run -- run @maitask/package-name --input sample.json
  ```

## 4. Documentation
- Update [PACKAGES.md](./PACKAGES.md) with the new or modified entry.
- Keep [README.md](./README.md) and [README_zh-CN.md](./README_zh-CN.md) in sync when adding links or references.

## 5. Submit a Pull Request
- Run `npm pack` and attach the generated tarball in the PR description when possible.
- Reference the tracking issue and outline testing performed.
- Use concise, formal English commit message subjects and bodies that match the code change. Do not use `fix:`, `feat:`, or other Conventional Commit prefixes unless repository tooling requires them.
- A maintainer will review, run additional checks, and publish through `scripts/publish_to_plane.sh` so registry metadata and tarball storage remain consistent.

You can reach the maintainers at `team@maitask.com` for coordination around major releases.
