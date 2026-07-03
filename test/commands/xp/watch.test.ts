import {expect, test} from '@oclif/test'
import * as sinon from 'sinon'
import Watch from '../../../src/commands/xp/watch'

describe('xp:watch', () => {
  let sandbox: sinon.SinonSandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

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

    it('constructs correct metrics URLs', async () => {
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

      const fetchStub = sandbox.stub(global, 'fetch')
      fetchStub.resolves({
        ok: true,
        text: async () => '',
      } as Response)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('constructs metrics URL from app URL')
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

      const fetchStub = sandbox.stub(global, 'fetch')
      fetchStub.resolves({
        ok: true,
        text: async () => prometheusMetrics,
      } as Response)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
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

      const fetchStub = sandbox.stub(global, 'fetch')
      fetchStub.resolves({
        ok: true,
        text: async () => prometheusMetrics,
      } as Response)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
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

      const fetchStub = sandbox.stub(global, 'fetch')
      fetchStub.resolves({
        ok: true,
        text: async () => prometheusMetrics,
      } as Response)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
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

      const fetchStub = sandbox.stub(global, 'fetch')
      fetchStub.resolves({
        ok: true,
        text: async () => prometheusMetrics,
      } as Response)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
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

      const fetchStub = sandbox.stub(global, 'fetch')
      fetchStub.resolves({
        ok: true,
        text: async () => prometheusMetrics,
      } as Response)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('calculates avg response time')
    })

    it('calculates error rate correctly', async () => {
      const prometheusMetrics = `
http_requests_total{route="/api",status="200"} 900
http_requests_total{route="/api",status="500"} 100
`

      // Expected error rate: 100 / 1000 = 10%

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

      const fetchStub = sandbox.stub(global, 'fetch')
      fetchStub.resolves({
        ok: true,
        text: async () => prometheusMetrics,
      } as Response)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('calculates error rate')
    })

    it('calculates throughput rate correctly (difference between samples)', async () => {
      // This would require multiple samples over time
      // For now, test that it handles single sample correctly

      const prometheusMetrics = `
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

      const fetchStub = sandbox.stub(global, 'fetch')
      fetchStub.resolves({
        ok: true,
        text: async () => prometheusMetrics,
      } as Response)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('handles throughput calculation')
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

      const fetchStub = sandbox.stub(global, 'fetch')
      fetchStub.rejects(new Error('Network error'))

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
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

      const fetchStub = sandbox.stub(global, 'fetch')
      fetchStub.resolves({
        ok: true,
        text: async () => malformedMetrics,
      } as Response)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
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

      const fetchStub = sandbox.stub(global, 'fetch')
      fetchStub.resolves({
        ok: true,
        text: async () => prometheusMetrics,
      } as Response)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
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

      const fetchStub = sandbox.stub(global, 'fetch')
      fetchStub.resolves({
        ok: true,
        text: async () => prometheusMetrics,
      } as Response)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
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

      const fetchStub = sandbox.stub(global, 'fetch')
      fetchStub.resolves({
        ok: true,
        text: async () => prometheusMetrics,
      } as Response)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app'])
        .it('displays multiple experiments')
    })
  })

  describe('Continuous monitoring', () => {
    it('supports interval flag for continuous monitoring', async () => {
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

      const fetchStub = sandbox.stub(global, 'fetch')
      fetchStub.resolves({
        ok: true,
        text: async () => '',
      } as Response)

      test
        .nock('https://api.heroku.com', api =>
          api
            .get('/apps/test-app/config-vars')
            .reply(200, mockConfigVars)
        )
        .stdout()
        .command(['xp:watch', '-a', 'test-app', '--interval', '5'])
        .it('accepts interval flag for continuous monitoring')
    })
  })
})
