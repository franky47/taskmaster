// oxlint-disable typescript/unbound-method

/**
 * Scan all project .ts files for deprecated API usage.
 * Uses TypeScript's suggestion diagnostics (TS6385) — the same mechanism
 * the IDE uses to strike-through deprecated symbols.
 *
 * Exits with code 1 if any deprecated usage is found.
 *
 * Usage: bun run scripts/find-deprecated.ts
 */

import path from 'node:path'

import ts from 'typescript'

const configPath = ts.findConfigFile(
  process.cwd(),
  ts.sys.fileExists,
  'tsconfig.json',
)
if (!configPath) {
  console.error('tsconfig.json not found')
  process.exit(1)
}

const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  path.dirname(configPath),
)

const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => parsed.fileNames,
  getScriptVersion: () => '0',
  getScriptSnapshot: (fileName) => {
    const content = ts.sys.readFile(fileName)
    return content !== undefined
      ? ts.ScriptSnapshot.fromString(content)
      : undefined
  },
  getCurrentDirectory: () => process.cwd(),
  getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
}

const service = ts.createLanguageService(host, ts.createDocumentRegistry())
const program = service.getProgram()!
const checker = program.getTypeChecker()

function getDeprecationReason(
  sourceFile: ts.SourceFile,
  start: number,
): string | undefined {
  // Walk down to the identifier at the diagnostic position
  function findNode(node: ts.Node): ts.Node | undefined {
    if (node.getStart() === start && ts.isIdentifier(node)) return node
    return ts.forEachChild(node, findNode)
  }
  const node = findNode(sourceFile)
  if (!node) return undefined

  const symbol = checker.getSymbolAtLocation(node)
  if (!symbol) return undefined

  // For overloaded methods, the @deprecated tag lives on the specific
  // declaration that matched. getJsDocTags merges across all declarations,
  // which is what we want — the tag text contains the replacement hint.
  const tags = symbol.getJsDocTags(checker)
  const dep = tags.find((t) => t.name === 'deprecated')
  if (!dep) return undefined

  return dep.text?.map((t) => t.text).join('') || undefined
}

let count = 0

for (const fileName of parsed.fileNames) {
  for (const diag of service.getSuggestionDiagnostics(fileName)) {
    if (diag.code !== 6385) continue
    if (!diag.file || diag.start === undefined) continue

    const { line, character } = diag.file.getLineAndCharacterOfPosition(
      diag.start,
    )
    const text = diag.file.text.slice(
      diag.start,
      diag.start + (diag.length ?? 0),
    )
    const rel = path.relative(process.cwd(), diag.file.fileName)
    const reason = getDeprecationReason(diag.file, diag.start)

    console.error(`${rel}:${line + 1}:${character + 1} - deprecated: ${text}`)
    if (reason) {
      console.error(`  ${reason}`)
    }
    console.error()
    count++
  }
}

if (count > 0) {
  console.error(`Found ${count} deprecated API usage(s).`)
  process.exit(1)
}
