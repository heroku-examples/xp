import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import {
  SimplifiedExperimentsConfig,
  AnyExperimentsConfig,
  parseExperimentsConfig,
  isSimplifiedConfig,
  migrateToSimplified,
  validateWeights,
} from '../../types/experiment'

export default class Start extends Command {
  static description = 'Start (reactivate) a stopped experiment'

  static examples = [
    `$ heroku xp:start --app my-app-staging --branch feature-xyz`,
    `$ heroku xp:start -a my-app-staging -b new-ui`,
  ]

  static flags: any = {
    app: flags.app({required: true}),
    remote: flags.remote(),
    branch: flags.string({
      char: 'b',
      description: 'GitHub branch name of the experiment to start',
      required: true,
    }),
  }

  async run() {
    const {flags} = await this.parse(Start)
    const parentApp = flags.app!
    const branch = flags.branch

    try {
      // Step 1: Read HEROKU_XP config var
      cli.action.start('Reading experiment configuration')
      let experimentsConfig: SimplifiedExperimentsConfig
      try {
        experimentsConfig = await this.getExperimentsConfig(parentApp)
        cli.action.stop('✓')
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Step 2: Find experiment by branch
      cli.action.start(`Finding experiment for branch "${branch}"`)
      const experimentIndex = experimentsConfig.experiments.findIndex(
        exp => exp.branch === branch && exp.parentApp === parentApp
      )

      if (experimentIndex === -1) {
        cli.action.stop('✗')
        throw new Error(`No experiment found for branch "${branch}" on app "${parentApp}"`)
      }

      const experiment = experimentsConfig.experiments[experimentIndex]
      cli.action.stop(`✓ Found: ${experiment.appName}`)

      // Step 3: Check if already active
      if (experiment.active !== false) {
        this.log(`\nExperiment "${branch}" is already active.`)
        return
      }

      // Step 4: Remove active: false flag
      cli.action.start('Activating experiment')
      delete experiment.active
      experiment.updatedAt = new Date().toISOString()
      experiment.version = (experiment.version || 1) + 1

      // Update the config
      experimentsConfig.experiments[experimentIndex] = experiment

      try {
        await this.updateExperimentsConfig(parentApp, experimentsConfig)
        cli.action.stop('✓')
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Success message
      this.log('')
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      this.log(`✓ Experiment started successfully!`)
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      this.log('')
      this.log(`  App:          ${experiment.appName}`)
      this.log(`  Branch:       ${branch}`)
      this.log(`  Parent:       ${parentApp}`)
      this.log(`  Version:      ${experiment.version}`)
      this.log(`  Status:       Active`)
      this.log('')
      this.log('Next steps:')
      this.log('')
      this.log('  1. Deploy parent app to activate routing:')
      this.log(`     git commit --allow-empty -m "Start experiment: ${branch}"`)
      this.log(`     git push heroku main`)
      this.log('')
      this.log('  2. Monitor experiment metrics:')
      this.log(`     heroku xp:watch --app ${parentApp}`)
      this.log('')

    } catch (error: any) {
      cli.action.stop('✗')
      this.error(`Failed to start experiment: ${error.message}`)
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
