const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { discoverPackages, repositoryRoot } = require('./helpers/package-catalog');

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
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
    assert.ok(
      fs.existsSync(path.join(directory, 'example.json')),
      `${manifest.name} example is missing`
    );

    if (Array.isArray(manifest.files)) {
      assert.ok(manifest.files.includes('README.md'), `${manifest.name} must publish README.md`);
      assert.ok(
        manifest.files.includes('example.json'),
        `${manifest.name} must publish example.json`
      );
      assert.ok(
        manifest.files.includes(manifest.main),
        `${manifest.name} must publish its entry point`
      );
      if (manifest.types) {
        assert.ok(manifest.files.includes(manifest.types), `${manifest.name} must publish its types`);
      }
    }

    for (const locale of ['en', 'zh']) {
      const localized = manifest.maitask?.locales?.[locale];
      assert.ok(localized, `${manifest.name} must define maitask.locales.${locale}`);
      assertNonEmptyString(
        localized.display_name,
        `${manifest.name} ${locale} display_name is required`
      );
      assertNonEmptyString(
        localized.description,
        `${manifest.name} ${locale} description is required`
      );
      assertNonEmptyString(localized.category, `${manifest.name} ${locale} category is required`);
      assert.ok(
        Array.isArray(localized.keywords) && localized.keywords.length > 0,
        `${manifest.name} ${locale} keywords are required`
      );
      for (const keyword of localized.keywords) {
        assertNonEmptyString(keyword, `${manifest.name} ${locale} keyword must be a string`);
      }
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
