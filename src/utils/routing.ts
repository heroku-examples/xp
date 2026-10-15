import {SimplifiedExperimentEntry} from '../types/experiment'

/** Checks the branch name and routing flags shared by xp:create and xp:update. */
export function validateRoutingFlags(branch: string, flags: {[flag: string]: any; weight?: number; query?: string[]; header?: string[]}): void {
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

/** A one-line summary of an experiment's first rule, e.g. `10% /api (+1) ?xp: a`. */
export function formatRoute(exp: SimplifiedExperimentEntry): string {
  const rule = exp.rules?.[0]
  if (!rule) return '-'

  const parts: string[] = []
  if (rule.weight !== undefined) parts.push(`${rule.weight}%`)
  if (rule.method && rule.method !== 'GET') parts.push(rule.method)
  if (rule.path) {
    const paths = rule.path.split(',')
    parts.push(paths.length > 1 ? `${paths[0]} (+${paths.length - 1})` : paths[0])
  }

  if (rule.query) parts.push(`?${rule.query}`)
  if (rule.header) parts.push(`header:${rule.header}`)

  return parts.length > 0 ? parts.join(' ') : '-'
}
