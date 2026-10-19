import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import {
  ExperimentsConfig,
} from '../../types/experiment'
import {readExperimentsConfig, writeExperimentsConfig} from '../../utils/experiments-config'

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
      let experimentsConfig: ExperimentsConfig
      try {
        experimentsConfig = await readExperimentsConfig(this.heroku, parentApp, {required: true})
        cli.action.stop('✓')
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Step 2: Find experiment by branch
      cli.action.start(`Finding experiment for branch "${branch}"`)
      const experimentIndex = experimentsConfig.experiments.findIndex(
        exp => exp.branch === branch
      )

      if (experimentIndex === -1) {
        cli.action.stop('✗')
        throw new Error(`No experiment found for branch "${branch}" on app "${parentApp}"`)
      }

      const experiment = experimentsConfig.experiments[experimentIndex]
      cli.action.stop('✓')

      // Step 3: Check if already active
      if (experiment.active !== false) {
        this.log(`\nExperiment "${branch}" is already active.`)
        return
      }

      // Step 4: Remove active: false flag
      cli.action.start('Activating experiment')
      delete experiment.active

      // Update the config
      experimentsConfig.experiments[experimentIndex] = experiment

      try {
        await writeExperimentsConfig(this.heroku, parentApp, experimentsConfig)
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
      this.log(`  Branch:       ${branch}`)
      this.log(`  Parent:       ${parentApp}`)
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

}
