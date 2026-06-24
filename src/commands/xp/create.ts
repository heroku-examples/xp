import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import * as crypto from 'crypto'
import {
  SimplifiedExperimentsConfig,
  SimplifiedExperimentEntry,
  AnyExperimentsConfig,
  parseExperimentsConfig,
  isSimplifiedConfig,
  migrateToSimplified,
  createEmptySimplifiedConfig,
  findExperimentByKey,
} from '../../types/experiment'

export default class Create extends Command {
  static description = 'Create a new experiment app with traffic routing'

  static examples = [
    `$ heroku xp:create --app prod-app --branch feature-xyz`,
    `$ heroku xp:create --app prod-app --branch new-ui --weight 10`,
    `$ heroku xp:create --app prod-app --branch api-v2 --path /api/v2`,
  ]

  static flags: any = {
    app: flags.app({required: true}),
    remote: flags.remote(),
    branch: flags.string({
      char: 'b',
      description: 'GitHub branch name for the experiment',
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
    region: flags.string({
      description: 'Heroku region',
    }),
    stack: flags.string({
      description: 'Heroku stack',
    }),
  }

  async run() {
    const {flags} = await this.parse(Create)
    const parentApp = flags.app!
    const branch = flags.branch

    try {
      // Step 1: Validate arguments
      cli.action.start('Validating arguments')
      this.validateArguments(branch, flags)
      cli.action.stop('✓')

      // Step 2: Get parent app attributes via Heroku API
      cli.action.start('Fetching parent app details')
      let parentAppData
      try {
        parentAppData = await this.getAppDetails(parentApp)
        cli.action.stop(`✓ Found app: ${parentAppData.name}`)
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Step 3: Check for heroku-xp buildpack (add if missing)
      cli.action.start('Checking for heroku-xp buildpack')
      try {
        await this.ensureXpBuildpack(parentApp)
        cli.action.stop('✓ Buildpack configured')
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Step 4: Verify GitHub repo connection
      cli.action.start('Verifying GitHub repository connection')
      let repoData
      try {
        repoData = await this.verifyGitHubRepo(parentAppData.id)
        cli.action.stop(`✓ Connected to ${repoData.repo}`)
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Step 5: Read HEROKU_XP config var and check for existing experiment
      cli.action.start('Reading experiment configuration')
      let experimentsConfig: SimplifiedExperimentsConfig
      let isUpdate = false
      let existingExperiment: SimplifiedExperimentEntry | undefined
      try {
        experimentsConfig = await this.getExperimentsConfig(parentApp)

        // Check if experiment with same parentApp+branch already exists (composite key)
        existingExperiment = findExperimentByKey(experimentsConfig, parentApp, branch)
        if (existingExperiment) {
          isUpdate = true
          cli.action.stop(`✓ Found existing experiment (will update, version ${existingExperiment.version})`)
        } else {
          cli.action.stop('✓ Configuration loaded (new experiment)')
        }
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Step 7: Check if parent app is in a pipeline
      cli.action.start('Checking pipeline configuration')
      let pipelineCoupling
      try {
        pipelineCoupling = await this.getPipelineCoupling(parentAppData.id)
        if (pipelineCoupling) {
          cli.action.stop(`✓ Found pipeline: ${pipelineCoupling.pipeline.name}`)
        } else {
          cli.action.stop('✓ No pipeline')
        }
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Step 8: Create or reuse experiment app
      const experimentAppName = existingExperiment?.appName || this.generateAppName(branch, parentApp)
      let newAppData

      if (isUpdate) {
        // Reuse existing app
        cli.action.start(`Using existing experiment app: ${experimentAppName}`)
        try {
          newAppData = await this.getAppDetails(experimentAppName)
          cli.action.stop(`✓ Found existing app: ${experimentAppName}`)
        } catch (error: any) {
          cli.action.stop('✗')
          throw error
        }
      } else {
        // Create new experiment app via apps API
        cli.action.start(`Creating experiment app for branch "${branch}"`)
        try {
          newAppData = await this.createApp(
            experimentAppName,
            parentAppData,
            branch,
            flags
          )
          cli.action.stop(`✓ Created app: ${experimentAppName}`)
        } catch (error: any) {
          cli.action.stop('✗')
          throw error
        }
      }

      // Step 9: Copy buildpacks from parent app (skip if updating)
      if (!isUpdate) {
        cli.action.start('Configuring buildpacks')
        try {
          await this.copyBuildpacks(parentAppData.name, experimentAppName)
          cli.action.stop('✓ Buildpacks configured')
        } catch (error: any) {
          cli.action.stop('✗')
          throw error
        }
      }

      // Step 10: Copy config vars from parent app
      cli.action.start('Copying configuration variables')
      try {
        await this.copyConfigVars(parentAppData.name, experimentAppName, branch)
        cli.action.stop('✓ Config vars copied')
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Step 11: Add to pipeline if parent app is in one (skip if updating)
      if (pipelineCoupling && !isUpdate) {
        cli.action.start(`Adding to pipeline: ${pipelineCoupling.pipeline.name}`)
        try {
          await this.addToPipeline(newAppData.id, pipelineCoupling.pipeline.id, pipelineCoupling.stage)
          cli.action.stop(`✓ Added to ${pipelineCoupling.stage} stage`)
        } catch (error: any) {
          cli.action.stop('✗')
          throw error
        }
      }

      // Step 12: Attach GitHub repo via kolkrabbi API (skip if updating)
      if (!isUpdate) {
        cli.action.start('Attaching GitHub repository')
        try {
          await this.attachGitHubRepo(newAppData.id, repoData.repo)
          cli.action.stop('✓ Repository attached')
        } catch (error: any) {
          cli.action.stop('✗')
          throw error
        }
      }

      // Step 13: Enable auto-deploy for the branch
      cli.action.start(`Enabling auto-deploy for branch "${branch}"`)
      try {
        await this.enableAutoDeploy(newAppData.id, branch)
        cli.action.stop('✓ Auto-deploy enabled')
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Step 13a: Trigger initial push
      cli.action.start(`Triggering initial deploy for branch "${branch}"`)
      try {
        await this.triggerPush(newAppData.id, branch)
        cli.action.stop('✓ Deploy triggered')
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Step 14: Wait for app to boot and respond (skip if updating)
      if (!isUpdate) {
        cli.action.start('Waiting for app to boot')
        try {
          await this.waitForAppBoot(experimentAppName)
          cli.action.stop('✓ App is ready')
        } catch (error: any) {
          cli.action.stop('✗')
          throw error
        }
      }

      // Step 15: Update HEROKU_XP config var
      cli.action.start(isUpdate ? 'Updating experiment configuration' : 'Adding experiment configuration')
      try {
        const newExperiment = this.buildSimplifiedExperimentEntry(
          parentApp,
          experimentAppName,
          newAppData.id,
          branch,
          repoData.repo,
          newAppData.web_url,
          existingExperiment,
          flags
        )

        if (isUpdate) {
          // Replace existing experiment
          const index = experimentsConfig.experiments.findIndex(
            exp => exp.parentApp === parentApp && exp.branch === branch
          )
          if (index !== -1) {
            experimentsConfig.experiments[index] = newExperiment
          }
        } else {
          // Add new experiment
          experimentsConfig.experiments.push(newExperiment)
        }

        await this.updateExperimentsConfig(parentApp, experimentsConfig)
        cli.action.stop(isUpdate ? '✓ Configuration updated' : '✓ Configuration added')
      } catch (error: any) {
        cli.action.stop('✗')
        throw error
      }

      // Success message
      this.log('')
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      this.log(`✓ Experiment ${isUpdate ? 'updated' : 'created'} successfully!`)
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      this.log('')
      this.log(`  App:          ${experimentAppName}`)
      this.log(`  Branch:       ${branch}`)
      this.log(`  Parent:       ${parentApp}`)
      this.log(`  Version:      ${existingExperiment ? existingExperiment.version + 1 : 1}`)
      if (flags.weight) {
        this.log(`  Weight:       ${flags.weight}%`)
      }
      if (flags.path) {
        this.log(`  Paths:        ${flags.path.join(', ')}`)
      }
      this.log('')
      this.log('Next steps:')
      this.log('')
      this.log('  1. Deploy parent app to activate routing:')
      this.log(`     git commit --allow-empty -m "${isUpdate ? 'Update' : 'Activate'} experiment: ${branch}"`)
      this.log(`     git push heroku main`)
      this.log('')
      this.log('  2. View all experiments:')
      this.log(`     heroku xp:list --app ${parentApp}`)
      this.log('')

    } catch (error: any) {
      // Stop any running spinner
      cli.action.stop('✗')
      this.error(`Failed to create experiment: ${error.message}`)
    }
  }

  private validateArguments(branch: string, flags: any): void {
    // Validate branch name
    if (!/^[a-zA-Z0-9-_./]+$/.test(branch)) {
      throw new Error('Branch name contains invalid characters')
    }

    // Validate weight if provided
    if (flags.weight !== undefined) {
      if (flags.weight < 0 || flags.weight > 100) {
        throw new Error('Weight must be between 0 and 100')
      }
    }

    // Validate query parameters format
    if (flags.query) {
      for (const query of flags.query) {
        if (!query.includes('=')) {
          throw new Error(`Invalid query parameter format: "${query}". Use format: key=value`)
        }
      }
    }

    // Validate header format
    if (flags.header) {
      for (const header of flags.header) {
        if (!header.includes('=')) {
          throw new Error(`Invalid header format: "${header}". Use format: key=value`)
        }
      }
    }
  }

  private async getAppDetails(appName: string): Promise<any> {
    try {
      const {body: app} = await this.heroku.get(`/apps/${appName}`)
      return app
    } catch (error: any) {
      if (error.statusCode === 404) {
        throw new Error(`App "${appName}" not found`)
      }
      throw new Error(`Failed to fetch app details: ${error.message}`)
    }
  }

  private async ensureXpBuildpack(appName: string): Promise<void> {
    try {
      // Get current buildpacks
      const {body: buildpacks} = await this.heroku.get(`/apps/${appName}/buildpack-installations`)
      const buildpacksArray = buildpacks as any[]

      // Check if heroku-xp buildpack exists
      const xpBuildpackUrl = 'https://dyno-proxy-buildpack-staging-2ca242c0008d.herokuapp.com/buildpack-v1alpha1.tgz'
      const hasXpBuildpack = buildpacksArray.some((bp: any) =>
        bp.buildpack.url === xpBuildpackUrl ||
        bp.buildpack.url.includes('dyno-proxy-buildpack') ||
        bp.buildpack.url.includes('heroku-buildpack-experiments')
      )

      if (!hasXpBuildpack) {
        // Add the buildpack at the end
        try {
          await this.heroku.put(`/apps/${appName}/buildpack-installations`, {
            body: {
              updates: [
                ...buildpacksArray.map((bp: any, index: number) => ({
                  buildpack: bp.buildpack.url,
                  ordinal: index,
                })),
                {
                  buildpack: xpBuildpackUrl,
                  ordinal: buildpacksArray.length,
                },
              ],
            },
          })
        } catch (error: any) {
          throw new Error(`Unable to add heroku-xp buildpack: ${error.message}`)
        }
      }
    } catch (error: any) {
      throw new Error(`Failed to configure buildpacks: ${error.message}`)
    }
  }

  private async verifyGitHubRepo(appId: string): Promise<{repo: string; id: number}> {
    try {
      // Use kolkrabbi API (repositories-api) to check GitHub connection
      // Note: Kolkrabbi requires app UUID, not app name
      const kolkrabbiUrl = process.env.HEROKU_KOLKRABBI_URL || 'https://kolkrabbi.heroku.com'
      const {body: repoInfo} = await this.heroku.get(
        `${kolkrabbiUrl}/apps/${appId}/github`,
        {
          hostname: new URL(kolkrabbiUrl).hostname,
        }
      )
      const repoData = repoInfo as {repo?: string; id?: number}

      if (!repoData || !repoData.repo) {
        throw new Error('No GitHub repository connected')
      }

      return {
        repo: repoData.repo,
        id: repoData.id!,
      }
    } catch (error: any) {
      if (error.message.includes('No GitHub repository')) {
        throw error
      }
      throw new Error(`Failed to verify GitHub connection: ${error.message}. Ensure the app is connected to a GitHub repository.`)
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

  private generateAppName(branch: string, parentApp: string): string {
    // Generate app name: {parent-app-name}-xp-{branch}-{rand}
    // Max 30 chars for Heroku app names, only lowercase letters, numbers, and dashes
    // Priority: xp (min 3), rand (min 3), parent (min 3), branch (min 3)
    const rand = crypto.randomBytes(2).toString('hex') // 4 chars
    const xpMarker = 'xp' // 2 chars

    // Sanitize branch name: lowercase, replace invalid chars with dashes
    const sanitizedBranch = branch
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    // Calculate available space: 30 - 3 dashes - 2 (xp) = 25 chars for parent+branch+rand
    const dashes = 3
    const available = 30 - xpMarker.length - dashes

    // Minimum lengths (priority order: xp, rand, parent, branch)
    const minRand = 3
    const minParent = 3
    const minBranch = 3

    // Start with full lengths
    let parentLen = parentApp.length
    let branchLen = sanitizedBranch.length
    let randLen = rand.length

    const total = () => parentLen + branchLen + randLen

    // Trim in priority order: branch first, then parent, then rand
    if (total() > available) {
      const excess = total() - available
      // Try trimming branch first
      const branchTrim = Math.min(excess, Math.max(0, branchLen - minBranch))
      branchLen -= branchTrim

      if (total() > available) {
        // Still too long, trim parent
        const parentTrim = Math.min(total() - available, Math.max(0, parentLen - minParent))
        parentLen -= parentTrim

        if (total() > available) {
          // Still too long, trim rand (lowest priority)
          randLen = Math.max(minRand, randLen - (total() - available))
        }
      }
    }

    const appName = `${parentApp.slice(0, parentLen)}-${xpMarker}-${sanitizedBranch.slice(0, branchLen)}-${rand.slice(0, randLen)}`
    return appName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 30)
  }

  private async getPipelineCoupling(appId: string): Promise<any> {
    try {
      const {body: coupling} = await this.heroku.get(`/apps/${appId}/pipeline-couplings`)
      return coupling
    } catch (error: any) {
      // Not found means app is not in a pipeline
      if (error.statusCode === 404) {
        return null
      }
      throw error
    }
  }

  private async createApp(
    appName: string,
    parentApp: any,
    branch: string,
    flags: any
  ): Promise<any> {
    try {
      // Check if parent app is owned by a team
      const teamId = parentApp.team?.id || parentApp.organization?.id

      const payload: any = {
        name: appName,
        region: flags.region || parentApp.region?.name || parentApp.region,
        stack: flags.stack || parentApp.stack?.name || parentApp.stack,
      }

      // Use teams endpoint if parent app is owned by team
      if (teamId) {
        payload.team = teamId
        const {body: app} = await this.heroku.post('/teams/apps', {
          body: payload,
        })
        return app
      }

      // Otherwise use standard apps endpoint
      const {body: app} = await this.heroku.post('/apps', {
        body: payload,
      })
      return app
    } catch (error: any) {
      throw new Error(`Failed to create app: ${error.message}`)
    }
  }

  private async copyBuildpacks(parentAppName: string, experimentAppName: string): Promise<void> {
    try {
      // Get parent app buildpacks
      const {body: parentBuildpacks} = await this.heroku.get(
        `/apps/${parentAppName}/buildpack-installations`
      )
      const buildpacksArray = parentBuildpacks as any[]

      // Update buildpacks on experiment app
      const buildpackUpdates = buildpacksArray.map((bp: any) => ({
        buildpack: bp.buildpack.url,
      }))

      await this.heroku.put(`/apps/${experimentAppName}/buildpack-installations`, {
        body: {
          updates: buildpackUpdates,
        },
      })
    } catch (error: any) {
      throw new Error(`Failed to copy buildpacks: ${error.message}`)
    }
  }

  private async copyConfigVars(
    parentAppName: string,
    experimentAppName: string,
    branch: string
  ): Promise<void> {
    try {
      // Get parent app config vars
      const {body: parentConfigVars} = await this.heroku.get(
        `/apps/${parentAppName}/config-vars`
      )

      // Filter out sensitive config vars using comprehensive blocklist
      // Security: Block all vars that may contain secrets, keys, tokens, passwords, or credentials
      const sensitivePatterns = [
        /SECRET/i,
        /KEY/i,
        /TOKEN/i,
        /PASSWORD/i,
        /CREDENTIAL/i,
        /AWS_/i,
        /STRIPE_/i,
        /SENTRY_DSN/i,
        /^DATABASE_URL$/,
        /^REDIS_URL$/,
        /^HEROKU_XP$/,
        /API_KEY/i,
        /PRIVATE/i,
        /AUTH/i,
        /OAUTH/i,
      ]

      const configVarsToCopy: {[key: string]: string} = {
        HEROKU_EXPERIMENT_BRANCH: branch,
        HEROKU_EXPERIMENT_PARENT: parentAppName,
        HEROKU_EXPERIMENT_CREATED: new Date().toISOString(),
      }

      for (const [key, value] of Object.entries(parentConfigVars as Record<string, any>)) {
        // Skip if matches any sensitive pattern
        const isSensitive = sensitivePatterns.some(pattern => pattern.test(key))
        if (!isSensitive && typeof value === 'string') {
          configVarsToCopy[key] = value
        }
      }

      // Update config vars on experiment app
      await this.heroku.patch(`/apps/${experimentAppName}/config-vars`, {
        body: configVarsToCopy,
      })
    } catch (error: any) {
      throw new Error(`Failed to copy config vars: ${error.message}`)
    }
  }

  private async addToPipeline(appId: string, pipelineId: string, stage: string): Promise<void> {
    try {
      await this.heroku.post('/pipeline-couplings', {
        body: {
          app: appId,
          pipeline: pipelineId,
          stage: stage,
        },
      })
    } catch (error: any) {
      throw new Error(`Failed to add app to pipeline: ${error.message}`)
    }
  }

  private async attachGitHubRepo(appId: string, repoName: string): Promise<void> {
    try {
      // Kolkrabbi requires app UUID, not app name
      const kolkrabbiUrl = process.env.HEROKU_KOLKRABBI_URL || 'https://kolkrabbi.heroku.com'

      await this.heroku.post(
        `${kolkrabbiUrl}/apps/${appId}/github`,
        {
          hostname: new URL(kolkrabbiUrl).hostname,
          body: {
            repo: repoName,
          },
        }
      )
    } catch (error: any) {
      throw new Error(`Failed to attach GitHub repo: ${error.message}`)
    }
  }

  private async enableAutoDeploy(appId: string, branch: string): Promise<void> {
    try {
      // Kolkrabbi requires app UUID, not app name
      const kolkrabbiUrl = process.env.HEROKU_KOLKRABBI_URL || 'https://kolkrabbi.heroku.com'

      await this.heroku.patch(
        `${kolkrabbiUrl}/apps/${appId}/github`,
        {
          hostname: new URL(kolkrabbiUrl).hostname,
          body: {
            auto_deploy: true,
            branch: branch,
          },
        }
      )
    } catch (error: any) {
      throw new Error(`Failed to enable auto-deploy: ${error.message}`)
    }
  }

  private async triggerPush(appId: string, branch: string): Promise<void> {
    try {
      const kolkrabbiUrl = process.env.HEROKU_KOLKRABBI_URL || 'https://kolkrabbi.heroku.com'

      await this.heroku.post(
        `${kolkrabbiUrl}/apps/${appId}/github/push`,
        {
          hostname: new URL(kolkrabbiUrl).hostname,
          body: {
            branch: branch,
          },
        }
      )
    } catch (error: any) {
      throw new Error(`Failed to trigger push: ${error.message}`)
    }
  }

  private async waitForAppBoot(appName: string): Promise<void> {
    const maxAttempts = 30 // 2.5 minutes
    const pollInterval = 5000 // 5 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Check dyno formation
        const {body: formation} = await this.heroku.get(`/apps/${appName}`)
        const formationArray = formation as any[]

        const webDyno = formationArray.find((f: any) => f.type === 'web')
        if (webDyno && webDyno.quantity > 0) {
          // Check if app responds
          const {body: app} = await this.heroku.get(`/apps/${appName}`)
          const appData = app as {web_url?: string}
          if (appData.web_url) {
            // App is ready
            return
          }
        }
      } catch (error) {
        // Continue polling
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }

    // Don't fail if app doesn't boot immediately - it may still be deploying
    this.warn('Warning: App may still be booting. Check status with: heroku ps --app ' + appName)
  }

  private buildSimplifiedExperimentEntry(
    parentApp: string,
    experimentAppName: string,
    appID: string,
    branch: string,
    repo: string,
    url: string | undefined,
    existingExperiment: SimplifiedExperimentEntry | undefined,
    flags: any
  ): SimplifiedExperimentEntry {
    const now = new Date().toISOString()

    // Build rules array
    const rules: any[] = []

    // Create rule if any routing parameters exist
    const hasRoutingConfig = flags.weight !== undefined || flags.path || flags.query || flags.header || flags.method

    if (hasRoutingConfig) {
      const rule: any = {}

      // Mirror defaults to true if not specified
      rule.mirror = true

      if (flags.weight !== undefined) {
        rule.weight = flags.weight
      }

      // Convert path array to comma-separated string
      if (flags.path && Array.isArray(flags.path)) {
        rule.path = flags.path.join(',')
      }

      // Convert query array to string format "key: value"
      if (flags.query && Array.isArray(flags.query)) {
        // Take first query param for now (format: "key=value" -> "key: value")
        const [key, value] = flags.query[0].split('=')
        rule.query = `${key}: ${value}`
      }

      // Convert header array to string format "key: value"
      if (flags.header && Array.isArray(flags.header)) {
        // Take first header for now (format: "key=value" -> "key: value")
        const [key, value] = flags.header[0].split('=')
        rule.header = `${key}: ${value}`
      }

      if (flags.method) {
        rule.method = flags.method
      } else {
        rule.method = 'GET'  // Default method
      }

      rules.push(rule)
    }

    const entry: SimplifiedExperimentEntry = {
      appName: experimentAppName,
      appID,
      parentApp,
      branch,
      version: existingExperiment ? existingExperiment.version + 1 : 1,
      repo,
      url: url || '',
      rules,
      createdAt: existingExperiment?.createdAt || now,
      updatedAt: now,
    }

    return entry
  }

  private async updateExperimentsConfig(
    appName: string,
    config: SimplifiedExperimentsConfig
  ): Promise<void> {
    try {
      // Validate total weight doesn't exceed 100%
      const totalWeight = config.experiments
        .reduce((sum, exp) => sum + (exp.rules?.[0]?.weight || 0), 0)

      if (totalWeight > 100) {
        throw new Error(`Total experiment weight (${totalWeight}%) exceeds 100%`)
      }

      // Validate config size (max 32KB for Heroku config vars)
      const configJson = JSON.stringify(config)
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
