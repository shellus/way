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
