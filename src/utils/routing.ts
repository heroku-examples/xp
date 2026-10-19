import {ExperimentEntry, ExperimentRule} from '../types/experiment'

const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

/**
 * Turns --methods values (repeated, or comma-separated) into the rule's
 * comma-separated method list, e.g. `GET,POST`. Undefined if none were given.
 */
export function parseMethods(values: string[] | undefined): string | undefined {
  const methods = (values ?? [])
    .flatMap(value => value.split(','))
    .map(method => method.trim().toUpperCase())
    .filter(Boolean)

  for (const method of methods) {
    if (!HTTP_METHODS.includes(method)) {
      throw new Error(`Invalid method "${method}". Use one of: ${HTTP_METHODS.join(', ')}`)
    }
  }

  return methods.length > 0 ? [...new Set(methods)].join(',') : undefined
}

/** Checks the branch name and routing flags shared by xp:create and xp:update. */
export function validateRoutingFlags(branch: string, flags: {[flag: string]: any; weight?: number; query?: string[]; header?: string[]; methods?: string[]}): void {
  parseMethods(flags.methods)

  if (!/^[a-zA-Z0-9-_./]+$/.test(branch)) {
    throw new Error('Branch name contains invalid characters')
  }

  if (flags.weight !== undefined && (flags.weight < 0 || flags.weight > 100)) {
    throw new Error('Weight must be between 0 and 100')
  }

  for (const query of flags.query ?? []) {
    if (!query.includes('=')) {
      throw new Error(`Invalid query parameter format: "${query}". Use format: key=value`)
    }
  }

  for (const header of flags.header ?? []) {
    if (!header.includes('=')) {
      throw new Error(`Invalid header format: "${header}". Use format: key=value`)
    }
  }
}

/** Builds an experiment rule from routing flags. Flags that aren't given are left out (method defaults to GET, traffic to mirror). */
export function buildRule(flags: {
  weight?: number
  traffic?: string
  path?: string[]
  query?: string[]
  header?: string[]
  methods?: string[]
}): ExperimentRule {
  // "key=value" becomes "key: value"; only the first of several is used.
  const keyValue = (kind: string, raw: string) => {
    const [key, ...rest] = raw.split('=')
    const value = rest.join('=')
    for (const part of [key, value]) {
      if (/[\r\n]/.test(part)) {
        throw new Error(`Invalid ${kind}: contains newline characters`)
      }
    }

    return `${key}: ${value}`
  }

  const rule: ExperimentRule = {
    traffic: flags.traffic === 'live' ? 'live' : 'mirror',
    method: parseMethods(flags.methods) ?? 'GET',
  }
  if (flags.weight !== undefined) rule.weight = flags.weight
  if (flags.path) rule.path = flags.path.join(',')
  if (flags.query) rule.query = keyValue('query', flags.query[0])
  if (flags.header) rule.header = keyValue('header', flags.header[0])

  return rule
}

/** A one-line summary of an experiment's first rule, e.g. `10% /api (+1) ?xp=a`. */
export function formatRoute(exp: ExperimentEntry): string {
  const rule = exp.rules?.[0]
  if (!rule) return '-'

  const parts: string[] = []
  if (rule.weight !== undefined) parts.push(`${rule.weight}%`)
  if (rule.method && rule.method !== 'GET') parts.push(rule.method)
  if (rule.path) {
    const paths = rule.path.split(',')
    parts.push(paths.length > 1 ? `${paths[0]} (+${paths.length - 1})` : paths[0])
  }

  // Stored as "key: value"; shown as key=value, like the flags.
  const keyValue = (stored: string) => stored.replace(/:\s*/, '=')
  if (rule.query) parts.push(`?${keyValue(rule.query)}`)
  if (rule.header) parts.push(`header:${keyValue(rule.header)}`)

  return parts.length > 0 ? parts.join(' ') : '-'
}
