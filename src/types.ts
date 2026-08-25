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

export interface Retention {
  keep_daily?: number
  keep_weekly?: number
  keep_monthly?: number
  keep_yearly?: number
  keep_hosts?: string[]
  max_age_days?: number
}

export interface UptimeKumaConfig {
  push_url?: string
}

export interface Project {
  description?: string
  paths: string[]
  schedule?: string | false
  retention?: Retention
  excludes?: string[]
  include_dirs?: string[]
  hooks?: ProjectHooks
  uptime_kuma?: UptimeKumaConfig
}

export type ProjectHook = string | {
  run: string
  timeout?: string | number
}

export interface ProjectHooks {
  before_backup?: ProjectHook[]
  after_backup?: ProjectHook[]
}

export interface RulesConfig {
  defaults?: {
    schedule?: string | false
    retention?: Retention
  }
  uptime_kuma?: UptimeKumaConfig
  maintenance?: {
    prune?: {
      schedule?: string | false
      retry_lock?: string
    }
    check?: {
      schedule?: string | false
    }
  }
  projects: Record<string, Project>
  global_excludes?: string[]
}

export interface RunResult {
  succeeded: string[]
  failed: string[]
  duration: number
}
