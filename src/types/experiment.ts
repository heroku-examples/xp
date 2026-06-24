// ===== NEW SIMPLIFIED FORMAT =====

export interface SimplifiedRoutingConfig {
  weight?: number
  paths?: string[]
  queries?: Record<string, string>
  headers?: Record<string, string>
  bodyJson?: string
  mirror?: boolean
  ttl?: number
  expiresAt?: string
}

export interface SimplifiedExperimentEntry {
  appName: string  // Parent/source app name
  branch: string
  version: number
  createdAt: string
  updatedAt: string
  experimentAppName?: string  // The actual experiment app name (generated)
  repo?: string
  url?: string
  routes?: SimplifiedRoutingConfig[]
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
    const entry: SimplifiedExperimentEntry = {
      appName: exp.appName,
      branch: exp.name, // In v1, 'name' was often the branch name
      version: 1,
      createdAt: exp.createdAt,
      updatedAt: exp.updatedAt,
    }

    // Add optional fields
    if (exp.metadata?.repo) {
      entry.repo = exp.metadata.repo
    }

    // Convert routing config
    if (exp.routing || exp.mirror || exp.ttl || exp.expiresAt) {
      const route: SimplifiedRoutingConfig = {}

      if (exp.routing.weight !== undefined) route.weight = exp.routing.weight
      if (exp.routing.paths) route.paths = exp.routing.paths
      if (exp.routing.queries) route.queries = exp.routing.queries
      if (exp.routing.headers) route.headers = exp.routing.headers
      if (exp.routing.bodyJson) route.bodyJson = exp.routing.bodyJson

      // Convert mirror field (v1: boolean | 'both', v2: boolean)
      if (exp.mirror === true || exp.mirror === 'both') {
        route.mirror = true
      }

      if (exp.ttl) route.ttl = exp.ttl
      if (exp.expiresAt) route.expiresAt = exp.expiresAt

      entry.routes = [route]
    }

    return entry
  })

  return {
    version: 2,
    experiments,
  }
}

/**
 * Find experiment by appName + branch (composite key for v2)
 */
export function findExperimentByKey(
  config: SimplifiedExperimentsConfig,
  appName: string,
  branch: string
): SimplifiedExperimentEntry | undefined {
  return config.experiments.find(exp => exp.appName === appName && exp.branch === branch)
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
