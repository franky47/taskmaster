import os from 'node:os'
import path from 'node:path'

export const configDir = path.join(os.homedir(), '.config', 'taskmaster')
export const tasksDir = path.join(configDir, 'tasks')
export const historyDir = path.join(configDir, 'history')
export const runsDir = path.join(configDir, 'runs')
export const locksDir = path.join(configDir, 'locks')
export const logFilePath = path.join(configDir, 'log.jsonl')
export const envFilePath = path.join(configDir, '.env')

export function taskFilePath(name: string): string {
  return path.join(tasksDir, `${name}.md`)
}
