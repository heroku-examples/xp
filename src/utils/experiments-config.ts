import {APIClient} from '@heroku-cli/command'
import {
  ExperimentsConfig,
  createEmptyConfig,
  parseExperimentsConfig,
  validateWeights,
} from '../types/experiment'
import {sanitizeErrorMessage} from './heroku-api'

const MAX_CONFIG_BYTES = 32 * 1024 // Heroku's config var size limit

/**
 * Reads HEROKU_XP from the app. If it is not set, returns an empty config, or
 * throws when `required` is set.
 */
export async function readExperimentsConfig(
  heroku: APIClient,
  appName: string,
  {required = false}: {required?: boolean} = {},
): Promise<ExperimentsConfig> {
  try {
    const {body} = await heroku.get<{HEROKU_XP?: string}>(`/apps/${appName}/config-vars`)
    if (!body.HEROKU_XP) {
      if (required) throw new Error('No experiments configured. Use "heroku xp:create" to create an experiment.')
      return createEmptyConfig()
    }

    try {
      return parseExperimentsConfig(body.HEROKU_XP)
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
  config: ExperimentsConfig,
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
