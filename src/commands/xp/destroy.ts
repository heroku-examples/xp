import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import {
  SimplifiedExperimentsConfig,
  SimplifiedExperimentEntry,
  AnyExperimentsConfig,
  parseExperimentsConfig,
  isSimplifiedConfig,
  migrateToSimplified,
  createEmptySimplifiedConfig,
  findExperimentByKey,
  validateWeights,
} from '../../types/experiment'

export default class Destroy extends Command {
  static description = 'Destroy an experiment and remove it from HEROKU_XP configuration'

  static examples = [
    `$ heroku xp:destroy --app my-app-staging --branch feature-xyz`,
    `$ heroku xp:destroy -a my-app-staging -b new-ui`,
  ]

  static flags: any = {
    app: flags.app({required: true}),
    remote: flags.remote(),
    branch: flags.string({
      char: 'b',
      description: 'GitHub branch name of the experiment to destroy',
      required: true,
    }),
    confirm: flags.string({
      char: 'c',
      description: 'Confirmation string (app name) to skip interactive prompt',
    }),
  }

  async run() {
    const {flags} = await this.parse(Destroy)
    const parentApp = flags.app!
    const branch = flags.branch

    try {
      // Step 1: Fetch HEROKU_XP config
      cli.action.start('Fetching experiment configuration')
      let experimentsConfig: SimplifiedExperimentsConfig
      try {
        experimentsConfig = await this.getExperimentsConfig(parentApp)
        cli.action.stop('✓')
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Step 2: Find the experiment to destroy
      cli.action.start(`Finding experiment for branch "${branch}"`)
      const experiment = findExperimentByKey(experimentsConfig, parentApp, branch)

      if (!experiment) {
        cli.action.stop('✗')
        this.error(`No experiment found for branch "${branch}" on app "${parentApp}".\nRun 'heroku xp:list --app ${parentApp}' to see all experiments.`)
        return
      }

      const experimentAppName = experiment.appName
      cli.action.stop(`✓ Found: ${experimentAppName}`)

      // Step 3: Confirm destruction (unless --confirm flag provided)
      if (!flags.confirm) {
        this.log('')
        this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        this.log('⚠️  WARNING: This will destroy the following experiment:')
        this.log('')
        this.log(`  Parent App:     ${parentApp}`)
        this.log(`  Branch:         ${branch}`)
        this.log(`  Experiment App: ${experimentAppName}`)
        this.log('')
        this.log('This action will:')
        this.log('  1. Remove the experiment from HEROKU_XP configuration')
        this.log('  2. Stop routing traffic to the experiment app')
        this.log('')
        this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        this.log('')

        const confirmation = await cli.prompt(`Type the experiment app name "${experimentAppName}" to confirm`, {
          required: true,
        })

        if (confirmation !== experimentAppName) {
          this.error('Confirmation failed. Experiment was not destroyed.')
          return
        }
      } else if (flags.confirm !== experimentAppName) {
        this.error(`Confirmation failed: expected "${experimentAppName}" but got "${flags.confirm}"`)
        return
      }

      // Step 4: Remove experiment from config
      cli.action.start('Removing experiment from configuration')
      try {
        // Filter out the experiment
        const originalCount = experimentsConfig.experiments.length
        experimentsConfig.experiments = experimentsConfig.experiments.filter(
          exp => !(exp.parentApp === parentApp && exp.branch === branch)
        )

        if (experimentsConfig.experiments.length === originalCount) {
          cli.action.stop('✗')
          this.error('Failed to remove experiment from configuration (not found in array)')
          return
        }

        // Update the config
        await this.updateExperimentsConfig(parentApp, experimentsConfig)
        cli.action.stop('✓')
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Step 5: Check if other experiments use the same app
      const otherExperimentsOnSameApp = experimentsConfig.experiments.filter(
        exp => exp.appName === experimentAppName
      )

      // Step 6: Display results
      this.log('')
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      this.log('✓ Experiment destroyed successfully!')
      this.log('')
      this.log(`  Parent App:     ${parentApp}`)
      this.log(`  Branch:         ${branch}`)
      this.log(`  Experiment App: ${experimentAppName}`)
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      this.log('')

      if (otherExperimentsOnSameApp.length > 0) {
        this.log('⚠️  Note: Other experiments still use this app:')
        this.log('')
        otherExperimentsOnSameApp.forEach(exp => {
          this.log(`  • ${exp.parentApp} / ${exp.branch}`)
        })
        this.log('')
        this.log(`The app "${experimentAppName}" is still in use and should NOT be destroyed.`)
        this.log('')
      } else {
        this.log('ℹ️  No other experiments use this app.')
        this.log('')
        this.log('Resources will need to be manually destroyed with:')
        this.log(`  heroku apps:destroy --app ${experimentAppName} --confirm ${experimentAppName}`)
        this.log('')
      }

      // Step 7: Show recreate command
      this.log('To recreate this experiment configuration, run:')
      this.log('')
      this.log(this.buildRecreateCommand(experiment, parentApp))
      this.log('')

    } catch (error: any) {
      this.error(`Failed to destroy experiment: ${error.message}`)
    }
  }

  private async getExperimentsConfig(appName: string): Promise<SimplifiedExperimentsConfig> {
    try {
      const {body: configVars} = await this.heroku.get(`/apps/${appName}/config-vars`)
      const configVarsData = configVars as {HEROKU_XP?: string}

      if (configVarsData.HEROKU_XP) {
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
      }

      // Return empty v2 config if HEROKU_XP doesn't exist
      return createEmptySimplifiedConfig()
    } catch (error: any) {
      throw new Error(`Failed to read experiment configuration: ${error.message}`)
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

  private buildRecreateCommand(experiment: SimplifiedExperimentEntry, parentApp: string): string {
    const parts = [
      `heroku xp:create`,
      `--app ${parentApp}`,
      `--branch ${experiment.branch}`,
    ]

    // Add routing flags based on the first rule
    if (experiment.rules && experiment.rules.length > 0) {
      const rule = experiment.rules[0]

      if (rule.weight !== undefined) {
        parts.push(`--weight ${rule.weight}`)
      }

      if (rule.traffic !== undefined) {
        parts.push(`--traffic ${rule.traffic}`)
      }

      if (rule.path) {
        // Split comma-separated paths and add multiple --path flags
        const paths = rule.path.split(',').map(p => p.trim())
        paths.forEach(path => {
          parts.push(`--path "${path}"`)
        })
      }

      if (rule.query) {
        // Format: "key: value" -> --query key=value
        const match = rule.query.match(/^([^:]+):\s*(.+)$/)
        if (match) {
          parts.push(`--query "${match[1]}=${match[2]}"`)
        }
      }

      if (rule.header) {
        // Format: "key: value" -> --header key=value
        const match = rule.header.match(/^([^:]+):\s*(.+)$/)
        if (match) {
          parts.push(`--header "${match[1]}=${match[2]}"`)
        }
      }

      if (rule.method && rule.method !== 'GET') {
        parts.push(`--method ${rule.method}`)
      }
    }

    return `  ${parts.join(' ')}`
  }
}
