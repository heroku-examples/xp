// ===== NEW SIMPLIFIED FORMAT (v2 - FINAL) =====

export interface SimplifiedRule {
  mirror?: boolean
  weight?: number
  path?: string  // Comma-separated paths: "/api/v3,/api/v4"
  query?: string  // Format: "key: value"
  header?: string  // Format: "key: value"
  method?: string  // HTTP method: GET, POST, etc.
}

export interface SimplifiedExperimentEntry {
  appName: string  // Experiment app name (e.g., "prod-app-exp-new-ui-a7f3d")
  appID: string  // App UUID
  parentApp: string  // Parent/source app name for composite key lookup
  branch: string
  version: number
  repo: string
  url: string
  rules: SimplifiedRule[]
  active?: boolean  // Whether experiment is currently active (default: true)
  createdAt: string
  updatedAt: string
}

export interface SimplifiedExperimentsConfig {
  version: 2
  experiments: SimplifiedExperimentEntry[]
}

// ===== LEGACY FORMAT (v1) =====

export interface RoutingConfig {
  weight?: number
  paths?: string[]
  queries?: {[key: string]: string}
  headers?: {[key: string]: string}
  bodyJson?: string
}

export interface Experiment {
  name: string
  appName: string
  createdAt: string
  updatedAt: string
  status: 'active' | 'stopped' | 'expired'
  sourceType: 'tarball' | 'parent' | 'manual'
  sourceUrl?: string
  sourceVersion?: string
  sourceApp?: string
  routing: RoutingConfig
  mirror: boolean | 'both'
  ttl?: number
  expiresAt?: string
  appId?: string
  metadata: {
    createdBy?: string
    description?: string
    repo?: string
  }
}

export interface ExperimentsConfig {
  version: 1
  experiments: {
    [experimentName: string]: Experiment
  }
}

export interface AppSetupPayload {
  app: {
    name: string
    region: string
    stack: string
  }
  overrides: {
    env: {
      HEROKU_EXPERIMENT_NAME: string
      HEROKU_EXPERIMENT_PARENT: string
      HEROKU_EXPERIMENT_CREATED: string
      [key: string]: string
    }
    buildpacks: Array<{url: string}>
  }
  source_blob?: {
    url: string
    version: string
  }
  source_app?: string
}

// Legacy aliases for backward compatibility
export type ExperimentConfig = Experiment
export type HerokuExperimentsConfig = ExperimentsConfig

export interface ExperimentStats {
  name: string
  status: 'active' | 'stopped' | 'expired'
  appName: string
  dynoStatus: {
    state: 'up' | 'down' | 'idle' | 'starting' | 'crashed'
    dynoCount: number
    uptimeSeconds: number
  }
  traffic: {
    requestsPerMinute: number
    avgResponseTime: number
    statusCodes: {[code: string]: number}
    totalRequests: number
    errorRate: number
  }
  routing: RoutingConfig
  lastUpdated: string
}

export interface WatchSnapshot {
  timestamp: string
  experiments: ExperimentStats[]
}

// ===== BACKWARD COMPATIBILITY & MIGRATION =====

export type AnyExperimentsConfig = SimplifiedExperimentsConfig | ExperimentsConfig

export function isSimplifiedConfig(config: AnyExperimentsConfig): config is SimplifiedExperimentsConfig {
  return config.version === 2
}

export function isLegacyConfig(config: AnyExperimentsConfig): config is ExperimentsConfig {
  return config.version === 1
}

/**
 * Parse config string and return typed config (handles both v1 and v2 formats)
 */
export function parseExperimentsConfig(configStr: string): AnyExperimentsConfig {
  try {
    const parsed = JSON.parse(configStr)
    if (!parsed.version) {
      throw new Error('Missing version field in HEROKU_XP config')
    }
    if (parsed.version !== 1 && parsed.version !== 2) {
      throw new Error(`Unsupported HEROKU_XP config version: ${parsed.version}`)
    }
    return parsed
  } catch (error) {
    throw new Error(`Failed to parse HEROKU_XP config: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Migrate v1 config to v2 simplified format
 */
export function migrateToSimplified(legacyConfig: ExperimentsConfig): SimplifiedExperimentsConfig {
  const experiments: SimplifiedExperimentEntry[] = Object.values(legacyConfig.experiments).map(exp => {
    // Build rules from v1 routing config
    const rules: SimplifiedRule[] = []

    if (exp.routing || exp.mirror) {
      const rule: SimplifiedRule = {}

      if (exp.mirror === true || exp.mirror === 'both') {
        rule.mirror = true
      }

      if (exp.routing?.weight !== undefined) {
        rule.weight = exp.routing.weight
      }

      // Convert paths array to comma-separated string
      if (exp.routing?.paths && exp.routing.paths.length > 0) {
        rule.path = exp.routing.paths.join(',')
      }

      // Convert queries object to string format "key: value" (first entry)
      if (exp.routing?.queries) {
        const entries = Object.entries(exp.routing.queries)
        if (entries.length > 0) {
          const [key, value] = entries[0]
          rule.query = `${key}: ${value}`
        }
      }

      // Convert headers object to string format "key: value" (first entry)
      if (exp.routing?.headers) {
        const entries = Object.entries(exp.routing.headers)
        if (entries.length > 0) {
          const [key, value] = entries[0]
          rule.header = `${key}: ${value}`
        }
      }

      rule.method = 'GET'  // Default for v1 migrations

      rules.push(rule)
    }

    const entry: SimplifiedExperimentEntry = {
      appName: exp.appName,  // In v1, this was the experiment app name
      appID: exp.appId || '',  // May not exist in v1
      parentApp: exp.sourceApp || '',  // Best guess - may need manual correction
      branch: exp.name,  // In v1, 'name' was often the branch name
      version: 1,
      repo: exp.metadata?.repo || '',
      url: '',  // Not available in v1 format
      rules,
      createdAt: exp.createdAt,
      updatedAt: exp.updatedAt,
    }

    return entry
  })

  return {
    version: 2,
    experiments,
  }
}

/**
 * Find experiment by parentApp + branch (composite key for v2)
 */
export function findExperimentByKey(
  config: SimplifiedExperimentsConfig,
  parentApp: string,
  branch: string
): SimplifiedExperimentEntry | undefined {
  return config.experiments.find(exp => exp.parentApp === parentApp && exp.branch === branch)
}

/**
 * Create empty v2 config
 */
export function createEmptySimplifiedConfig(): SimplifiedExperimentsConfig {
  return {
    version: 2,
    experiments: [],
  }
}
