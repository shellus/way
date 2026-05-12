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
  schedule?: string | false
  retention?: Retention
  excludes?: string[]
}

export interface RulesConfig {
  defaults?: {
    schedule?: string | false
    retention?: Retention
  }
  uptime_kuma?: {
    push_url?: string
  }
  maintenance?: {
    prune?: {
      schedule?: string | false
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
