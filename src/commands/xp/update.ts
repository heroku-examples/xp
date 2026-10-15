import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import {formatRoute, validateRoutingFlags} from '../../utils/routing'
import {
  SimplifiedExperimentsConfig,
  SimplifiedExperimentEntry,
  AnyExperimentsConfig,
  parseExperimentsConfig,
  isSimplifiedConfig,
  migrateToSimplified,
  findExperimentByKey,
  validateWeights,
} from '../../types/experiment'

export default class Update extends Command {
  static description = 'Update experiment routing configuration (HEROKU_XP only)'

  static examples = [
    `$ heroku xp:update --app my-app-staging --branch feature-xyz --weight 20`,
    `$ heroku xp:update -a my-app-staging -b new-ui --path /api/v2`,
    `$ heroku xp:update -a my-app-staging -b test --weight 0`,
  ]

  static flags: any = {
    app: flags.app({required: true}),
    remote: flags.remote(),
    branch: flags.string({
      char: 'b',
      description: 'GitHub branch name of the experiment to update',
      required: true,
    }),
    weight: flags.integer({
      char: 'w',
      description: 'Traffic weight percentage (0-100)',
    }),
    path: flags.string({
      char: 'p',
      description: 'Path-based routing (can specify multiple)',
      multiple: true,
    }),
    query: flags.string({
      char: 'q',
      description: 'Query parameter routing (format: key=value)',
      multiple: true,
    }),
    header: flags.string({
      char: 'H',
      description: 'Header-based routing (format: key=value)',
      multiple: true,
    }),
    traffic: flags.string({
      char: 't',
      description: 'How traffic reaches the experiment: mirror (staging still responds) or live (the experiment responds)',
      options: ['mirror', 'live'],
    }),
  }

  async run() {
    const {flags} = await this.parse(Update)
    const parentApp = flags.app!
    const branch = flags.branch

    try {
      cli.action.start('Updating experiment')

      // Step 1: Validate arguments
      validateRoutingFlags(branch, flags)

      // Step 2: Read HEROKU_XP config var
      const experimentsConfig = await this.getExperimentsConfig(parentApp)

      // Step 3: Find experiment by branch
      const existingExperiment = findExperimentByKey(experimentsConfig, parentApp, branch)
      if (!existingExperiment) {
        throw new Error(`No experiment found for branch "${branch}" on app "${parentApp}"`)
      }

      // Step 4: Update experiment configuration
      const updatedExperiment = this.buildUpdatedExperiment(existingExperiment, flags)

      // Step 5: Replace in config
      const index = experimentsConfig.experiments.findIndex(
        exp => exp.parentApp === parentApp && exp.branch === branch
      )
      if (index !== -1) {
        experimentsConfig.experiments[index] = updatedExperiment
      }

      // Step 6: Update HEROKU_XP config var
      await this.updateExperimentsConfig(parentApp, experimentsConfig)

      cli.action.stop('')

      // Display updated experiment in table format
      this.log('')
      this.log('Updated experiment:')
      this.log('')

      // Check if experiment is in mirror mode
      const isMirror = updatedExperiment.rules && updatedExperiment.rules.length > 0 && updatedExperiment.rules[0].traffic === 'mirror'
      const mode = isMirror ? 'mirror' : 'live'
      const tableData = [{
        active: updatedExperiment.active !== false ? `✓ ${mode}` : '✗',
        branch: updatedExperiment.branch,
        route: formatRoute(updatedExperiment),
      }]

      cli.table(tableData, {
        active: {
          header: 'Active',
          minWidth: 8,
        },
        branch: {
          header: 'Branch',
          minWidth: 15,
        },
        route: {
          header: 'Route',
          minWidth: 30,
        },
      })

      this.log('')
      this.log(`heroku xp:watch --app ${parentApp}`)
      this.log('')

    } catch (error: any) {
      cli.action.stop('')
      this.error(`Failed to update experiment: ${error.message}`)
    }
  }

