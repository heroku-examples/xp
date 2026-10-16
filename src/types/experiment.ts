export interface ExperimentRule {
  traffic?: 'mirror' | 'live'  // mirror: staging still responds; live: the experiment responds
  weight?: number
  path?: string  // Comma-separated paths: "/api/v3,/api/v4"
  query?: string  // Format: "key: value"
  header?: string  // Format: "key: value"
  method?: string  // HTTP method: GET, POST, etc.
}

export interface ExperimentEntry {
  appName: string  // Experiment app name (e.g., "my-app-staging-exp-new-ui-a7f3d")
  appID: string  // App UUID
  parentApp: string  // Parent/source app name for composite key lookup
  branch: string
  url: string
  rules: ExperimentRule[]
  active?: boolean  // Whether experiment is currently active (default: true)
}

export interface ExperimentsConfig {
  version: 1
  // Credentials the proxy start script exports as DYNO_PROXY_ADMIN_USER and
  // DYNO_PROXY_ADMIN_PASSWORD. Generated on first create and never overwritten.
  metrics_user?: string
  metrics_secret?: string
  experiments: ExperimentEntry[]
}

/**
 * Parse the HEROKU_XP config var.
 */
export function parseExperimentsConfig(configStr: string): ExperimentsConfig {
  let parsed: any
  try {
    parsed = JSON.parse(configStr)
  } catch (error) {
    throw new Error(`Failed to parse HEROKU_XP config: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (parsed?.version !== 1) {
    throw new Error(`Unsupported HEROKU_XP config version: ${parsed?.version}`)
  }

  return parsed
}

/**
 * Find experiment by parentApp + branch (composite key)
 */
export function findExperimentByKey(
  config: ExperimentsConfig,
  parentApp: string,
  branch: string
): ExperimentEntry | undefined {
  return config.experiments.find(exp => exp.parentApp === parentApp && exp.branch === branch)
}

/**
 * Create an empty config
 */
export function createEmptyConfig(): ExperimentsConfig {
  return {
    version: 1,
    experiments: [],
  }
}

/**
 * Validate that experiment weights don't exceed 100% within routing groups.
 *
 * Weights are only totaled when experiments share the same routing parameters:
 * - Same path (or both undefined)
 * - Same query (or both undefined)
 * - Same header (or both undefined)
 * - Same method (or both undefined)
 *
 * Mirror experiments are excluded from weight validation since they don't affect routing.
 * Only active experiments (active !== false) are validated.
 *
 * @param config - The experiments configuration to validate
 * @throws Error if any routing group exceeds 100% total weight
 */
export function validateWeights(config: ExperimentsConfig): void {
  // Only consider active, non-mirror experiments
  const activeExperiments = config.experiments.filter(exp => {
    const isActive = exp.active !== false
    const isMirror = exp.rules?.[0]?.traffic === 'mirror'
    return isActive && !isMirror
  })

  // Group experiments by routing signature
  const groups = new Map<string, ExperimentEntry[]>()

  for (const exp of activeExperiments) {
    const rule = exp.rules?.[0]

    // Skip experiments with no rules
    if (!rule) continue

    // Create unique key from all routing parameters
    // Use null for undefined values to ensure consistent grouping
    const routingKey = JSON.stringify({
      path: rule.path || null,
      query: rule.query || null,
      header: rule.header || null,
      method: rule.method || null,
    })

    if (!groups.has(routingKey)) {
      groups.set(routingKey, [])
    }
    groups.get(routingKey)!.push(exp)
  }

  // Validate each routing group separately
  groups.forEach((experiments, routingKey) => {
    const totalWeight = experiments.reduce(
      (sum, exp) => sum + (exp.rules?.[0]?.weight || 0),
      0
    )

    if (totalWeight > 100) {
      const routing = JSON.parse(routingKey)

      // Build human-readable routing description
      const routeParts: string[] = []
      if (routing.path) routeParts.push(`path: ${routing.path}`)
      if (routing.query) routeParts.push(`query: ${routing.query}`)
      if (routing.header) routeParts.push(`header: ${routing.header}`)
      if (routing.method) routeParts.push(`method: ${routing.method}`)

      const routeDesc = routeParts.length > 0
        ? routeParts.join(', ')
        : 'default routing'

      throw new Error(
        `Total experiment weight for ${routeDesc} is ${totalWeight}% (exceeds 100%)`
      )
    }
  })
}
