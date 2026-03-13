# TypeScript Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 way 从 Bash 迁移到 TypeScript，保持 100% 功能兼容，添加完整测试覆盖

**Architecture:** 使用 Commander.js 处理 CLI，模块化设计（config/restic/commands），通过 execa 调用 restic，js-yaml 替代 yq

**Tech Stack:** TypeScript, Commander.js, execa, js-yaml, vitest, tsup

---

## Task 1: 项目初始化

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore` (追加 TypeScript 相关)

**Step 1: 初始化 package.json**

```bash
npm init -y
```

**Step 2: 安装依赖**

```bash
npm install commander execa js-yaml dotenv
npm install -D typescript @types/node vitest tsup @types/js-yaml
```

**Step 3: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 4: 创建 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
})
```

**Step 5: 更新 package.json scripts**

```json
{
  "name": "@shellus/way",
  "version": "0.3.0",
  "type": "module",
  "bin": {
    "way": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsup src/cli.ts --format esm --clean",
    "dev": "tsup src/cli.ts --format esm --watch",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "files": ["dist"]
}
```

**Step 6: 更新 .gitignore**

```bash
echo "node_modules/" >> .gitignore
echo "dist/" >> .gitignore
```

**Step 7: 提交**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore
git commit -m "feat: 初始化 TypeScript 项目结构"
```

---

## Task 2: 类型定义

**Files:**
- Create: `src/types.ts`

**Step 1: 创建类型定义文件**

```typescript
export interface Repository {
  type: 'local' | 's3' | 'sftp'
  path?: string
  endpoint?: string
  bucket?: string
  host?: string
  options?: {
    bucket_lookup?: string
  }
  credentials: {
    password?: string
    access_key_id?: string
    secret_access_key?: string
  }
}

export interface RepositoriesConfig {
  default: string
  repositories: Record<string, Repository>
}

export interface Project {
  description?: string
  paths: string[]
  excludes?: string[]
}

export interface RulesConfig {
  uptime_kuma?: {
    push_url?: string
  }
  schedule?: {
    backup?: string[]
    prune?: string
    check?: string
  }
  retention?: {
    keep_daily?: number
    keep_weekly?: number
    keep_monthly?: number
  }
  projects: Record<string, Project>
  global_excludes?: string[]
}

export interface RunResult {
  succeeded: string[]
  failed: string[]
  duration: number
}
```

**Step 2: 提交**

```bash
git add src/types.ts
git commit -m "feat: 添加 TypeScript 类型定义"
```

---

## Task 3: 环境变量展开模块

**Files:**
- Create: `src/core/env.ts`
- Create: `tests/core/env.test.ts`

**Step 1: 编写测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { expandEnv } from '../../src/core/env'

describe('expandEnv', () => {
  beforeEach(() => {
    process.env.TEST_VAR = 'test-value'
  })

  it('展开 ${VAR} 语法', () => {
    expect(expandEnv('${TEST_VAR}')).toBe('test-value')
  })

  it('不展开普通字符串', () => {
    expect(expandEnv('plain-text')).toBe('plain-text')
  })

  it('变量不存在返回空字符串', () => {
    expect(expandEnv('${NON_EXIST}')).toBe('')
  })

  it('处理 null 和 undefined', () => {
    expect(expandEnv(null as any)).toBe('')
    expect(expandEnv(undefined as any)).toBe('')
  })
})
```

**Step 2: 运行测试确认失败**

```bash
npm test -- tests/core/env.test.ts
```

Expected: FAIL - expandEnv not defined

**Step 3: 实现功能**

```typescript
export function expandEnv(value: string | null | undefined): string {
  if (!value) return ''

  const match = value.match(/^\$\{(.+)\}$/)
  if (match) {
    return process.env[match[1]] || ''
  }

  return value
}
```

**Step 4: 运行测试确认通过**

```bash
npm test -- tests/core/env.test.ts
```

Expected: PASS

**Step 5: 提交**

