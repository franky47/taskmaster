const TOKEN_NAMES = ['PREFLIGHT'] as const
type TokenName = (typeof TOKEN_NAMES)[number]

const TOKEN_SET: ReadonlySet<string> = new Set(TOKEN_NAMES)
const TOKEN_RE = new RegExp(`<(${TOKEN_NAMES.join('|')})\\s*\\/>`, 'g')

function isTokenName(s: string): s is TokenName {
  return TOKEN_SET.has(s)
}

type SubstituteResult = {
  resolved: string
  nonEmptyCount: number
}

export function substituteTokens(
  body: string,
  values: Partial<Record<TokenName, string>>,
): SubstituteResult {
  let nonEmptyCount = 0
  const resolved = body.replace(TOKEN_RE, (match, name: string) => {
    if (!isTokenName(name)) return match
    if (!(name in values)) return match
    const trimmed = (values[name] ?? '').trim()
    if (trimmed.length > 0) nonEmptyCount += 1
    return trimmed
  })
  return { resolved, nonEmptyCount }
}

export function findTokens(body: string): Set<TokenName> {
  const found = new Set<TokenName>()
  for (const match of body.matchAll(TOKEN_RE)) {
    const name = match[1]
    if (name !== undefined && isTokenName(name)) found.add(name)
  }
  return found
}
