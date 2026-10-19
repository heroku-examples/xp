import {Command, flags} from '@heroku-cli/command'
import {cli} from 'cli-ux'
import * as https from 'https'
import * as http from 'http'
import {
  ExperimentEntry,
} from '../../types/experiment'
import {readExperimentsConfig} from '../../utils/experiments-config'

interface MetricCounters {
  durationSum: number
  durationCount: number
  total200: number
  total2xx: number
  total3xx: number
  total4xx: number
  total5xx: number
  totalErrors: number
  timestamp: number
}

interface ExperimentMetrics {
  [key: string]: string
  experiment: string
  branch: string
  active: string
  avgResponseTime: string
  total2xx: string
  total3xx: string
  total4xx: string
  total5xx: string
}

export default class Watch extends Command {
  static description = 'Monitor experiment performance metrics in real-time'

  static examples = [
    `$ heroku xp:watch --app my-app-staging`,
    `$ heroku xp:watch -a my-app-staging`,
  ]

  static flags: any = {
    app: flags.app({required: true}),
    remote: flags.remote(),
  }

  private isRunning = false
  private currentMetrics?: {
    appName: string
    results: ExperimentMetrics[]
    timestamp: Date
  }

  async run() {
    const {flags} = await this.parse(Watch)
    const appName = flags.app!

    this.isRunning = true

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      this.isRunning = false
      cli.action.stop('')
      this.log('\n\nStopping watch...')
      process.exit(0)
    })

    try {
      while (this.isRunning) {
        await this.fetchAndDisplayMetrics(appName)

        if (this.isRunning) {
          // Wait 6 seconds before next update with countdown
          await this.sleepWithCountdown(6000)
        }
      }
    } catch (error: any) {
      this.error(`Failed to watch experiments: ${error.message}`)
    }
  }

  private async fetchAndDisplayMetrics(appName: string) {
    try {
      // Fetch experiment configuration
      const experimentsConfig = await readExperimentsConfig(this.heroku, appName)

      if (experimentsConfig.experiments.length === 0) {
        console.clear()
        this.log('\nNo experiments configured.\n')
        return
      }

      // Fetch parent app info to get web_url and app ID
      const {body: parentApp} = await this.heroku.get<{web_url?: string; id?: string}>(`/apps/${appName}`)
      const parentWebUrl = parentApp.web_url
      const parentAppId = parentApp.id

      if (!parentWebUrl) {
        throw new Error(`Parent app ${appName} has no web_url`)
      }

      if (!parentAppId) {
        throw new Error(`Parent app ${appName} has no id`)
      }

      // Basic auth for /.dyno-proxy/metrics, from the credentials xp:create stored
      const {metrics_user: user, metrics_secret: secret} = experimentsConfig
      const auth = user && secret ? `${user}:${secret}` : undefined

      // Fetch metrics for each experiment using parent app URL
      const metricsPromises = experimentsConfig.experiments.map(exp => {
        return this.fetchExperimentMetrics(exp, parentWebUrl, auth)
      })

      const metricsResults = await Promise.all(metricsPromises)

      // Fetch control (parent app) metrics
      const controlMetrics = await this.fetchControlMetrics(appName, parentAppId, parentWebUrl, auth)
      metricsResults.push(controlMetrics)

      // Store metrics results for redrawing during countdown
      this.currentMetrics = {
        appName,
        results: metricsResults,
        timestamp: new Date(),
      }

      // Initial draw with full dots (6)
      this.redrawDisplay(6)
    } catch (error: any) {
      console.clear()
      this.log(`\nError fetching metrics: ${error.message}`)
      this.log('Retrying in 6 seconds...\n')
    }
  }

  private async fetchControlMetrics(
    appName: string,
    appId: string,
    parentWebUrl: string,
    auth?: string
  ): Promise<ExperimentMetrics> {
    try {
      const metricsUrl = `${parentWebUrl}.dyno-proxy/metrics/`
      const metricsText = await this.fetchUrl(metricsUrl, auth)

      // Try both router labels and combine metrics
      const routerLabel1 = 'app@file'  // Local app instance
      const routerLabel2 = `${appId}-control@file`  // Control router

      const metrics1 = this.parsePrometheusMetrics(metricsText, routerLabel1)
      const metrics2 = this.parsePrometheusMetrics(metricsText, routerLabel2)

      // Combine metrics from both router labels
      const metrics = this.combineMetrics(metrics1, metrics2)

      if (!metrics) {
        return {
          experiment: appName,
          branch: appName,
          active: '✓ live',
          avgResponseTime: '',
          total2xx: '0',
          total3xx: '0',
          total4xx: '0',
          total5xx: '0',
        }
      }

      const pct = this.percentOf(metrics)

      // Calculate average response time (just the number, no units)
      const avgResponseTime = metrics.durationCount > 0
        ? ((metrics.durationSum / metrics.durationCount) * 1000).toFixed(0)
        : ''

      return {
        experiment: appName,
        branch: appName,
        active: '✓ live',
        avgResponseTime,
        total2xx: pct(metrics.total2xx),
        total3xx: pct(metrics.total3xx),
        total4xx: pct(metrics.total4xx),
        total5xx: pct(metrics.total5xx),
      }
    } catch (error: any) {
      return {
        experiment: appName,
        branch: appName,
        active: '✓ live',
        avgResponseTime: '',
        total2xx: '0',
        total3xx: '0',
        total4xx: '0',
        total5xx: '0',
      }
    }
  }

  private async fetchExperimentMetrics(
    exp: ExperimentEntry,
    parentWebUrl: string,
    auth?: string
  ): Promise<ExperimentMetrics> {
    try {
      const {routeID, branch, active, rules} = exp

      // Format active status with mirror/live indicator
      const isMirror = rules && rules.length > 0 && rules[0].traffic === 'mirror'
      const mode = isMirror ? 'mirror' : 'live'
      const activeStatus = active === false ? '✗' : `✓ ${mode}`

      const metricsUrl = `${parentWebUrl}.dyno-proxy/metrics/`
      const metricsText = await this.fetchUrl(metricsUrl, auth)

      const routerLabel = `${routeID}-experiment@file`
      const metrics = this.parsePrometheusMetrics(metricsText, routerLabel)

      if (!metrics) {
        return {
          experiment: routeID,
          branch,
          active: activeStatus,
          avgResponseTime: '',
          total2xx: '0',
          total3xx: '0',
          total4xx: '0',
          total5xx: '0',
        }
      }

      const pct = this.percentOf(metrics)

      // Calculate average response time (just the number, no units)
      const avgResponseTime = metrics.durationCount > 0
        ? ((metrics.durationSum / metrics.durationCount) * 1000).toFixed(0)
        : ''

      return {
        experiment: routeID,
        branch,
        active: activeStatus,
        avgResponseTime,
        total2xx: pct(metrics.total2xx),
        total3xx: pct(metrics.total3xx),
        total4xx: pct(metrics.total4xx),
        total5xx: pct(metrics.total5xx),
      }
    } catch (error: any) {
      const {routeID, branch, active, rules} = exp
      const isMirror = rules && rules.length > 0 && rules[0].traffic === 'mirror'
      const mode = isMirror ? 'mirror' : 'live'
      return {
        experiment: routeID,
        branch,
        active: active === false ? '✗' : `✓ ${mode}`,
        avgResponseTime: 'Error',
        total2xx: '0',
        total3xx: '0',
        total4xx: '0',
        total5xx: '0',
      }
    }
  }

  // Formats a status-class count as a share of all 2xx-5xx responses.
  private percentOf(metrics: MetricCounters): (count: number) => string {
    const total = metrics.total2xx + metrics.total3xx + metrics.total4xx + metrics.total5xx
    return count => (total > 0 ? `${((count / total) * 100).toFixed(0)}%` : '0%')
  }

  private combineMetrics(metrics1: MetricCounters | null, metrics2: MetricCounters | null): MetricCounters | null {
    if (!metrics1 && !metrics2) {
      return null
    }

    if (!metrics1) return metrics2
    if (!metrics2) return metrics1

    // Combine metrics by summing counters and averaging durations
    return {
      durationSum: metrics1.durationSum + metrics2.durationSum,
      durationCount: metrics1.durationCount + metrics2.durationCount,
      total200: metrics1.total200 + metrics2.total200,
      total2xx: metrics1.total2xx + metrics2.total2xx,
      total3xx: metrics1.total3xx + metrics2.total3xx,
      total4xx: metrics1.total4xx + metrics2.total4xx,
      total5xx: metrics1.total5xx + metrics2.total5xx,
      totalErrors: metrics1.totalErrors + metrics2.totalErrors,
      timestamp: Math.max(metrics1.timestamp, metrics2.timestamp),
    }
  }

  private parsePrometheusMetrics(text: string, routerLabel: string): MetricCounters | null {
    const lines = text.split('\n')

    const metrics: Partial<MetricCounters> = {
      durationSum: 0,
      durationCount: 0,
      total200: 0,
      total2xx: 0,
      total3xx: 0,
      total4xx: 0,
      total5xx: 0,
      totalErrors: 0,
      timestamp: Date.now(),
    }

    const metricRegex = /^(\w+)\{([^}]+)\}\s+([\d.e+-]+)$/

    for (const line of lines) {
      // Skip comments and empty lines
      if (line.startsWith('#')) {
        continue
      }
      if (!line.trim()) {
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

      // For service metrics, check the 'service' label; for router metrics, check 'router' label
      // Service label matches router label directly (both use -experiment@file suffix)
      const isMatch = labels.router === routerLabel || labels.service === routerLabel

      if (!isMatch) {
        continue
      }

      // Extract relevant metrics
      // Use traefik_service metrics instead of traefik_router to get actual backend timing
      if (metricName === 'traefik_service_request_duration_seconds_sum') {
        metrics.durationSum = (metrics.durationSum || 0) + value
      } else if (metricName === 'traefik_service_request_duration_seconds_count') {
        metrics.durationCount = (metrics.durationCount || 0) + value
      } else if (metricName === 'traefik_service_requests_total') {
        if (labels.code === '200') {
          metrics.total200 = (metrics.total200 || 0) + value
        }

        // Categorize by status code family
        if (labels.code && labels.code.startsWith('2')) {
          metrics.total2xx = (metrics.total2xx || 0) + value
        } else if (labels.code && labels.code.startsWith('3')) {
          metrics.total3xx = (metrics.total3xx || 0) + value
        } else if (labels.code && labels.code.startsWith('4')) {
          metrics.total4xx = (metrics.total4xx || 0) + value
          metrics.totalErrors = (metrics.totalErrors || 0) + value
        } else if (labels.code && labels.code.startsWith('5')) {
          metrics.total5xx = (metrics.total5xx || 0) + value
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

  private fetchUrl(url: string, auth?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http

      const req = protocol.get(url, {auth}, res => {
        let data = ''
        res.on('data', chunk => {
          data += chunk
        })

        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data)
          } else {
            const error = `HTTP ${res.statusCode}: Failed to fetch metrics`
            reject(new Error(error))
          }
        })
      })

      req.on('error', err => {
        reject(err)
      })
    })
  }

  private redrawDisplay(dotsRemaining: number) {
    if (!this.currentMetrics) return

    const {appName, results, timestamp} = this.currentMetrics

    // Clear screen and redraw with updated dots
    console.clear()
    this.log(`\nExperiment Metrics - ${appName}`)
    this.log(`Last updated: ${timestamp.toLocaleTimeString()} ${'.'.repeat(dotsRemaining)}\n`)

    // Display table with columns: Traffic, Branch, Avg ms, 2xx, 3xx, 4xx, 5xx (as % of responses)
    cli.table(results, {
      active: {
        header: 'Traffic',
        minWidth: 15,
      },
      branch: {
        header: 'Branch',
        minWidth: 20,
      },
      avgResponseTime: {
        header: 'Avg ms',
        minWidth: 10,
      },
      total2xx: {
        header: '2xx',
        minWidth: 8,
      },
      total3xx: {
        header: '3xx',
        minWidth: 8,
      },
      total4xx: {
        header: '4xx',
        minWidth: 8,
      },
      total5xx: {
        header: '5xx',
        minWidth: 8,
      },
    })

    this.log('')
  }

  private async sleepWithCountdown(ms: number): Promise<void> {
    const totalSeconds = Math.floor(ms / 1000)

    // Use cli.action spinner with "Press Ctrl+C to exit" text
    cli.action.start('Press Ctrl+C to exit')

    // Countdown: redraw display with decreasing dots every second
    for (let remaining = totalSeconds; remaining > 0; remaining--) {
      // Redraw the display with remaining dots
      this.redrawDisplay(remaining)

      // Wait 1 second
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Check if we should stop early
      if (!this.isRunning) {
        cli.action.stop('')
        return
      }
    }

    // Stop spinner without showing "done" message
    cli.action.stop('')
  }
}