```bash
git add src/core/env.ts tests/core/env.test.ts
git commit -m "feat: 实现环境变量展开功能"
```

---


## Task 4: 配置加载模块

**Files:**
- Create: `src/core/config.ts`
- Create: `tests/core/config.test.ts`
- Create: `tests/fixtures/repositories.yaml`
- Create: `tests/fixtures/rules.yaml`
- Create: `tests/fixtures/.env`

**Step 1: 创建测试 fixtures**

tests/fixtures/repositories.yaml:
```yaml
default: local
repositories:
  local:
    type: local
    path: /tmp/test-repo
    credentials:
      password: ${RESTIC_PASSWORD}
```

tests/fixtures/rules.yaml:
```yaml
projects:
  test:
    paths:
      - /tmp/test-data
    excludes:
      - cache
global_excludes:
  - node_modules
retention:
  keep_daily: 7
```

tests/fixtures/.env:
```
RESTIC_PASSWORD=test123
```

**Step 2: 编写测试**

```typescript
import { describe, it, expect } from 'vitest'
import { loadConfig } from '../../src/core/config'
import path from 'path'

describe('loadConfig', () => {
  const fixturesDir = path.join(__dirname, '../fixtures')

  it('加载配置文件', () => {
    const config = loadConfig(fixturesDir, 'local')
    expect(config.repository.type).toBe('local')
    expect(config.repository.credentials.password).toBe('test123')
  })
})
```

**Step 3: 运行测试确认失败**

```bash
npm test -- tests/core/config.test.ts
```

**Step 4: 实现功能**

```typescript
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import dotenv from 'dotenv'
import { expandEnv } from './env'
import type { RepositoriesConfig, RulesConfig, Repository } from '../types'

export interface Config {
  repository: Repository
  rules: RulesConfig
}

export function loadConfig(wayDir: string, remoteName: string): Config {
  const envPath = path.join(wayDir, '.env')
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath })
  }

  const repoFile = path.join(wayDir, 'repositories.yaml')
  const repoConfig = yaml.load(fs.readFileSync(repoFile, 'utf8')) as RepositoriesConfig

  const repoName = remoteName === 'default' ? repoConfig.default : remoteName
  const repository = repoConfig.repositories[repoName]
  if (!repository) throw new Error(`Repository not found: ${repoName}`)

  if (repository.credentials.password) {
    repository.credentials.password = expandEnv(repository.credentials.password)
  }
  if (repository.credentials.access_key_id) {
    repository.credentials.access_key_id = expandEnv(repository.credentials.access_key_id)
  }
  if (repository.credentials.secret_access_key) {
    repository.credentials.secret_access_key = expandEnv(repository.credentials.secret_access_key)
  }

  const rulesFile = path.join(wayDir, 'rules.yaml')
  const rules = yaml.load(fs.readFileSync(rulesFile, 'utf8')) as RulesConfig

  if (rules.uptime_kuma?.push_url) {
    rules.uptime_kuma.push_url = expandEnv(rules.uptime_kuma.push_url)
  }

  return { repository, rules }
}
```

**Step 5: 运行测试确认通过**

```bash
npm test -- tests/core/config.test.ts
```

**Step 6: 提交**

```bash
git add src/core/config.ts tests/core/config.test.ts tests/fixtures/
git commit -m "feat: 实现配置加载模块"
```

---

## Task 5: Restic 调用封装

**Files:**
- Create: `src/core/restic.ts`
- Create: `tests/core/restic.test.ts`

**Step 1: 编写测试**

