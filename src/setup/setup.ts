import fs from 'node:fs/promises'
import path from 'node:path'

// Types --

export type ExecResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type ExecFn = (
  cmd: string,
  args: string[],
  stdin?: string,
) => Promise<ExecResult>

type SchedulerOptions = {
  platform?: 'darwin' | 'linux'
  tmCommand?: string[]
  launchAgentsDir?: string
  exec?: ExecFn
}

type SetupResult = {
  method: 'launchd' | 'crontab'
  installed: boolean
}

type TeardownResult = {
  method: 'launchd' | 'crontab'
  removed: boolean
}

// Constants --

const PLIST_LABEL = 'com.47ng.taskmaster.tick'
const PLIST_FILENAME = `${PLIST_LABEL}.plist`

// Helpers --

function defaultLaunchAgentsDir(): string {
  return path.join(process.env.HOME ?? '~', 'Library', 'LaunchAgents')
}

function defaultTmCommand(): string[] {
  // Compiled SFE: argv = ['bun', '/$bunfs/root/tm', ...], execPath = real path
  // Dev mode:     argv = ['/path/to/bun', 'src/main.ts', ...], Bun.main = script
  // In both cases, process.execPath is the reliable absolute path to the runtime.
  if (/\.[jt]s$/.test(Bun.main)) {
    return [process.execPath, path.resolve(Bun.main)]
  }
  return [process.execPath]
}

async function defaultRunCommand(
  cmd: string,
  args: string[],
  stdin?: string,
): Promise<ExecResult> {
  const proc = Bun.spawn([cmd, ...args], {
    stdin: stdin !== undefined ? new Blob([stdin]) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { exitCode, stdout, stderr }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function shellQuote(s: string): string {
  if (/[^a-zA-Z0-9_./:=@-]/.test(s)) {
    return `'${s.replace(/'/g, "'\\''")}'`
  }
  return s
}

function generatePlist(tmCommand: string[]): string {
  const programArgs = [...tmCommand, 'tick']
    .map((arg) => `        <string>${escapeXml(arg)}</string>`)
    .join('\n')

  // launchd provides a minimal environment. Pass through variables that
  // child processes (like Claude CLI) need to locate config/auth state.
  const envVars: Record<string, string | undefined> = {
    HOME: process.env.HOME,
    USER: process.env.USER,
    PATH: process.env.PATH,
  }
  const envEntries = Object.entries(envVars)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(
      ([k, v]) =>
        `        <key>${escapeXml(k)}</key>\n        <string>${escapeXml(v)}</string>`,
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${programArgs}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
${envEntries}
    </dict>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Second</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/${PLIST_LABEL}.out.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/${PLIST_LABEL}.err.log</string>
    <key>AbandonProcessGroup</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
`
}

function crontabLine(tmCommand: string[]): string {
  return `* * * * * ${[...tmCommand, 'tick'].map(shellQuote).join(' ')}`
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

// -- macOS --

async function setupDarwin(
  tmCommand: string[],
  launchAgentsDir: string,
  run: ExecFn,
): Promise<SetupResult> {
  const plistPath = path.join(launchAgentsDir, PLIST_FILENAME)
  const expected = generatePlist(tmCommand)

  // Idempotency: skip if plist already has the right content
  if (await pathExists(plistPath)) {
    const existing = await fs.readFile(plistPath, 'utf-8')
    if (existing === expected) {
      return { method: 'launchd', installed: false }
    }
    // Content changed — unload old before rewriting
    await run('launchctl', ['unload', plistPath])
  }

  await fs.mkdir(launchAgentsDir, { recursive: true })
  await fs.writeFile(plistPath, expected)
  await run('launchctl', ['load', plistPath])

  return { method: 'launchd', installed: true }
}

async function teardownDarwin(
  launchAgentsDir: string,
  run: ExecFn,
): Promise<TeardownResult> {
  const plistPath = path.join(launchAgentsDir, PLIST_FILENAME)

  if (!(await pathExists(plistPath))) {
    return { method: 'launchd', removed: false }
  }

  await run('launchctl', ['unload', plistPath])
  await fs.rm(plistPath)

  return { method: 'launchd', removed: true }
}

// -- Linux --

async function readCrontab(run: ExecFn): Promise<string> {
  const result = await run('crontab', ['-l'])
  // crontab -l exits 1 when there's no crontab
  if (result.exitCode !== 0) return ''
  return result.stdout
}

async function setupLinux(
  tmCommand: string[],
  run: ExecFn,
): Promise<SetupResult> {
  const existing = await readCrontab(run)
  const entry = crontabLine(tmCommand)

  // Idempotency: exact line match (not substring) to avoid false positives
  const lines = existing.split('\n')
  if (lines.some((line) => line === entry)) {
    return { method: 'crontab', installed: false }
  }

  const newCrontab =
    existing.endsWith('\n') || existing === ''
      ? `${existing}${entry}\n`
      : `${existing}\n${entry}\n`

  await run('crontab', ['-'], newCrontab)

  return { method: 'crontab', installed: true }
}

async function teardownLinux(
  tmCommand: string[],
  run: ExecFn,
): Promise<TeardownResult> {
  const existing = await readCrontab(run)
  if (existing === '') {
    return { method: 'crontab', removed: false }
  }

  const entry = crontabLine(tmCommand)
  const lines = existing.split('\n')
  const filtered = lines.filter((line) => line !== entry)

  if (filtered.length === lines.length) {
    // Our entry was not in the crontab
    return { method: 'crontab', removed: false }
  }

  const newCrontab = filtered.join('\n')
  await run('crontab', ['-'], newCrontab)

  return { method: 'crontab', removed: true }
}

// Public API --

export async function setup(
  options?: SchedulerOptions,
): Promise<Error | SetupResult> {
  const platform = options?.platform ?? process.platform
  const tmCommand = options?.tmCommand ?? defaultTmCommand()
  const run = options?.exec ?? defaultRunCommand

  if (platform === 'darwin') {
    const launchAgentsDir = options?.launchAgentsDir ?? defaultLaunchAgentsDir()
    return setupDarwin(tmCommand, launchAgentsDir, run)
  }

  if (platform === 'linux') {
    return setupLinux(tmCommand, run)
  }

  return new Error(`Unsupported platform: ${platform}`)
}

export async function teardown(
  options?: SchedulerOptions,
): Promise<Error | TeardownResult> {
  const platform = options?.platform ?? process.platform
  const run = options?.exec ?? defaultRunCommand

  if (platform === 'darwin') {
    const launchAgentsDir = options?.launchAgentsDir ?? defaultLaunchAgentsDir()
    return teardownDarwin(launchAgentsDir, run)
  }

  if (platform === 'linux') {
    const tmCommand = options?.tmCommand ?? defaultTmCommand()
    return teardownLinux(tmCommand, run)
  }

  return new Error(`Unsupported platform: ${platform}`)
}
