import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
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
      cli.action.start('Starting experiment')
      const experimentsConfig = await readExperimentsConfig(this.heroku, parentApp, {required: true})
      const experiment = experimentsConfig.experiments.find(exp => exp.branch === branch)

      if (!experiment) {
        throw new Error(`No experiment found for branch "${branch}" on app "${parentApp}"`)
      }

      if (experiment.active !== false) {
        cli.action.stop('')
        this.log(`\nExperiment "${branch}" is already active.`)
        return
      }

      delete experiment.active
      await writeExperimentsConfig(this.heroku, parentApp, experimentsConfig)
      cli.action.stop('')

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
