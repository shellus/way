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
