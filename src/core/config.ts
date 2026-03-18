import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type { RepositoriesConfig, RulesConfig, Repository } from '../types'

export interface Config {
  repository: Repository
  rules: RulesConfig
}

export function loadConfig(wayDir: string, remoteName: string): Config {
  const repoFile = path.join(wayDir, 'repositories.yaml')
  const repoConfig = yaml.load(fs.readFileSync(repoFile, 'utf8')) as RepositoriesConfig

  const repoName = remoteName === 'default' ? repoConfig.default : remoteName
  const repository = repoConfig.repositories[repoName]
  if (!repository) throw new Error(`Repository not found: ${repoName}`)

  const rulesFile = path.join(wayDir, 'rules.yaml')
  const rules = yaml.load(fs.readFileSync(rulesFile, 'utf8')) as RulesConfig

  // 验证新格式配置
  if ('schedule' in rules && 'backup' in (rules.schedule || {})) {
    throw new Error('旧配置格式不再支持，请参考 rules.yaml.example 更新配置')
  }

  return { repository, rules }
}
