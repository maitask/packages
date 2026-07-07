const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function packageDirectories() {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(root, entry.name))
    .filter(directory => fs.existsSync(path.join(directory, 'package.json')))
    .sort();
}

test('package metadata points only to existing publish artifacts', () => {
  const failures = [];

  for (const directory of packageDirectories()) {
    const packageJsonPath = path.join(directory, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const relativeDirectory = path.relative(root, directory);

    const main = manifest.main || 'index.js';
    if (!fs.existsSync(path.join(directory, main))) {
      failures.push(`${relativeDirectory}: missing main ${main}`);
    }

    const types = manifest.types || manifest.typings;
    if (types && !fs.existsSync(path.join(directory, types))) {
      failures.push(`${relativeDirectory}: missing types ${types}`);
    }

    for (const file of manifest.files || []) {
      if (!fs.existsSync(path.join(directory, file))) {
        failures.push(`${relativeDirectory}: files includes missing ${file}`);
      }
    }

    if (!manifest.maitask?.locales?.en || !manifest.maitask?.locales?.zh) {
      failures.push(`${relativeDirectory}: missing maitask.locales.en or maitask.locales.zh`);
    }
  }

  assert.deepEqual(failures, []);
});
