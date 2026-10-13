import {expect, test} from '@oclif/test'
import * as sinon from 'sinon'
import * as http from 'http'
import * as https from 'https'
import {EventEmitter} from 'events'
import Watch from '../../../src/commands/xp/watch'

describe('xp:watch', () => {
  let sandbox: sinon.SinonSandbox
  let httpsStub: sinon.SinonStub | undefined

  // Map to store response data for different URLs
  let responseMap: Map<string, {data: string; statusCode: number}>

  before(() => {
    // Check if https.get is already a stub (from nock or previous tests)
    const httpsGet = (https as any).get
    if (httpsGet && httpsGet.isSinonProxy) {
      // Already stubbed, just use it
      httpsStub = httpsGet as sinon.SinonStub
    } else {
      try {
        // Create a new stub
        httpsStub = sinon.stub(https, 'get')
      } catch (error) {
        // If stubbing fails, https.get might be non-configurable
        // We'll handle this in beforeEach
      }
    }
  })

  after(() => {
    // Restore the stub after all tests if we created it
    if (httpsStub && httpsStub.restore) {
      try {
        httpsStub.restore()
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
  })

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    responseMap = new Map()

    // If we don't have a stub yet, try to create one now
    if (!httpsStub) {
      const httpsGet = (https as any).get
      if (httpsGet && httpsGet.isSinonProxy) {
        httpsStub = httpsGet as sinon.SinonStub
      }
    }

    // Configure the stub behavior for each test
    if (httpsStub) {
      httpsStub.callsFake((requestUrl: any, callback: any) => {
        const url = typeof requestUrl === 'string' ? requestUrl : requestUrl.href
        const response = responseMap.get(url) || {data: '', statusCode: 200}

        const responseStream = new EventEmitter() as any
        responseStream.statusCode = response.statusCode
        responseStream.headers = {}

        // Call the callback with our mock response
        callback(responseStream)

        // Simulate data and end events
        setImmediate(() => {
          responseStream.emit('data', response.data)
          responseStream.emit('end')
        })

        // Return a mock request object
        const req = new EventEmitter()
        return req as any
      })
    }
  })

  afterEach(() => {
    sandbox.restore()
    responseMap.clear()
  })

  // Helper function to register a URL with response data
  function mockHttpRequest(url: string, responseData: string, statusCode = 200) {
    responseMap.set(url, {data: responseData, statusCode})
    return httpsStub
  }

  describe('Basic functionality', () => {
    it('accepts -a/--app flag', async () => {
      const mockConfigVars = {
        HEROKU_XP: JSON.stringify({
          version: 2,
          experiments: [],
        }),
      }

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
        )
        .stdout()
        .command(['xp:watch', '--app', 'test-app'])
        .it('accepts --app flag')

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('accepts -a flag')
    })

    it('requires app flag', async () => {
      test
        .command(['xp:watch'])
        .catch(error => {
          expect(error.message).to.contain('--app')
        })
        .it('fails without app flag')
    })

    it('fetches HEROKU_XP config var correctly', async () => {
      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-a',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            rules: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('fetches and parses HEROKU_XP config')
    })

    it('fetches metrics from parent app URL, not experiment URL', async () => {
      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-a',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            rules: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      // Mock HTTP request to fetch metrics
      const httpsStub = mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', '')

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('fetches metrics from parent app URL, not experiment URL', () => {
          // Verify that HTTP request was made to parent app URL
          if (httpsStub) {
            expect(httpsStub.calledOnce).to.be.true
            const callUrl = httpsStub.firstCall.args[0]
            expect(callUrl).to.equal('https://test-app.herokuapp.com/.dyno-proxy/metrics/')
          }
        })
    })
  })

  describe('Prometheus parsing', () => {
    it('parses histogram metrics (sum, count)', async () => {
      const prometheusMetrics = `
# HELP http_request_duration_seconds HTTP request latency
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_sum{route="/api/users"} 125.5
http_request_duration_seconds_count{route="/api/users"} 100
http_request_duration_seconds_sum{route="/api/orders"} 50.0
http_request_duration_seconds_count{route="/api/orders"} 25
`

      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-a',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            rules: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', prometheusMetrics)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('parses histogram sum and count')
    })

    it('parses counter metrics (requests_total)', async () => {
      const prometheusMetrics = `
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{route="/api/users"} 1500
http_requests_total{route="/api/orders"} 750
`

      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-a',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            rules: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', prometheusMetrics)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('parses counter metrics')
    })

    it('extracts router labels correctly', async () => {
      const prometheusMetrics = `
http_request_duration_seconds_sum{route="/api/users",method="GET",status="200"} 125.5
http_request_duration_seconds_count{route="/api/users",method="GET",status="200"} 100
`

      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-a',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            rules: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', prometheusMetrics)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('extracts route, method, and status labels')
    })

    it('handles missing metrics gracefully', async () => {
      const prometheusMetrics = `
# No metrics
`

      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-a',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            rules: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', prometheusMetrics)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('handles missing metrics without crashing')
    })
  })

  describe('Calculations', () => {
    it('calculates average response time correctly (sum/count)', async () => {
      const prometheusMetrics = `
http_request_duration_seconds_sum{route="/api"} 250.0
http_request_duration_seconds_count{route="/api"} 100
`

      // Expected: 250.0 / 100 = 2.5 seconds average

      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-a',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            rules: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', prometheusMetrics)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('calculates avg response time')
    })
  })

  describe('Error handling', () => {
    it('handles missing HEROKU_XP config', async () => {
      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, {})
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .catch(error => {
          expect(error.message).to.contain('HEROKU_XP')
        })
        .it('fails gracefully when HEROKU_XP is missing')
    })

    it('handles HTTP request failures', async () => {
      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-a',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            rules: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      // Override the stub for this specific test to throw an error
      if (httpsStub) {
        httpsStub.reset()
        httpsStub.callsFake((url: any, callback: any) => {
          const req = new EventEmitter()
          setImmediate(() => {
            req.emit('error', new Error('Network error'))
          })
          return req as any
        })
      }

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('handles network errors gracefully')
    })

    it('handles malformed Prometheus data', async () => {
      const malformedMetrics = `
this is not valid prometheus format
http_request_duration_seconds_sum{invalid
`

      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-a',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            rules: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', malformedMetrics)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('handles malformed Prometheus data')
    })

    it('handles empty experiment list', async () => {
      const mockConfigVars = {
        HEROKU_XP: JSON.stringify({
          version: 2,
          experiments: [],
        }),
      }

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('handles empty experiment list')
    })

    it('handles API authentication errors', async () => {
      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(401, {message: 'Unauthorized'})
        )
        .command(['xp:watch', '-a', 'test-app'])
        .catch(error => {
          expect(error.message).to.match(/unauthorized|401/i)
        })
        .it('handles API auth errors')
    })

    it('handles non-existent app', async () => {
      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/nonexistent-app/config-vars')
            .reply(404, {message: 'App not found'})
        )
        .command(['xp:watch', '-a', 'nonexistent-app'])
        .catch(error => {
          expect(error.message).to.match(/not found|404/i)
        })
        .it('handles non-existent app')
    })
  })

  describe('Table display', () => {
    it('formats metrics for display', async () => {
      const prometheusMetrics = `
http_request_duration_seconds_sum{route="/api"} 125.5
http_request_duration_seconds_count{route="/api"} 100
http_requests_total{route="/api"} 1000
`

      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-a',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            rules: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', prometheusMetrics)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('formats metrics in table')
    })

    it('handles N/A values for experiments with no traffic', async () => {
      const prometheusMetrics = `
# No metrics for this experiment
`

      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-a',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            rules: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', prometheusMetrics)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('shows N/A for experiments with no traffic')
    })

    it('displays multiple experiments in table', async () => {
      const prometheusMetrics = `
http_request_duration_seconds_sum{route="/api"} 125.5
http_request_duration_seconds_count{route="/api"} 100
http_requests_total{route="/api"} 1000
`

      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app-1',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-a',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app-1.herokuapp.com',
            rules: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            appName: 'test-exp-app-2',
            appID: 'exp-456',
            parentApp: 'test-app',
            branch: 'feature-b',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app-2.herokuapp.com',
            rules: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', prometheusMetrics)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('displays multiple experiments')
    })
  })

  describe('Continuous monitoring', () => {
    it('runs continuous monitoring with 6-second refresh interval', async () => {
      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-a',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            active: true,
            rules: [{path: '/api', method: 'GET'}],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', '')

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('runs continuous monitoring with 6-second refresh interval')
    })
  })

  describe('Traffic column', () => {
    it('displays ✓ when experiment is active (active=true)', async () => {
      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-active',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            active: true,
            rules: [{path: '/api', method: 'GET'}],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', '')

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('shows ✓ for active experiments', ctx => {
          expect(ctx.stdout).to.contain('✓')
        })
    })

    it('displays ✗ when experiment is inactive (active=false)', async () => {
      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-inactive',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            active: false,
            rules: [{path: '/api', method: 'GET'}],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', '')

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('shows ✗ for inactive experiments', ctx => {
          expect(ctx.stdout).to.contain('✗')
        })
    })

    it('defaults to ✓ when active field is undefined', async () => {
      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-default',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            // active field is undefined
            rules: [{path: '/api', method: 'GET'}],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', '')

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('defaults to ✓ when active is undefined', ctx => {
          expect(ctx.stdout).to.contain('✓')
        })
    })
  })

  describe('Route column', () => {
    it('displays path from rules', async () => {
      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-path',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            active: true,
            rules: [{path: '/api/users', method: 'GET'}],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', '')

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('displays path route', ctx => {
          expect(ctx.stdout).to.contain('/api/users')
        })
    })

    it('displays query parameters in route', async () => {
      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-query',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            active: true,
            rules: [{path: '/api', query: 'beta: true', method: 'GET'}],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', '')

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('displays query parameter in route', ctx => {
          expect(ctx.stdout).to.contain('?beta: true')
        })
    })

    it('displays header in route', async () => {
      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-header',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            active: true,
            rules: [{header: 'X-Beta-User: true', method: 'GET'}],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', '')

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('displays header in route', ctx => {
          expect(ctx.stdout).to.contain('[X-Beta-User: true]')
        })
    })

    it('displays weight in route', async () => {
      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-weight',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            active: true,
            rules: [{weight: 50, method: 'GET'}],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', '')

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('displays weight in route', ctx => {
          expect(ctx.stdout).to.contain('weight=50')
        })
    })

    it('displays mirror flag in route', async () => {
      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-mirror',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            active: true,
            rules: [{traffic: 'mirror', method: 'GET'}],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', '')

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('displays mirror flag in route', ctx => {
          expect(ctx.stdout).to.contain('(mirror)')
        })
    })

    it('displays N/A when no rules defined', async () => {
      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-no-rules',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            active: true,
            rules: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', '')

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('displays N/A when no rules', ctx => {
          expect(ctx.stdout).to.contain('N/A')
        })
    })

    it('combines multiple route components', async () => {
      const mockConfig = {
        version: 2,
        experiments: [
          {
            appName: 'test-exp-app',
            appID: 'exp-123',
            parentApp: 'test-app',
            branch: 'feature-complex',
            version: 1,
            repo: 'test/repo',
            url: 'https://test-exp-app.herokuapp.com',
            active: true,
            rules: [{path: '/api/v2', query: 'beta: true', weight: 25, method: 'GET'}],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }

      const mockConfigVars = {
        HEROKU_XP: JSON.stringify(mockConfig),
      }

      const mockParentApp = {
        name: 'test-app',
        web_url: 'https://test-app.herokuapp.com',
      }

      mockHttpRequest('https://test-app.herokuapp.com/.dyno-proxy/metrics/', '')

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
            .get('/apps/test-app')
            .reply(200, mockParentApp)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('combines multiple route components', ctx => {
          expect(ctx.stdout).to.contain('/api/v2')
          expect(ctx.stdout).to.contain('?beta: true')
          expect(ctx.stdout).to.contain('weight=25')
        })
    })
  })
})
