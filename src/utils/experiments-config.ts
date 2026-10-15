import {APIClient} from '@heroku-cli/command'
import {
  SimplifiedExperimentsConfig,
  createEmptySimplifiedConfig,
  isSimplifiedConfig,
  migrateToSimplified,
  parseExperimentsConfig,
  validateWeights,
} from '../types/experiment'
import {sanitizeErrorMessage} from './heroku-api'

const MAX_CONFIG_BYTES = 32 * 1024 // Heroku's config var size limit

/** Reads HEROKU_XP from the app, or an empty config if it is not set. */
export async function readExperimentsConfig(heroku: APIClient, appName: string): Promise<SimplifiedExperimentsConfig> {
  try {
    const {body} = await heroku.get<{HEROKU_XP?: string}>(`/apps/${appName}/config-vars`)
    if (!body.HEROKU_XP) return createEmptySimplifiedConfig()

    try {
      const config = parseExperimentsConfig(body.HEROKU_XP)
      return isSimplifiedConfig(config) ? config : migrateToSimplified(config)
    } catch (error: any) {
      throw new Error(`Failed to parse HEROKU_XP config: ${sanitizeErrorMessage(error)}`)
    }
  } catch (error: any) {
    throw new Error(`Failed to read experiment configuration: ${sanitizeErrorMessage(error)}`)
  }
}

/** Validates the config and writes it to HEROKU_XP. */
export async function writeExperimentsConfig(
  heroku: APIClient,
  appName: string,
  config: SimplifiedExperimentsConfig,
): Promise<void> {
  try {
    validateWeights(config)

    const configJson = JSON.stringify(config, null, 2)
    const size = Buffer.byteLength(configJson, 'utf8')
    if (size > MAX_CONFIG_BYTES) {
      throw new Error(
        `HEROKU_XP config would exceed 32KB limit (${size} bytes). ` +
        'Remove old experiments with: heroku xp:destroy',
      )
    }

    await heroku.patch(`/apps/${appName}/config-vars`, {body: {HEROKU_XP: configJson}})
  } catch (error: any) {
    throw new Error(`Failed to update experiment configuration: ${sanitizeErrorMessage(error)}`)
  }
}