  private async getExperimentsConfig(appName: string): Promise<SimplifiedExperimentsConfig> {
    try {
      const {body: configVars} = await this.heroku.get(`/apps/${appName}/config-vars`)
      const configVarsData = configVars as {HEROKU_XP?: string}

      if (!configVarsData.HEROKU_XP) {
        throw new Error('No experiments configured. Use "heroku xp:create" to create an experiment.')
      }

      try {
        const config: AnyExperimentsConfig = parseExperimentsConfig(configVarsData.HEROKU_XP)

        // Migrate v1 to v2 if needed
        if (!isSimplifiedConfig(config)) {
          return migrateToSimplified(config)
        }

        return config
      } catch (error: any) {
        throw new Error(`Failed to parse HEROKU_XP config: ${error.message}`)
      }
    } catch (error: any) {
      throw new Error(`Failed to read experiment configuration: ${error.message}`)
    }
  }

  private buildUpdatedExperiment(
    existingExperiment: SimplifiedExperimentEntry,
    flags: any
  ): SimplifiedExperimentEntry {
    const now = new Date().toISOString()

    // Build rules array
    const rules: any[] = []

    // Create rule if any routing parameters exist
    const hasRoutingConfig = flags.weight !== undefined || flags.path || flags.query || flags.header || flags.method || flags.traffic !== undefined

    if (hasRoutingConfig) {
      const rule: any = {}

      // Keep the existing traffic setting or default to mirror
      rule.traffic = flags.traffic ?? existingExperiment.rules?.[0]?.traffic ?? 'mirror'

      if (flags.weight !== undefined) {
        rule.weight = flags.weight
      } else if (existingExperiment.rules?.[0]?.weight !== undefined) {
        // Keep existing weight
        rule.weight = existingExperiment.rules[0].weight
      }

      // Convert path array to comma-separated string
      if (flags.path && Array.isArray(flags.path)) {
        rule.path = flags.path.join(',')
      } else if (existingExperiment.rules?.[0]?.path) {
        // Keep existing path
        rule.path = existingExperiment.rules[0].path
      }

      // Convert query array to string format "key: value"
      if (flags.query && Array.isArray(flags.query)) {
        const [key, value] = flags.query[0].split('=')
        rule.query = `${key}: ${value}`
      } else if (existingExperiment.rules?.[0]?.query) {
        // Keep existing query
        rule.query = existingExperiment.rules[0].query
      }

      // Convert header array to string format "key: value"
      if (flags.header && Array.isArray(flags.header)) {
        const [key, value] = flags.header[0].split('=')
        rule.header = `${key}: ${value}`
      } else if (existingExperiment.rules?.[0]?.header) {
        // Keep existing header
        rule.header = existingExperiment.rules[0].header
      }

      if (flags.method) {
        rule.method = flags.method
      } else {
        rule.method = existingExperiment.rules?.[0]?.method || 'GET'
      }

      rules.push(rule)
    } else {
      // No routing config provided, keep existing rules
      if (existingExperiment.rules && existingExperiment.rules.length > 0) {
        rules.push(...existingExperiment.rules)
      }
    }

    return {
      ...existingExperiment,
      rules,
      version: (existingExperiment.version || 1) + 1,
      updatedAt: now,
    }
  }

  private async updateExperimentsConfig(
    appName: string,
    config: SimplifiedExperimentsConfig
  ): Promise<void> {
    try {
      // Validate total weight doesn't exceed 100% for each routing group
      validateWeights(config)

      // Validate config size (max 32KB for Heroku config vars)
      const configJson = JSON.stringify(config, null, 2)
      const configSize = Buffer.byteLength(configJson, 'utf8')
      const maxSize = 32 * 1024 // 32KB

      if (configSize > maxSize) {
        throw new Error(
          `HEROKU_XP config would exceed 32KB limit (${configSize} bytes). ` +
          'Remove old experiments with: heroku xp:destroy'
        )
      }

      // Update config var
      await this.heroku.patch(`/apps/${appName}/config-vars`, {
        body: {
          HEROKU_XP: configJson,
        },
      })
    } catch (error: any) {
      throw new Error(`Failed to update experiment configuration: ${error.message}`)
    }
  }
}
