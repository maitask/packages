# Official Package Catalog Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the official package catalog self-verifying so every published package is documented, loadable, localized, example-backed, and archive-safe before deeper behavior regression is added.

**Architecture:** Discover packages directly from package directories containing `package.json`, then expose one focused test helper for manifest and archive inspection. Replace the narrow metadata test with catalog-level tests that reconcile filesystem, `PACKAGES.md`, package entry points, locale metadata, examples, and `npm pack --dry-run` output without introducing a second package registry.

**Tech Stack:** Node.js 18+, built-in `node:test`, `node:assert`, `node:child_process`, CommonJS package modules, npm package archives.

---

### Task 1: Add package discovery and archive inspection helpers

**Files:**
- Create: `tests/helpers/package-catalog.js`

- [ ] **Step 1: Create the helper module**

```js
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..', '..');

function discoverPackages() {
  return fs
    .readdirSync(repositoryRoot, { withFileTypes: true })
    .filter(entry => {
      return (
        entry.isDirectory() &&
        fs.existsSync(path.join(repositoryRoot, entry.name, 'package.json'))
      );
    })
    .map(entry => {
      const directory = path.join(repositoryRoot, entry.name);
      const manifestPath = path.join(directory, 'package.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      return {
        directory,
        directoryName: entry.name,
        manifest,
        manifestPath
      };
    })
    .sort((left, right) => left.directoryName.localeCompare(right.directoryName));
}

function inspectPackageArchive(packageInfo) {
  const result = spawnSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    {
      cwd: packageInfo.directory,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    const diagnostic = (result.stderr || result.stdout || 'npm pack failed').trim();
    throw new Error(`${packageInfo.manifest.name}: ${diagnostic}`);
  }

  const payload = JSON.parse(result.stdout);
  if (!Array.isArray(payload) || payload.length !== 1) {
    throw new Error(`${packageInfo.manifest.name}: npm pack returned an invalid result`);
  }

  return payload[0];
}

module.exports = {
  discoverPackages,
  inspectPackageArchive,
  repositoryRoot
};
```

- [ ] **Step 2: Verify the helper loads and discovers all packages**

Run:

```bash
node -e "const {discoverPackages}=require('./tests/helpers/package-catalog'); const packages=discoverPackages(); if(packages.length!==49) process.exit(1); console.log(packages.length)"
```

Expected: `49`

- [ ] **Step 3: Commit the helper**

```bash
git add tests/helpers/package-catalog.js
git commit -m "Add official package catalog inspection helpers"
```

### Task 2: Replace narrow metadata checks with catalog integrity tests