```typescript
import { describe, it, expect } from 'vitest'
import { buildResticEnv, buildBackupArgs } from '../../src/core/restic'
import type { Repository, Project } from '../../src/types'

describe('buildResticEnv', () => {
  it('构建 S3 环境变量', () => {
    const repo: Repository = {
      type: 's3',
      endpoint: 's3.example.com',
      bucket: 'my-bucket',
      credentials: { password: 'pass123', access_key_id: 'key', secret_access_key: 'secret' },
    }
    const env = buildResticEnv(repo)
    expect(env.RESTIC_REPOSITORY).toBe('s3:https://s3.example.com/my-bucket')
    expect(env.RESTIC_PASSWORD).toBe('pass123')
  })
})

describe('buildBackupArgs', () => {
  it('构建备份参数', () => {
    const project: Project = { paths: ['/data'], excludes: ['cache'] }
    const args = buildBackupArgs('test', project, ['node_modules'])
    expect(args).toContain('backup')
    expect(args).toContain('--tag=way:test')
    expect(args).toContain('--exclude=cache')
  })
})
```

**Step 2: 运行测试确认失败**

```bash
npm test -- tests/core/restic.test.ts
```

**Step 3: 实现功能**

```typescript
import { execa } from 'execa'
import type { Repository, Project } from '../types'

export function buildResticEnv(repo: Repository): Record<string, string> {
  const env: Record<string, string> = {}

  switch (repo.type) {
    case 's3':
      env.RESTIC_REPOSITORY = `s3:https://${repo.endpoint}/${repo.bucket}`
      break
    case 'local':
      env.RESTIC_REPOSITORY = repo.path!
      break
    case 'sftp':
      env.RESTIC_REPOSITORY = `sftp:${repo.host}:${repo.path}`
      break
  }

  if (repo.credentials.password) env.RESTIC_PASSWORD = repo.credentials.password
  if (repo.credentials.access_key_id) env.AWS_ACCESS_KEY_ID = repo.credentials.access_key_id
  if (repo.credentials.secret_access_key) env.AWS_SECRET_ACCESS_KEY = repo.credentials.secret_access_key

  return env
}

export function buildBackupArgs(name: string, project: Project, globalExcludes: string[]): string[] {
  const args = ['backup', `--tag=way:${name}`]
  const allExcludes = [...globalExcludes, ...(project.excludes || [])]
  for (const exclude of allExcludes) args.push(`--exclude=${exclude}`)
  args.push(...project.paths)
  return args
}

export function buildS3Options(repo: Repository): string[] {
  const options: string[] = []
  if (repo.options?.bucket_lookup) {
    options.push('-o', `s3.bucket-lookup=${repo.options.bucket_lookup}`)
  }
  return options
}

export async function execRestic(args: string[], env: Record<string, string>, s3Options: string[] = []): Promise<void> {
  await execa('restic', [...s3Options, ...args], { env: { ...process.env, ...env }, stdio: 'inherit' })
}
```

**Step 4: 运行测试确认通过**

```bash
npm test -- tests/core/restic.test.ts
```

**Step 5: 提交**

```bash
git add src/core/restic.ts tests/core/restic.test.ts
git commit -m "feat: 实现 restic 调用封装"
```

---

## Task 6: Run 命令实现

**Files:**
- Create: `src/commands/run.ts`
- Create: `tests/commands/run.test.ts`

**Step 1: 编写测试**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('run command E2E', () => {
  const testDir = path.join(os.tmpdir(), 'way-test-' + Date.now())
  const repoPath = path.join(testDir, 'repo')
  const dataPath = path.join(testDir, 'data')

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true })
    fs.mkdirSync(dataPath, { recursive: true })
    fs.writeFileSync(path.join(dataPath, 'test.txt'), 'test content')

    fs.writeFileSync(path.join(testDir, '.env'), 'RESTIC_PASSWORD=test123')
    fs.writeFileSync(path.join(testDir, 'repositories.yaml'), `
default: local
repositories:
  local:
    type: local
    path: ${repoPath}
    credentials:
      password: \${RESTIC_PASSWORD}
`)
    fs.writeFileSync(path.join(testDir, 'rules.yaml'), `
projects:
  test:
    paths:
      - ${dataPath}
