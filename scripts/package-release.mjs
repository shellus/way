import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const projectRoot = process.cwd()
const packageName = 'way-linux-x64'
const standaloneBin = path.join(projectRoot, 'dist/standalone/way')
const releaseDir = path.join(projectRoot, 'release')
const packageDir = path.join(releaseDir, packageName)

if (!existsSync(standaloneBin)) {
  throw new Error(`Standalone executable not found: ${standaloneBin}`)
}

rmSync(packageDir, { recursive: true, force: true })
mkdirSync(path.join(packageDir, 'bin'), { recursive: true })

cpSync(standaloneBin, path.join(packageDir, 'bin/way'))
chmodSync(path.join(packageDir, 'bin/way'), 0o755)
cpSync(
  path.join(projectRoot, 'vendor/restic/linux-x64'),
  path.join(packageDir, 'vendor/restic/linux-x64'),
  { recursive: true },
)
chmodSync(path.join(packageDir, 'vendor/restic/linux-x64/restic'), 0o755)
cpSync(path.join(projectRoot, 'repositories.yaml.example'), path.join(packageDir, 'repositories.yaml.example'))
cpSync(path.join(projectRoot, 'rules.yaml.example'), path.join(packageDir, 'rules.yaml.example'))
cpSync(path.join(projectRoot, 'scripts/install-release.sh'), path.join(packageDir, 'install.sh'))
chmodSync(path.join(packageDir, 'install.sh'), 0o755)

rmSync(path.join(releaseDir, `${packageName}.tar.gz`), { force: true })
execFileSync('tar', ['-czf', `${packageName}.tar.gz`, packageName], {
  cwd: releaseDir,
  stdio: 'inherit',
})

console.log(`Created ${path.join(releaseDir, `${packageName}.tar.gz`)}`)
