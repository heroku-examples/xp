import {ExperimentEntry, ExperimentRule} from '../types/experiment'

const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

/**
 * Turns the comma-separated --methods value into the rule's method list,
 * e.g. `GET,POST`. Undefined if none were given.
 */
export function parseMethods(value: string | undefined): string | undefined {
  const methods = (value ?? '')
    .split(',')
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
export function validateRoutingFlags(branch: string, flags: {[flag: string]: any; weight?: number; query?: string; header?: string; methods?: string}): void {
  parseMethods(flags.methods)

  if (!/^[a-zA-Z0-9-_./]+$/.test(branch)) {
    throw new Error('Branch name contains invalid characters')
  }

  if (flags.weight !== undefined && (flags.weight < 0 || flags.weight > 100)) {
    throw new Error('Weight must be between 0 and 100')
  }

  if (flags.query !== undefined && !flags.query.includes('=')) {
    throw new Error(`Invalid query parameter format: "${flags.query}". Use format: key=value`)
  }

  if (flags.header !== undefined && !flags.header.includes('=')) {
    throw new Error(`Invalid header format: "${flags.header}". Use format: key=value`)
  }
}

/** Builds an experiment rule from routing flags. Flags that aren't given are left out (method defaults to GET, traffic to mirror). */
export function buildRule(flags: {
  weight?: number
  traffic?: string
  path?: string
  query?: string
  header?: string
  methods?: string
}): ExperimentRule {
  // "key=value" becomes "key: value".
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
  }
  const methods = parseMethods(flags.methods)
  if (methods) rule.methods = methods
  if (flags.weight !== undefined) rule.weight = flags.weight
  if (flags.path) rule.path = flags.path
  if (flags.query) rule.query = keyValue('query', flags.query)
  if (flags.header) rule.header = keyValue('header', flags.header)

  return rule
}

/** A one-line summary of an experiment's first rule, e.g. `10% /api (+1) ?xp=a`. */
export function formatRoute(exp: ExperimentEntry): string {
  const rule = exp.rules?.[0]
  if (!rule) return '-'

  const parts: string[] = []
  if (rule.weight !== undefined) parts.push(`${rule.weight}%`)
  if (rule.methods) parts.push(rule.methods.split(',').map(m => m.trim().toUpperCase()).join(','))
  if (rule.path) parts.push(rule.path)

  // Stored as "key: value"; shown as key=value, like the flags.
  const keyValue = (stored: string) => stored.replace(/:\s*/, '=')
  if (rule.query) parts.push(`?${keyValue(rule.query)}`)
  if (rule.header) parts.push(`header:${keyValue(rule.header)}`)

  return parts.length > 0 ? parts.join(' ') : '-'
}
