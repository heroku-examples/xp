import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import {
  ExperimentsConfig,
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
    confirm: flags.string({
      char: 'c',
      description: 'Confirmation string (the branch name) to skip interactive prompt',
    }),
  }

  async run() {
    const {flags} = await this.parse(Destroy)
    const parentApp = flags.app!
    const branch = flags.branch

    try {
      // Step 1: Fetch HEROKU_XP config
      cli.action.start('Fetching experiment configuration')
      let experimentsConfig: ExperimentsConfig
      try {
        experimentsConfig = await readExperimentsConfig(this.heroku, parentApp)
        cli.action.stop('✓')
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Step 2: Find the experiment to destroy
      cli.action.start(`Finding experiment for branch "${branch}"`)
      const experiment = findExperimentByBranch(experimentsConfig, branch)

      if (!experiment) {
        cli.action.stop('✗')
        this.error(`No experiment found for branch "${branch}" on app "${parentApp}".\nRun 'heroku xp:list --app ${parentApp}' to see all experiments.`)
        return
      }

      cli.action.stop('✓')

      // Step 3: Confirm destruction (unless --confirm flag provided)
      if (!flags.confirm) {
        this.log('')
        this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        this.log('⚠️  WARNING: This will destroy the following experiment:')
        this.log('')
        this.log(`  Parent App:     ${parentApp}`)
        this.log(`  Branch:         ${branch}`)
        this.log('')
        this.log('This action will:')
        this.log('  1. Remove the experiment from HEROKU_XP configuration')
        this.log('  2. Stop routing traffic to the experiment app')
        this.log('')
        this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        this.log('')

        const confirmation = await cli.prompt(`Type the branch name "${branch}" to confirm`, {
          required: true,
        })

        if (confirmation !== branch) {
          this.error('Confirmation failed. Experiment was not destroyed.')
          return
        }
      } else if (flags.confirm !== branch) {
        this.error(`Confirmation failed: expected "${branch}" but got "${flags.confirm}"`)
        return
      }

      // Step 4: Remove experiment from config
      cli.action.start('Removing experiment from configuration')
      try {
        // Filter out the experiment
        const originalCount = experimentsConfig.experiments.length
        experimentsConfig.experiments = experimentsConfig.experiments.filter(
          exp => exp.branch !== branch
        )

        if (experimentsConfig.experiments.length === originalCount) {
          cli.action.stop('✗')
          this.error('Failed to remove experiment from configuration (not found in array)')
          return
        }

        // Update the config
        await writeExperimentsConfig(this.heroku, parentApp, experimentsConfig)
        cli.action.stop('✓')
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Step 5: Display results
      this.log('')
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      this.log('✓ Experiment destroyed successfully!')
      this.log('')
      this.log(`  Parent App:     ${parentApp}`)
      this.log(`  Branch:         ${branch}`)
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      this.log('')

      // Step 6: Show recreate command
      this.log('To recreate this experiment configuration, run:')
      this.log('')
      this.log(this.buildRecreateCommand(experiment, parentApp))
      this.log('')

    } catch (error: any) {
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
        parts.push(`--methods ${rule.method}`)
      }
    }

    return `  ${parts.join(' ')}`
  }
}