**Files:**
- Create: `tests/catalog-integrity.test.js`
- Delete: `tests/package-metadata.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the catalog integrity tests**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { discoverPackages, repositoryRoot } = require('./helpers/package-catalog');

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const packageInfos = discoverPackages();

function assertNonEmptyString(value, message) {
  assert.equal(typeof value, 'string', message);
  assert.notEqual(value.trim(), '', message);
}

test('official catalog documents every package exactly once', () => {
  const catalog = fs.readFileSync(path.join(repositoryRoot, 'PACKAGES.md'), 'utf8');
  const totalMatch = catalog.match(/Total packages:\s*\*\*(\d+)\*\*/);

  assert.ok(totalMatch, 'PACKAGES.md must declare the total package count');
  assert.equal(Number(totalMatch[1]), packageInfos.length);

  for (const packageInfo of packageInfos) {
    const escapedDirectory = packageInfo.directoryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const linkPattern = new RegExp(`\\]\\(\\./${escapedDirectory}\\)`, 'g');
    const links = catalog.match(linkPattern) || [];
    assert.equal(
      links.length,
      1,
      `${packageInfo.manifest.name} must appear exactly once in PACKAGES.md`
    );
  }
});

test('every official package has complete production metadata', () => {
  for (const packageInfo of packageInfos) {
    const { directory, directoryName, manifest } = packageInfo;
    assert.equal(manifest.name, `@maitask/${directoryName}`);
    assert.match(manifest.version, SEMVER_PATTERN, `${manifest.name} must use SemVer`);
    assertNonEmptyString(manifest.description, `${manifest.name} must have a description`);
    assertNonEmptyString(manifest.main, `${manifest.name} must declare main`);
    assert.ok(fs.existsSync(path.join(directory, manifest.main)), `${manifest.name} main is missing`);

    if (manifest.types) {
      assert.ok(
        fs.existsSync(path.join(directory, manifest.types)),
        `${manifest.name} type declarations are missing`
      );
    }

    assert.ok(fs.existsSync(path.join(directory, 'README.md')), `${manifest.name} README is missing`);
    assert.ok(fs.existsSync(path.join(directory, 'example.json')), `${manifest.name} example is missing`);

    if (Array.isArray(manifest.files)) {
      assert.ok(manifest.files.includes('README.md'), `${manifest.name} must publish README.md`);
      assert.ok(manifest.files.includes('example.json'), `${manifest.name} must publish example.json`);
      assert.ok(manifest.files.includes(manifest.main), `${manifest.name} must publish its entry point`);
      if (manifest.types) {
        assert.ok(manifest.files.includes(manifest.types), `${manifest.name} must publish its types`);
      }
    }

    for (const locale of ['en', 'zh']) {
      const localized = manifest.maitask?.locales?.[locale];
      assert.ok(localized, `${manifest.name} must define maitask.locales.${locale}`);
      assertNonEmptyString(localized.name, `${manifest.name} ${locale} name is required`);
      assertNonEmptyString(localized.description, `${manifest.name} ${locale} description is required`);
    }
  }
});

test('every official package exposes the execution entry point', () => {
  for (const packageInfo of packageInfos) {
    const entryPath = path.join(packageInfo.directory, packageInfo.manifest.main);
    delete require.cache[require.resolve(entryPath)];
    const loaded = require(entryPath);
    const execute = typeof loaded === 'function' ? loaded : loaded.execute;
    assert.equal(typeof execute, 'function', `${packageInfo.manifest.name} must export execute`);
  }
});

test('every package example follows the documented envelope types', () => {
  for (const packageInfo of packageInfos) {
    const examplePath = path.join(packageInfo.directory, 'example.json');
    const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
    const examples = Array.isArray(example.examples) ? example.examples : [example];

    assert.ok(examples.length > 0, `${packageInfo.manifest.name} must provide an example`);
    for (const [index, item] of examples.entries()) {
      assert.ok(item && typeof item === 'object' && !Array.isArray(item));
      if ('options' in item) {
        assert.ok(
          item.options && typeof item.options === 'object' && !Array.isArray(item.options),
          `${packageInfo.manifest.name} example ${index} options must be an object`
        );
      }
      if ('context' in item) {
        assert.ok(
          item.context && typeof item.context === 'object' && !Array.isArray(item.context),
          `${packageInfo.manifest.name} example ${index} context must be an object`
        );
      }
    }
  }
});
```

- [ ] **Step 2: Remove the obsolete narrow metadata test**

Delete `tests/package-metadata.test.js`; its publish-artifact assertion is
superseded by the complete metadata and archive tests.

- [ ] **Step 3: Update the explicit metadata script**

Change `package.json` scripts to:

```json
{
  "scripts": {
    "test": "node --test tests/*.test.js",
    "test:external-fixtures": "node --test tests/external-fixtures.test.js",
    "test:metadata": "node --test tests/catalog-integrity.test.js",
    "test:archives": "node --test tests/package-archives.test.js"
  }
}
```

- [ ] **Step 4: Run the catalog test and verify it exposes the stale catalog**

Run:

```bash
npm run test:metadata
```

Expected: FAIL because `PACKAGES.md` declares 48 packages and omits
`@maitask/intelligence-briefing`.

