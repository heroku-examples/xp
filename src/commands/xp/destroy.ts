import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import {
  ExperimentEntry,
  findExperimentByBranch,
} from '../../types/experiment'
import {readExperimentsConfig, writeExperimentsConfig} from '../../utils/experiments-config'

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
  }

  async run() {
    const {flags} = await this.parse(Destroy)
    const parentApp = flags.app!
    const branch = flags.branch

    try {
      cli.action.start('Destroying experiment')
      const experimentsConfig = await readExperimentsConfig(this.heroku, parentApp)
      const experiment = findExperimentByBranch(experimentsConfig, branch)

      if (!experiment) {
        cli.action.stop('✗')
        this.error(`No experiment found for branch "${branch}" on app "${parentApp}".\nRun 'heroku xp:list --app ${parentApp}' to see all experiments.`)
        return
      }

      experimentsConfig.experiments = experimentsConfig.experiments.filter(exp => exp.branch !== branch)
      await writeExperimentsConfig(this.heroku, parentApp, experimentsConfig)
      cli.action.stop('')

      // Display results
      this.log('')
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      this.log('✓ Experiment destroyed successfully!')
      this.log('')
      this.log(`  Parent App:     ${parentApp}`)
      this.log(`  Branch:         ${branch}`)
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      this.log('')

      // Show recreate command
      this.log('To recreate this experiment configuration, run:')
      this.log('')
      this.log(this.buildRecreateCommand(experiment, parentApp))
      this.log('')

    } catch (error: any) {
      cli.action.stop('✗')
      this.error(`Failed to destroy experiment: ${error.message}`)
    }
  }

  private buildRecreateCommand(experiment: ExperimentEntry, parentApp: string): string {
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
        parts.push(`--path "${rule.path}"`)
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

      if (rule.methods && rule.methods !== 'GET') {
        parts.push(`--methods ${rule.methods}`)
      }
    }

    return `  ${parts.join(' ')}`
  }
}