global_excludes: []
`)

    execSync(`restic init --repo ${repoPath} --password-file <(echo test123)`, { shell: '/bin/bash' })
  })

  it('执行备份', async () => {
    process.env.WAY_DIR = testDir
    const { run } = await import('../../src/commands/run')
    const result = await run({ remote: 'default' })
    expect(result.succeeded).toContain('test')
    expect(result.failed).toHaveLength(0)
  })
})
```

**Step 2: 运行测试确认失败**

```bash
npm test -- tests/commands/run.test.ts
```

**Step 3: 实现功能**

```typescript
import { loadConfig } from '../core/config'
import { buildResticEnv, buildBackupArgs, buildS3Options, execRestic } from '../core/restic'
import type { RunResult } from '../types'

export interface RunOptions {
  remote: string
  project?: string
  extraArgs?: string[]
}

export async function run(options: RunOptions): Promise<RunResult> {
  const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
  const config = loadConfig(wayDir, options.remote)

  const env = buildResticEnv(config.repository)
  const s3Options = buildS3Options(config.repository)
  const globalExcludes = config.rules.global_excludes || []

  const projects = options.project
    ? [options.project]
    : Object.keys(config.rules.projects)

  const succeeded: string[] = []
  const failed: string[] = []
  const startTime = Date.now()

  for (const projectName of projects) {
    const project = config.rules.projects[projectName]
    if (!project) {
      console.error(`Project not found: ${projectName}`)
      failed.push(projectName)
      continue
    }

    console.log(`=== Backing up: ${projectName} ===`)

    try {
      const args = buildBackupArgs(projectName, project, globalExcludes)
      if (options.extraArgs) args.push(...options.extraArgs)
      await execRestic(args, env, s3Options)
      succeeded.push(projectName)
    } catch (error) {
      console.error(`Failed to backup ${projectName}:`, error)
      failed.push(projectName)
    }
  }

  const duration = Date.now() - startTime

  console.log('\n=== Summary ===')
  if (succeeded.length > 0) console.log('Succeeded:', succeeded.join(', '))
  if (failed.length > 0) console.log('Failed:', failed.join(', '))

  if (config.rules.uptime_kuma?.push_url) {
    await notifyUptimeKuma({ succeeded, failed, duration }, config.rules.uptime_kuma.push_url)
  }

  return { succeeded, failed, duration }
}

async function notifyUptimeKuma(result: RunResult, pushUrl: string): Promise<void> {
  const status = result.failed.length > 0 ? 'down' : 'up'
  const msg = `Succeeded: ${result.succeeded.length}, Failed: ${result.failed.length}`
  const url = `${pushUrl}?status=${status}&msg=${encodeURIComponent(msg)}&ping=${result.duration}`

  try {
    const response = await fetch(url)
    if (response.ok) {
      console.log(`Uptime Kuma notified: status=${status}, ping=${result.duration}ms`)
    } else {
      console.error('Uptime Kuma notification failed')
    }
  } catch (error) {
    console.error('Uptime Kuma notification failed:', error)
  }
}
```

**Step 4: 运行测试确认通过**

```bash
npm test -- tests/commands/run.test.ts
```

**Step 5: 提交**

```bash
git add src/commands/run.ts tests/commands/run.test.ts
git commit -m "feat: 实现 run 命令"
```

---

## Task 7: GC 命令实现

**Files:**
- Create: `src/commands/gc.ts`

**Step 1: 实现功能**

```typescript
import { loadConfig } from '../core/config'
import { buildResticEnv, buildS3Options, execRestic } from '../core/restic'

export interface GcOptions {
  remote: string
  extraArgs?: string[]
}

export async function gc(options: GcOptions): Promise<void> {
  const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
  const config = loadConfig(wayDir, options.remote)

  const keepDaily = config.rules.retention?.keep_daily || 7
  const keepWeekly = config.rules.retention?.keep_weekly || 4
  const keepMonthly = config.rules.retention?.keep_monthly || 6

  console.log('=== Cleaning snapshots ===')
  console.log(`Policy: daily=${keepDaily}, weekly=${keepWeekly}, monthly=${keepMonthly}`)

  const env = buildResticEnv(config.repository)
  const s3Options = buildS3Options(config.repository)

  const args = [
    'forget',
    '--prune',
    `--keep-daily=${keepDaily}`,
    `--keep-weekly=${keepWeekly}`,
    `--keep-monthly=${keepMonthly}`,
  ]

  if (options.extraArgs) args.push(...options.extraArgs)

  await execRestic(args, env, s3Options)
}
```

