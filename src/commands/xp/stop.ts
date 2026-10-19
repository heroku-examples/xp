import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import {
  findExperimentByBranch,
} from '../../types/experiment'
import {readExperimentsConfig, writeExperimentsConfig} from '../../utils/experiments-config'

export default class Stop extends Command {
  static description = 'Stop an experiment by setting active: false in HEROKU_XP configuration'

  static examples = [
    `$ heroku xp:stop --app my-app-staging --branch feature-xyz`,
    `$ heroku xp:stop -a my-app-staging -b new-ui`,
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
      cli.action.start('Stopping experiment')
      const experimentsConfig = await readExperimentsConfig(this.heroku, parentApp)
      const experiment = findExperimentByBranch(experimentsConfig, branch)

      if (!experiment) {
        cli.action.stop('✗')
        this.error(`No experiment found for branch "${branch}" on app "${parentApp}".\nRun 'heroku xp:list --app ${parentApp}' to see all experiments.`)
        return
      }

      if (experiment.active === false) {
        cli.action.stop('')
        this.log('')
        this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        this.log('ℹ️  Experiment is already inactive')
        this.log('')
        this.log(`  Parent App:     ${parentApp}`)
        this.log(`  Branch:         ${branch}`)
        this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        this.log('')
        return
      }

      experiment.active = false
      await writeExperimentsConfig(this.heroku, parentApp, experimentsConfig)
      cli.action.stop('')

      // Display results
      this.log('')
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      this.log('✓ Experiment stopped successfully!')
      this.log('')
      this.log(`  Parent App:     ${parentApp}`)
      this.log(`  Branch:         ${branch}`)
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
      cli.action.stop('✗')
      this.error(`Failed to stop experiment: ${error.message}`)
    }
  }

}
