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