**Step 2: 提交**

```bash
git add src/commands/gc.ts
git commit -m "feat: 实现 gc 命令"
```

---

## Task 8: Cron 命令实现

**Files:**
- Create: `src/commands/cron.ts`

**Step 1: 实现功能**

```typescript
import { loadConfig } from '../core/config'
import { execSync } from 'child_process'
import fs from 'fs'

export interface CronOptions {
  remote: string
  action: 'show' | 'install'
}

export async function cron(options: CronOptions): Promise<void> {
  const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
  const config = loadConfig(wayDir, options.remote)

  const markerStart = '# === way backup schedule ==='
  const markerEnd = '# === way backup schedule end ==='

  const generateCron = (): string => {
    const lines = [markerStart]

    const backupSchedules = config.rules.schedule?.backup || []
    for (const schedule of backupSchedules) {
      lines.push(`${schedule} /usr/local/bin/way run`)
    }

    if (config.rules.schedule?.prune) {
      lines.push(`${config.rules.schedule.prune} /usr/local/bin/way gc`)
    }

    if (config.rules.schedule?.check) {
      lines.push(`${config.rules.schedule.check} /usr/local/bin/way check`)
    }

    lines.push(markerEnd)
    return lines.join('\n')
  }

  if (options.action === 'show') {
    console.log(generateCron())
    return
  }

  if (options.action === 'install') {
    if (!fs.existsSync('/usr/local/bin/way')) {
      throw new Error('Error: /usr/local/bin/way not found')
    }

    let existing = ''
    try {
      existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' })
    } catch {}

    const filtered = existing.split('\n').filter(line => {
      return !line.includes(markerStart) && !line.includes(markerEnd)
    }).join('\n')

    const newCrontab = filtered + '\n' + generateCron()
    execSync('crontab -', { input: newCrontab })

    console.log('Crontab installed successfully')
    execSync('crontab -l | grep -A100 "' + markerStart + '" | head -20', { stdio: 'inherit', shell: '/bin/bash' })
  }
}
```

**Step 2: 提交**

```bash
git add src/commands/cron.ts
git commit -m "feat: 实现 cron 命令"
```

---

## Task 9: CLI 入口实现

**Files:**
- Create: `src/cli.ts`

**Step 1: 实现功能**

```typescript
#!/usr/bin/env node
import { Command } from 'commander'
import { run } from './commands/run'
import { gc } from './commands/gc'
import { cron } from './commands/cron'
import { execRestic, buildResticEnv, buildS3Options } from './core/restic'
import { loadConfig } from './core/config'

const program = new Command()

program
  .name('way')
  .version('0.3.0')
  .description('策略备份工具')
  .option('--remote <name>', '指定仓库', 'default')

program
  .command('run [project]')
  .description('执行备份')
  .action(async (project, options, command) => {
    const remote = command.parent.opts().remote
    const extraArgs = command.args.slice(1)
    await run({ remote, project, extraArgs })
  })

program
  .command('gc')
  .description('清理旧快照')
  .allowUnknownOption()
  .action(async (options, command) => {
    const remote = command.parent.opts().remote
    const extraArgs = command.args
    await gc({ remote, extraArgs })
  })

program
  .command('cron <action>')
  .description('管理定时任务 (show|install)')
  .action(async (action, options, command) => {
    const remote = command.parent.opts().remote
    await cron({ remote, action: action as 'show' | 'install' })
  })

program
  .command('env')
  .description('显示环境变量')
  .action(() => {
    const env = Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b))
    for (const [key, value] of env) {
      console.log(`${key}=${value}`)
    }
  })

program
  .command('*', { isDefault: true })
  .description('透传给 restic')
  .allowUnknownOption()
  .action(async (command, options, cmd) => {
    const remote = cmd.parent.opts().remote
    const wayDir = process.env.WAY_DIR || `${process.env.HOME}/.way`
    const config = loadConfig(wayDir, remote)
    const env = buildResticEnv(config.repository)
    const s3Options = buildS3Options(config.repository)
    await execRestic(cmd.args, env, s3Options)
  })

program.parse()
```

