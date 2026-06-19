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
  setupId?: string
  metadata: {
    createdBy?: string
    description?: string
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
