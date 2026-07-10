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

export default class Stop extends Command {
  static description = 'Stop an experiment by setting active: false in HEROKU_XP configuration'

  static examples = [
    `$ heroku xp:stop --app prod-app --branch feature-xyz`,
    `$ heroku xp:stop -a prod-app -b new-ui`,
  ]

  static flags: any = {
    app: flags.app({required: true}),
    remote: flags.remote(),
    branch: flags.string({
      char: 'b',
      description: 'GitHub branch name of the experiment to stop',
      required: true,
    }),
  }

  async run() {
    const {flags} = await this.parse(Stop)
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

      // Step 2: Find the experiment to stop
      cli.action.start(`Finding experiment for branch "${branch}"`)
      const experiment = findExperimentByKey(experimentsConfig, parentApp, branch)

      if (!experiment) {
        cli.action.stop('✗')
        this.error(`No experiment found for branch "${branch}" on app "${parentApp}".\nRun 'heroku xp:list --app ${parentApp}' to see all experiments.`)
        return
      }

      const experimentAppName = experiment.appName
      cli.action.stop(`✓ Found: ${experimentAppName}`)

      // Step 3: Check if already inactive
      if (experiment.active === false) {
        this.log('')
        this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        this.log('ℹ️  Experiment is already inactive')
        this.log('')
        this.log(`  Parent App:     ${parentApp}`)
        this.log(`  Branch:         ${branch}`)
        this.log(`  Experiment App: ${experimentAppName}`)
        this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        this.log('')
        return
      }

      // Step 4: Set active: false
      cli.action.start('Stopping experiment')
      try {
        // Find the experiment index
        const experimentIndex = experimentsConfig.experiments.findIndex(
          exp => exp.parentApp === parentApp && exp.branch === branch
        )

        if (experimentIndex === -1) {
          cli.action.stop('✗')
          this.error('Failed to find experiment in configuration')
          return
        }

        // Update the experiment to set active: false
        experimentsConfig.experiments[experimentIndex] = {
          ...experimentsConfig.experiments[experimentIndex],
          active: false,
        }

        // Update the config
        await this.updateExperimentsConfig(parentApp, experimentsConfig)
        cli.action.stop('✓')
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Step 5: Display results
      this.log('')
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      this.log('✓ Experiment stopped successfully!')
      this.log('')
      this.log(`  Parent App:     ${parentApp}`)
      this.log(`  Branch:         ${branch}`)
      this.log(`  Experiment App: ${experimentAppName}`)
      this.log('')
      this.log('The experiment is now inactive and will not receive traffic.')
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      this.log('')
      this.log('To reactivate this experiment, run:')
      this.log(`  heroku xp:start --app ${parentApp} --branch ${branch}`)
      this.log('')
      this.log('To permanently remove this experiment, run:')
      this.log(`  heroku xp:destroy --app ${parentApp} --branch ${branch}`)
      this.log('')

    } catch (error: any) {
      this.error(`Failed to stop experiment: ${error.message}`)
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
}
