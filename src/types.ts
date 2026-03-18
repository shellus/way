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
}

export interface Project {
  description?: string
  paths: string[]
  schedule?: string
  retention?: Retention
  excludes?: string[]
}

export interface RulesConfig {
  defaults?: {
    schedule?: string
    retention?: Retention
  }
  uptime_kuma?: {
    push_url?: string
  }
  maintenance?: {
    prune?: {
      schedule?: string
    }
    check?: {
      schedule?: string
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
