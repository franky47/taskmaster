import os from 'node:os'
import path from 'node:path'

export function resolveConfigBase(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env['NODE_ENV'] === 'test' && env['TM_CONFIG_DIR']) {
    return env['TM_CONFIG_DIR']
  }
  return path.join(os.homedir(), '.config', 'taskmaster')
}

export const configDir = resolveConfigBase()
export const tasksDir = path.join(configDir, 'tasks')
export const historyDir = path.join(configDir, 'history')
export const runsDir = path.join(configDir, 'runs')
export const locksDir = path.join(configDir, 'locks')
export const logFilePath = path.join(configDir, 'log.jsonl')
export const envFilePath = path.join(configDir, '.env')
export const agentsFilePath = path.join(configDir, 'agents.yml')