**Step 2: 提交**

```bash
git add src/cli.ts
git commit -m "feat: 实现 CLI 入口"
```

---

## Task 10: 构建配置

**Files:**
- Create: `tsup.config.ts`

**Step 1: 创建 tsup 配置**

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  clean: true,
  shims: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
})
```

**Step 2: 测试构建**

```bash
npm run build
node dist/cli.js --version
```

Expected: 输出 "0.3.0"

**Step 3: 提交**

```bash
git add tsup.config.ts
git commit -m "feat: 添加构建配置"
```

---

## Task 11: E2E 完整测试

**Files:**
- Create: `tests/e2e/full.test.ts`

**Step 1: 编写完整 E2E 测试**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('way E2E', () => {
  const testDir = path.join(os.tmpdir(), 'way-e2e-' + Date.now())
  const repoPath = path.join(testDir, 'repo')
  const dataPath = path.join(testDir, 'data')
  const wayBin = path.join(process.cwd(), 'dist/cli.js')

  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' })

    fs.mkdirSync(testDir, { recursive: true })
    fs.mkdirSync(dataPath, { recursive: true })
    fs.writeFileSync(path.join(dataPath, 'file1.txt'), 'content1')
    fs.writeFileSync(path.join(dataPath, 'file2.txt'), 'content2')

    fs.writeFileSync(path.join(testDir, '.env'), 'RESTIC_PASSWORD=test123')
    fs.writeFileSync(path.join(testDir, 'repositories.yaml'), `
default: local
repositories:
  local:
    type: local
    path: ${repoPath}
    credentials:
      password: \${RESTIC_PASSWORD}
`)
    fs.writeFileSync(path.join(testDir, 'rules.yaml'), `
projects:
  data:
    paths:
      - ${dataPath}
    excludes:
      - "*.log"
global_excludes:
  - node_modules
retention:
  keep_daily: 7
  keep_weekly: 4
  keep_monthly: 6
`)

    execSync(`restic init --repo ${repoPath} --password-file <(echo test123)`, { shell: '/bin/bash' })
  })

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it('way --version', () => {
    const output = execSync(`${wayBin} --version`, { encoding: 'utf8' })
    expect(output.trim()).toBe('0.3.0')
  })

  it('way run 执行备份', () => {
    execSync(`WAY_DIR=${testDir} ${wayBin} run`, { stdio: 'inherit' })
    const snapshots = execSync(`WAY_DIR=${testDir} ${wayBin} snapshots --json`, { encoding: 'utf8' })
    expect(snapshots).toContain('way:data')
  })

  it('way snapshots 查看快照', () => {
    const output = execSync(`WAY_DIR=${testDir} ${wayBin} snapshots`, { encoding: 'utf8' })
    expect(output).toContain('way:data')
  })

  it('way gc 清理快照', () => {
    execSync(`WAY_DIR=${testDir} ${wayBin} gc --dry-run`, { stdio: 'inherit' })
  })

  it('way cron show 显示定时任务', () => {
    const output = execSync(`WAY_DIR=${testDir} ${wayBin} cron show`, { encoding: 'utf8' })
    expect(output).toContain('way backup schedule')
  })
})
```

**Step 2: 运行测试**

```bash
npm test -- tests/e2e/full.test.ts
```

Expected: 全部通过

**Step 3: 提交**

```bash
git add tests/e2e/full.test.ts
git commit -m "test: 添加 E2E 完整测试"
```