- [ ] **Step 5: Commit the failing test**

```bash
git add package.json tests/catalog-integrity.test.js tests/package-metadata.test.js
git commit -m "Expand official package metadata verification"
```

### Task 3: Reconcile the documented catalog with the repository

**Files:**
- Modify: `PACKAGES.md`

- [ ] **Step 1: Correct the catalog count and AI category count**

Change the catalog header to:

```markdown
> Total packages: **49** · Maintained by official account **`maitask`** · Versions follow each package manifest
```

Change the AI section heading to:

```markdown
## AI & Cognitive Services (11)
```

- [ ] **Step 2: Add the missing official package entry**

Add this entry after `@maitask/document-qa`:

```markdown
- [**@maitask/intelligence-briefing**](./intelligence-briefing) `v0.1.0` — Generate source-backed intelligence briefings with configurable AI analysis and delivery-ready output
```

- [ ] **Step 3: Run metadata verification**

Run:

```bash
npm run test:metadata
```

Expected: all four catalog integrity tests pass.

- [ ] **Step 4: Commit the catalog correction**

```bash
git add PACKAGES.md
git commit -m "Reconcile the official package catalog"
```

### Task 4: Add package archive regression for the complete catalog

**Files:**
- Create: `tests/package-archives.test.js`

- [ ] **Step 1: Write the archive test**

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const { discoverPackages, inspectPackageArchive } = require('./helpers/package-catalog');

const FORBIDDEN_ARCHIVE_PATH = /(^|\/)(?:node_modules|coverage|test-results|\.DS_Store)(?:\/|$)/;

test('every official package produces a clean publish archive', { timeout: 120000 }, () => {
  for (const packageInfo of discoverPackages()) {
    const archive = inspectPackageArchive(packageInfo);
    const paths = archive.files.map(file => file.path);
    const required = [
      'package.json',
      'README.md',
      'example.json',
      packageInfo.manifest.main,
      ...(packageInfo.manifest.types ? [packageInfo.manifest.types] : [])
    ];

    for (const requiredPath of required) {
      assert.ok(paths.includes(requiredPath), `${packageInfo.manifest.name} omits ${requiredPath}`);
    }

    for (const archivePath of paths) {
      assert.doesNotMatch(
        archivePath,
        FORBIDDEN_ARCHIVE_PATH,
        `${packageInfo.manifest.name} publishes ${archivePath}`
      );
    }

    assert.equal(archive.name, packageInfo.manifest.name);
    assert.equal(archive.version, packageInfo.manifest.version);
    assert.ok(archive.size > 0, `${packageInfo.manifest.name} archive must not be empty`);
    assert.ok(archive.unpackedSize > 0, `${packageInfo.manifest.name} archive must contain files`);
  }
});
```

- [ ] **Step 2: Run archive verification**

Run:

```bash
npm run test:archives
```

Expected: one test passes after inspecting all 49 package archives.

- [ ] **Step 3: Commit the archive regression**

```bash
git add tests/package-archives.test.js
git commit -m "Verify official package publish archives"
```

### Task 5: Run the complete package quality gate

**Files:**
- Modify only if verification exposes a concrete defect in files already listed above.

- [ ] **Step 1: Run the complete test suite**

Run:

```bash
npm test
```

Expected: external fixture, catalog integrity, and archive tests all pass with
no skipped or todo tests.

- [ ] **Step 2: Check formatting and repository cleanliness**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional plan or implementation files
remain uncommitted.

- [ ] **Step 3: Commit the implementation plan**

```bash
git add docs/superpowers/plans/2026-07-10-package-catalog-integrity.md
git commit -m "Document package catalog integrity implementation"
```

- [ ] **Step 4: Record the next domain boundary**

The next implementation plan starts from the verified 49-package catalog and
adds deterministic behavior tests for each external-dependency family. It must
not weaken the archive or catalog checks added here.
