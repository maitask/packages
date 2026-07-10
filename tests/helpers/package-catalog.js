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
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packageInfo.directory,
    encoding: 'utf8'
  });

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
