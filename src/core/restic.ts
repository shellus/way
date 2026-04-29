import { execa } from 'execa'
import { resolveResticBin } from './restic-bin'
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
  try {
    await execa(resolveResticBin(), [...s3Options, ...args], { env: { ...process.env, ...env }, stdio: 'inherit' })
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.error('Error: restic not found. Linux x64 packages include restic; other platforms must install it first.')
      console.error('Set WAY_RESTIC_BIN to use a custom restic binary, or visit: https://restic.net/')
      process.exit(1)
    }
    throw error
  }
}
