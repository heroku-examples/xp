/**
 * Utility functions for migrating HEROKU_XP config from v1 to v2 format
 * and handling backward compatibility
 */

import {
  SimplifiedExperimentsConfig,
  ExperimentsConfig,
  AnyExperimentsConfig,
  parseExperimentsConfig,
  isSimplifiedConfig,
  migrateToSimplified,
} from '../types/experiment'

/**
 * Read and auto-migrate HEROKU_XP config var to v2 format
 *
 * @param configVarValue - Raw HEROKU_XP config string
 * @returns SimplifiedExperimentsConfig (v2 format)
 */
export function readAndMigrateConfig(configVarValue: string): SimplifiedExperimentsConfig {
  const config: AnyExperimentsConfig = parseExperimentsConfig(configVarValue)

  if (isSimplifiedConfig(config)) {
    return config
  }

  // Auto-migrate v1 to v2
  return migrateToSimplified(config)
}

/**
 * Example v1 config for testing:
 *
 * {
 *   "version": 1,
 *   "experiments": {
 *     "exp-feature-xyz": {
 *       "name": "exp-feature-xyz",
 *       "appName": "exp-feature-xyz-prod-app-a1b2",
 *       "createdAt": "2024-01-15T10:30:00Z",
 *       "updatedAt": "2024-01-15T10:30:00Z",
 *       "status": "active",
 *       "sourceType": "parent",
 *       "sourceApp": "prod-app",
 *       "sourceVersion": "feature-xyz",
 *       "routing": {
 *         "weight": 10,
 *         "paths": ["/api/v2"]
 *       },
 *       "mirror": false,
 *       "metadata": {
 *         "repo": "heroku/prod-app",
 *         "description": "Experiment for branch feature-xyz"
 *       }
 *     }
 *   }
 * }
 *
 * Migrates to v2 format:
 *
 * {
 *   "version": 2,
 *   "experiments": [
 *     {
 *       "appName": "prod-app",
 *       "branch": "feature-xyz",
 *       "experimentVersion": 1,
 *       "createdAt": "2024-01-15T10:30:00Z",
 *       "updatedAt": "2024-01-15T10:30:00Z",
 *       "experimentAppName": "exp-feature-xyz-prod-app-a1b2",
 *       "repo": "heroku/prod-app",
 *       "routes": {
 *         "weight": 10,
 *         "paths": ["/api/v2"]
 *       }
 *     }
 *   ]
 * }
 */
