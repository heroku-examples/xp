import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import * as https from 'https'
import * as http from 'http'
import {
  SimplifiedExperimentsConfig,
  AnyExperimentsConfig,
  parseExperimentsConfig,
  isSimplifiedConfig,
  migrateToSimplified,
  createEmptySimplifiedConfig,
} from '../../types/experiment'

interface MetricCounters {
  durationSum: number
  durationCount: number
  total200: number
  totalErrors: number
  timestamp: number
}

interface ExperimentMetrics {
  [key: string]: string
  experiment: string
  branch: string
  avgResponseTime: string
  errorRate: string
  throughput: string
}

export default class Watch extends Command {
  static description = 'Monitor experiment performance metrics in real-time'

  static examples = [
    `$ heroku xp:watch --app xp-demo-staging`,
    `$ heroku xp:watch -a prod-app`,
  ]

  static flags: any = {
    app: flags.app({required: true}),
    remote: flags.remote(),
  }

  private previousCounters: Map<string, MetricCounters> = new Map()
  private isRunning = false

  async run() {
    const {flags} = await this.parse(Watch)
    const appName = flags.app!

    this.isRunning = true

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      this.isRunning = false
      this.log('\n\nStopping watch...')
      process.exit(0)
    })

    try {
      while (this.isRunning) {
        await this.fetchAndDisplayMetrics(appName)

        if (this.isRunning) {
          // Wait 15 seconds before next update
          await this.sleep(15000)
        }
      }
    } catch (error: any) {
      this.error(`Failed to watch experiments: ${error.message}`)
    }
  }

  private async fetchAndDisplayMetrics(appName: string) {
    try {
      // Fetch experiment configuration
      const experimentsConfig = await this.getExperimentsConfig(appName)

      if (experimentsConfig.experiments.length === 0) {
        console.clear()
        this.log('\nNo experiments configured.\n')
        return
      }

      // Fetch metrics for each experiment
      const metricsPromises = experimentsConfig.experiments.map(exp =>
        this.fetchExperimentMetrics(exp.appName, exp.branch, exp.url)
      )

      const metricsResults = await Promise.all(metricsPromises)

      // Clear screen and display
      console.clear()
      this.log(`\nExperiment Metrics - ${appName}`)
      this.log(`Last updated: ${new Date().toLocaleTimeString()}\n`)

      // Display table
      cli.table(metricsResults, {
        experiment: {
          header: 'Experiment',
          minWidth: 25,
        },
        branch: {
          header: 'Branch',
          minWidth: 20,
        },
        avgResponseTime: {
          header: 'Avg Response',
          minWidth: 15,
        },
        errorRate: {
          header: 'Error %',
          minWidth: 10,
        },
        throughput: {
          header: 'Throughput',
          minWidth: 12,
        },
      })

      this.log('\nPress Ctrl+C to exit\n')
    } catch (error: any) {
      console.clear()
      this.log(`\nError fetching metrics: ${error.message}`)
      this.log('Retrying in 15 seconds...\n')
    }
  }

  private async fetchExperimentMetrics(
    appName: string,
    branch: string,
    baseUrl: string
  ): Promise<ExperimentMetrics> {
    try {
      const metricsUrl = `${baseUrl}/.dyno-proxy/metrics/`
      const metricsText = await this.fetchUrl(metricsUrl)

      const routerLabel = `${appName}-experiment@file`
      const metrics = this.parsePrometheusMetrics(metricsText, routerLabel)

      if (!metrics) {
        return {
          experiment: appName,
          branch,
          avgResponseTime: 'N/A',
          errorRate: 'N/A',
          throughput: 'N/A',
        }
      }

      // Calculate average response time
      const avgResponseTime = metrics.durationCount > 0
        ? ((metrics.durationSum / metrics.durationCount) * 1000).toFixed(2) + ' ms'
        : 'N/A'

      // Calculate error rate
      const totalRequests = metrics.total200 + metrics.totalErrors
      const errorRate = totalRequests > 0
        ? ((metrics.totalErrors / totalRequests) * 100).toFixed(2) + '%'
        : '0.00%'

      // Calculate throughput (requests per second)
      let throughput = 'N/A'
      const key = appName
      const previous = this.previousCounters.get(key)

      if (previous) {
        const timeDiff = (metrics.timestamp - previous.timestamp) / 1000 // seconds
        const requestDiff = (metrics.total200 - previous.total200) +
                           (metrics.totalErrors - previous.totalErrors)

        if (timeDiff > 0) {
          const rps = requestDiff / timeDiff
          throughput = rps >= 0 ? rps.toFixed(2) + ' req/s' : '0.00 req/s'
        }
      }

      // Store current counters for next iteration
      this.previousCounters.set(key, metrics)

      return {
        experiment: appName,
        branch,
        avgResponseTime,
        errorRate,
        throughput,
      }
    } catch (error: any) {
      return {
        experiment: appName,
        branch,
        avgResponseTime: 'Error',
        errorRate: 'Error',
        throughput: 'Error',
      }
    }
  }

  private parsePrometheusMetrics(text: string, routerLabel: string): MetricCounters | null {
    const lines = text.split('\n')
    const metrics: Partial<MetricCounters> = {
      durationSum: 0,
      durationCount: 0,
      total200: 0,
      totalErrors: 0,
      timestamp: Date.now(),
    }

    const metricRegex = /^(\w+)\{([^}]+)\}\s+([\d.e+-]+)$/

    for (const line of lines) {
      // Skip comments and empty lines
      if (line.startsWith('#') || !line.trim()) {
        continue
      }

      const match = line.match(metricRegex)
      if (!match) {
        continue
      }

      const [, metricName, labelsStr, valueStr] = match
      const value = parseFloat(valueStr)

      // Parse labels
      const labels = this.parseLabels(labelsStr)

      if (labels.router !== routerLabel) {
        continue
      }

      // Extract relevant metrics
      if (metricName === 'traefik_router_request_duration_seconds_sum') {
        metrics.durationSum = value
      } else if (metricName === 'traefik_router_request_duration_seconds_count') {
        metrics.durationCount = value
      } else if (metricName === 'traefik_router_requests_total') {
        if (labels.code === '200') {
          metrics.total200 = value
        } else if (labels.code && (labels.code.startsWith('4') || labels.code.startsWith('5'))) {
          metrics.totalErrors = (metrics.totalErrors || 0) + value
        }
      }
    }

    // Return null if no metrics found
    if (metrics.durationCount === 0 && metrics.total200 === 0 && metrics.totalErrors === 0) {
      return null
    }

    return metrics as MetricCounters
  }

  private parseLabels(labelsStr: string): {[key: string]: string} {
    const labels: {[key: string]: string} = {}
    const pairs = labelsStr.match(/(\w+)="([^"]*)"/g)

    if (pairs) {
      for (const pair of pairs) {
        const match = pair.match(/(\w+)="([^"]*)"/)
        if (match) {
          labels[match[1]] = match[2]
        }
      }
    }

    return labels
  }

  private fetchUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http

      protocol.get(url, res => {
        let data = ''

        res.on('data', chunk => {
          data += chunk
        })

        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data)
          } else {
            reject(new Error(`HTTP ${res.statusCode}: Failed to fetch metrics`))
          }
        })
      }).on('error', err => {
        reject(err)
      })
    })
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