---

## Task 12: 更新文档

**Files:**
- Modify: `README.md`
- Create: `MIGRATION.md`

**Step 1: 更新 README.md 安装说明**

在 "快速开始" 部分添加 npm 安装方式：

```markdown
## 快速开始

### 方式 1: npm 安装（推荐）

```bash
npm install -g @shellus/way

# 初始化配置
mkdir -p ~/.way
cp $(npm root -g)/@shellus/way/repositories.yaml.example ~/.way/repositories.yaml
cp $(npm root -g)/@shellus/way/rules.yaml.example ~/.way/rules.yaml
```

### 方式 2: 脚本安装

```bash
curl -fsSL https://github.com/shellus/way/releases/latest/download/install.sh | bash
```
```

**Step 2: 创建迁移指南**

```markdown
# 从 Bash 版本迁移到 TypeScript 版本

## 兼容性

TypeScript 版本 (v0.3.0+) 与 Bash 版本 (v0.2.0) 完全兼容：

- 配置文件格式不变（repositories.yaml, rules.yaml, .env）
- 命令行接口不变
- 所有功能保持一致

## 迁移步骤

### 1. 卸载旧版本

```bash
rm /usr/local/bin/way
```

### 2. 安装新版本

```bash
npm install -g @shellus/way
```

### 3. 验证

```bash
way --version  # 应显示 0.3.0
way snapshots  # 应正常工作
```

配置文件无需修改，直接使用。

## 回滚

如需回滚到 Bash 版本：

```bash
npm uninstall -g @shellus/way
curl -fsSL https://github.com/shellus/way/releases/download/v0.2.0/install.sh | bash
```
```

**Step 3: 提交**

```bash
git add README.md MIGRATION.md
git commit -m "docs: 更新文档，添加迁移指南"
```

---

## Task 13: 发布准备

**Files:**
- Modify: `package.json`
- Create: `.npmignore`

**Step 1: 完善 package.json**

```json
{
  "name": "@shellus/way",
  "version": "0.3.0",
  "description": "策略备份工具 - 基于 restic 的备份管理",
  "type": "module",
  "bin": {
    "way": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsup src/cli.ts --format esm --clean",
    "dev": "tsup src/cli.ts --format esm --watch",
    "test": "vitest",
    "test:run": "vitest run",
    "prepublishOnly": "npm run test:run && npm run build"
  },
  "files": [
    "dist",
    "repositories.yaml.example",
    "rules.yaml.example"
  ],
  "keywords": ["backup", "restic", "snapshot", "cron"],
  "author": "shellus",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/shellus/way.git"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "peerDependencies": {
    "restic": "*"
  }
}
```

**Step 2: 创建 .npmignore**

```
src/
tests/
docs/
*.sh
tsconfig.json
vitest.config.ts
tsup.config.ts
.gitignore
```

**Step 3: 测试打包**

```bash
npm pack
tar -tzf shellus-way-0.3.0.tgz
```

验证包含：dist/, repositories.yaml.example, rules.yaml.example

**Step 4: 提交**

```bash
git add package.json .npmignore
git commit -m "chore: 准备 npm 发布"
```

---

## Task 14: 最终验证

**Step 1: 运行所有测试**

```bash
npm test:run
```

Expected: 全部通过

**Step 2: 本地安装测试**

```bash
npm pack
npm install -g ./shellus-way-0.3.0.tgz
way --version
way snapshots
```

**Step 3: 清理测试安装**

```bash
npm uninstall -g @shellus/way
rm shellus-way-0.3.0.tgz
```

**Step 4: 标记完成**

```bash
git tag v0.3.0
git push origin master --tags
```

---

## 发布清单

完成所有任务后：

1. ✅ 所有测试通过
2. ✅ 文档已更新
3. ✅ 本地验证成功
4. ✅ Git 已打 tag

发布到 npm：

```bash
npm publish --access public
```

验证发布：

```bash
npm install -g @shellus/way
way --version
```
