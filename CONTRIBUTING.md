# Contributing to Maitask Packages

Thank you for helping improve the official Maitask package collection. All contributions must follow the workflow below to ensure packages remain production-ready.

## 1. Pick or Propose a Package
- Open an issue describing the change (new package, feature, or fix).
- Ensure the package scope follows the naming convention `@maitask/<name>` and targets Node.js 18+.

## 2. Local Development
- Duplicate an existing package as a starting point if needed.
- Implement changes with TypeScript definitions when appropriate.
- Provide usage examples under `examples/` when introducing new behaviour.

## 3. Validation Checklist
- `npm install` and `npm run lint` (if available).
- `npm test` or relevant script (if applicable).
- `npm pack` to confirm the publish artifact.
- Manual smoke test via Maitask Engine:
  ```bash
  cd ../../engine
  cargo run -- run @maitask/package-name --input sample.json
  ```

## 4. Documentation
- Update [PACKAGES.md](./PACKAGES.md) with the new or modified entry.
- Keep [README.md](./README.md) and [README_zh-CN.md](./README_zh-CN.md) in sync when adding links or references.

## 5. Submit a Pull Request
- Run `npm pack` and attach the generated tarball in the PR description when possible.
- Reference the tracking issue and outline testing performed.
- A maintainer will review, run additional checks, and handle publication.

You can reach the maintainers at `team@maitask.com` for coordination around major releases.
