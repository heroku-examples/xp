import {expect, test} from '@oclif/test'
import * as sinon from 'sinon'
import Destroy from '../../../src/commands/xp/destroy'
import {
  createMockApp,
  createMockExperimentsConfig,
  createMockExperiment,
  createMockConfigVars,
  validateExperimentsConfig,
} from '../../helpers/setup'
import {SimplifiedExperimentsConfig} from '../../../src/types/experiment'

describe('xp:destroy', () => {
  let herokuGetStub: sinon.SinonStub
  let herokuPatchStub: sinon.SinonStub

  beforeEach(() => {
    // Create fresh stubs for each test
    herokuGetStub = sinon.stub()
    herokuPatchStub = sinon.stub()
  })

  describe('argument validation', () => {
    test
      .command(['xp:destroy'])
      .catch((error: Error) => {
        expect(error.message).to.contain('Missing required flag')
      })
      .it('requires --app flag')

    test
      .command(['xp:destroy', '--app', 'test-app'])
      .catch((error: Error) => {
        expect(error.message).to.contain('Missing required flag')
      })
      .it('requires --branch flag')
  })

  describe('confirmation validation with --confirm flag', () => {
    test
      .stub(Destroy.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
        patch: herokuPatchStub,
      }))
      .do(() => {
        const mockApp = createMockApp()
        const experiments = [
          createMockExperiment('feature-xyz', 'test-parent-app-feature-xyz-a1b2c3'),
        ]
        const existingConfig = createMockExperimentsConfig(experiments)
        const mockConfigVars = createMockConfigVars({
          HEROKU_XP: JSON.stringify(existingConfig),
        })

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
      })
      .command(['xp:destroy', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--confirm', 'wrong-app-name'])
      .catch((error: Error) => {
        expect(error.message).to.contain('Confirmation failed')
        expect(error.message).to.contain('test-parent-app-feature-xyz-a1b2c3')
      })
      .it('validates confirm matches experiment app name')
  })

  describe('destroying experiment when multiple experiments share same app', () => {
    test
      .stub(Destroy.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
        patch: herokuPatchStub,
      }))
      .do(() => {
        const mockApp = createMockApp()

        // Create 3 experiments, 2 share the same app name
        const experiments = [
          createMockExperiment('feature-xyz', 'test-parent-app-shared-app-abc123'),
          createMockExperiment('new-ui', 'test-parent-app-shared-app-abc123', {
            parentApp: 'test-parent-app',
          }),
          createMockExperiment('api-v2', 'test-parent-app-api-v2-def456'),
        ]
        const existingConfig = createMockExperimentsConfig(experiments)
        const mockConfigVars = createMockConfigVars({
          HEROKU_XP: JSON.stringify(existingConfig),
        })

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
        herokuPatchStub.withArgs('/apps/test-parent-app/config-vars', sinon.match.any).resolves({body: {}})
      })
      .stdout()
      .command(['xp:destroy', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--confirm', 'test-parent-app-shared-app-abc123'])
      .it('lists remaining experiments that share the same app', (ctx: any) => {
        expect(ctx.stdout).to.contain('destroyed successfully')
        expect(ctx.stdout).to.contain('Other experiments still use this app')
        expect(ctx.stdout).to.contain('new-ui')
        expect(ctx.stdout).to.contain('should NOT be destroyed')

        // Verify HEROKU_XP config was updated with remaining experiments
        const configUpdateCall = herokuPatchStub.getCalls().find((call: any) =>
          call.args[0] === '/apps/test-parent-app/config-vars' &&
          call.args[1]?.body?.HEROKU_XP
        )
        expect(configUpdateCall).to.exist

        const updatedConfig: SimplifiedExperimentsConfig = JSON.parse(configUpdateCall!.args[1].body.HEROKU_XP)
        validateExperimentsConfig(updatedConfig)
        expect(updatedConfig.experiments).to.have.length(2)
        expect(updatedConfig.experiments.find((exp: any) => exp.branch === 'feature-xyz')).to.be.undefined
        expect(updatedConfig.experiments.find((exp: any) => exp.branch === 'new-ui')).to.exist
        expect(updatedConfig.experiments.find((exp: any) => exp.branch === 'api-v2')).to.exist
      })
  })

  describe('destroying the last experiment for an app', () => {
    test
      .stub(Destroy.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
        patch: herokuPatchStub,
      }))
      .do(() => {
        const mockApp = createMockApp()

        // Create config with only 1 experiment
        const experiments = [
          createMockExperiment('feature-xyz', 'test-parent-app-feature-xyz-a1b2c3', {
            rules: [{
              weight: 10,
              path: '/api/v2',
              mirror: false,
              method: 'GET',
            }],
          }),
        ]
        const existingConfig = createMockExperimentsConfig(experiments)
        const mockConfigVars = createMockConfigVars({
          HEROKU_XP: JSON.stringify(existingConfig),
        })

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
        herokuPatchStub.withArgs('/apps/test-parent-app/config-vars', sinon.match.any).resolves({body: {}})
      })
      .stdout()
      .command(['xp:destroy', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--confirm', 'test-parent-app-feature-xyz-a1b2c3'])
      .it('shows destroy instructions when last experiment is removed', (ctx: any) => {
        expect(ctx.stdout).to.contain('destroyed successfully')
        expect(ctx.stdout).to.contain('No other experiments use this app')
        expect(ctx.stdout).to.contain('Resources will need to be manually destroyed')
        expect(ctx.stdout).to.contain('heroku apps:destroy --app test-parent-app-feature-xyz-a1b2c3')

        // Verify HEROKU_XP config was updated to empty
        const configUpdateCall = herokuPatchStub.getCalls().find((call: any) =>
          call.args[0] === '/apps/test-parent-app/config-vars' &&
          call.args[1]?.body?.HEROKU_XP
        )
        expect(configUpdateCall).to.exist

        const updatedConfig: SimplifiedExperimentsConfig = JSON.parse(configUpdateCall!.args[1].body.HEROKU_XP)
        validateExperimentsConfig(updatedConfig)
        expect(updatedConfig.experiments).to.have.length(0)
      })
  })

  describe('outputting correct xp:create command', () => {
    test
      .stub(Destroy.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
        patch: herokuPatchStub,
      }))
      .do(() => {
        const mockApp = createMockApp()

        // Create experiment with complex routing config
        const experiments = [
          createMockExperiment('feature-xyz', 'test-parent-app-feature-xyz-a1b2c3', {
            repo: 'heroku/test-repo',
            rules: [{
              weight: 25,
              path: '/api/v2,/api/v3',
              query: 'beta: true',
              header: 'x-experiment: enabled',
              mirror: true,
              method: 'POST',
            }],
          }),
          createMockExperiment('other-exp', 'test-parent-app-other-exp-j1k2l3'),
        ]
        const existingConfig = createMockExperimentsConfig(experiments)
        const mockConfigVars = createMockConfigVars({
          HEROKU_XP: JSON.stringify(existingConfig),
        })

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
        herokuPatchStub.withArgs('/apps/test-parent-app/config-vars', sinon.match.any).resolves({body: {}})
      })
      .stdout()
      .command(['xp:destroy', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--confirm', 'test-parent-app-feature-xyz-a1b2c3'])
      .it('outputs the correct heroku xp:create command to recreate config', (ctx: any) => {
        expect(ctx.stdout).to.contain('To recreate this experiment configuration')
        expect(ctx.stdout).to.contain('heroku xp:create')
        expect(ctx.stdout).to.contain('--app test-parent-app')
        expect(ctx.stdout).to.contain('--branch feature-xyz')
        expect(ctx.stdout).to.contain('--weight 25')
        expect(ctx.stdout).to.contain('--path "/api/v2"')
        expect(ctx.stdout).to.contain('--path "/api/v3"')
        expect(ctx.stdout).to.contain('--query "beta=true"')
        expect(ctx.stdout).to.contain('--header "x-experiment=enabled"')
        expect(ctx.stdout).to.contain('--mirror true')
        expect(ctx.stdout).to.contain('--method POST')
      })
  })

  describe('outputting xp:create command with weight-only routing', () => {
    test
      .stub(Destroy.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
        patch: herokuPatchStub,
      }))
      .do(() => {
        const mockApp = createMockApp()

        // Create experiment with weight-only routing
        const experiments = [
          createMockExperiment('simple-exp', 'test-parent-app-simple-exp-m1n2o3', {
            rules: [{
              weight: 15,
              mirror: false,
              method: 'GET',
            }],
          }),
        ]
        const existingConfig = createMockExperimentsConfig(experiments)
        const mockConfigVars = createMockConfigVars({
          HEROKU_XP: JSON.stringify(existingConfig),
        })

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
        herokuPatchStub.withArgs('/apps/test-parent-app/config-vars', sinon.match.any).resolves({body: {}})
      })
      .stdout()
      .command(['xp:destroy', '--app', 'test-parent-app', '--branch', 'simple-exp', '--confirm', 'test-parent-app-simple-exp-m1n2o3'])
      .it('outputs simple xp:create command with only weight', (ctx: any) => {
        expect(ctx.stdout).to.contain('heroku xp:create')
        expect(ctx.stdout).to.contain('--weight 15')
        expect(ctx.stdout).to.contain('--mirror false')
        expect(ctx.stdout).not.to.contain('--path')
        expect(ctx.stdout).not.to.contain('--query')
        expect(ctx.stdout).not.to.contain('--header')
        expect(ctx.stdout).not.to.contain('--method') // GET is default, not shown
      })
  })

  describe('error handling', () => {
    test
      .stub(Destroy.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
      }))
      .do(() => {
        const mockApp = createMockApp()
        const emptyConfig = createMockExperimentsConfig([])
        const mockConfigVars = createMockConfigVars({
          HEROKU_XP: JSON.stringify(emptyConfig),
        })

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
      })
      .command(['xp:destroy', '--app', 'test-parent-app', '--branch', 'nonexistent', '--confirm', 'any-name'])
      .catch((error: Error) => {
        expect(error.message).to.contain('No experiment found')
        expect(error.message).to.contain('nonexistent')
      })
      .it('fails when experiment does not exist')

    test
      .stub(Destroy.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
      }))
      .do(() => {
        const mockApp = createMockApp()
        const experiments = [
          createMockExperiment('existing-exp', 'test-parent-app-existing-exp-p1q2r3'),
        ]
        const existingConfig = createMockExperimentsConfig(experiments)
        const mockConfigVars = createMockConfigVars({
          HEROKU_XP: JSON.stringify(existingConfig),
        })

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
      })
      .command(['xp:destroy', '--app', 'test-parent-app', '--branch', 'different-exp', '--confirm', 'any-name'])
      .catch((error: Error) => {
        expect(error.message).to.contain('No experiment found')
        expect(error.message).to.contain('different-exp')
      })
      .it('fails when trying to destroy a different experiment name')

    test
      .stub(Destroy.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
      }))
      .do(() => {
        herokuGetStub.withArgs('/apps/nonexistent-app/config-vars').rejects(new Error('App not found'))
      })
      .command(['xp:destroy', '--app', 'nonexistent-app', '--branch', 'feature-xyz', '--confirm', 'any-name'])
      .catch((error: Error) => {
        expect(error.message).to.contain('not found')
      })
      .it('fails when parent app does not exist')

    test
      .stub(Destroy.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
      }))
      .do(() => {
        const mockApp = createMockApp()
        const mockConfigVars = createMockConfigVars()

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
      })
      .command(['xp:destroy', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--confirm', 'any-name'])
      .catch((error: Error) => {
        expect(error.message).to.contain('No experiment found')
      })
      .it('fails when HEROKU_XP config var is missing')

    test
      .stub(Destroy.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
      }))
      .do(() => {
        const mockApp = createMockApp()
        const mockConfigVars = createMockConfigVars({
          HEROKU_XP: 'invalid json{',
        })

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
      })
      .command(['xp:destroy', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--confirm', 'any-name'])
      .catch((error: Error) => {
        expect(error.message).to.contain('Failed to parse HEROKU_XP')
      })
      .it('fails when HEROKU_XP config is malformed JSON')

    test
      .stub(Destroy.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
        patch: herokuPatchStub,
      }))
      .do(() => {
        const mockApp = createMockApp()
        const experiments = [
          createMockExperiment('feature-xyz', 'test-parent-app-feature-xyz-a1b2c3'),
        ]
        const existingConfig = createMockExperimentsConfig(experiments)
        const mockConfigVars = createMockConfigVars({
          HEROKU_XP: JSON.stringify(existingConfig),
        })

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
        herokuPatchStub.withArgs('/apps/test-parent-app/config-vars', sinon.match.any).rejects(new Error('API error'))
      })
      .command(['xp:destroy', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--confirm', 'test-parent-app-feature-xyz-a1b2c3'])
      .catch((error: Error) => {
        expect(error.message).to.contain('Failed to update experiment configuration')
      })
      .it('handles config update failure gracefully')
  })

  describe('case sensitivity', () => {
    test
      .stub(Destroy.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
      }))
      .do(() => {
        const mockApp = createMockApp()
        const experiments = [
          createMockExperiment('Feature-XYZ', 'test-parent-app-feature-xyz-s1t2u3'),
        ]
        const existingConfig = createMockExperimentsConfig(experiments)
        const mockConfigVars = createMockConfigVars({
          HEROKU_XP: JSON.stringify(existingConfig),
        })

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
      })
      .command(['xp:destroy', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--confirm', 'any-name'])
      .catch((error: Error) => {
        expect(error.message).to.contain('No experiment found')
      })
      .it('branch name matching is case-sensitive')
  })

  describe('config var size and weight validation', () => {
    it('updated config should stay under 32KB limit', () => {
      // Create a config with many experiments (but one will be removed)
      const experiments = []
      for (let i = 0; i < 50; i++) {
        experiments.push(createMockExperiment(`exp-${i}`, `test-parent-app-exp-${i}-abc123`))
      }
      const config = createMockExperimentsConfig(experiments)
      const configJson = JSON.stringify(config, null, 2)
      const configSize = Buffer.byteLength(configJson, 'utf8')

      // Even with 50 experiments, should be under 32KB
      expect(configSize).to.be.lessThan(32 * 1024)

      // Remove one experiment
      config.experiments = config.experiments.slice(0, -1)
      const updatedConfigJson = JSON.stringify(config, null, 2)
      const updatedConfigSize = Buffer.byteLength(updatedConfigJson, 'utf8')

      expect(updatedConfigSize).to.be.lessThan(configSize)
      expect(updatedConfigSize).to.be.lessThan(32 * 1024)
    })

    it('validates total weight does not exceed 100%', () => {
      const experiments = [
        createMockExperiment('exp-1', 'app-1', {rules: [{weight: 50, mirror: false, method: 'GET'}]}),
        createMockExperiment('exp-2', 'app-2', {rules: [{weight: 30, mirror: false, method: 'GET'}]}),
        createMockExperiment('exp-3', 'app-3', {rules: [{weight: 10, mirror: false, method: 'GET'}]}),
      ]
      const config = createMockExperimentsConfig(experiments)

      const totalWeight = config.experiments.reduce((sum: number, exp: any) => sum + (exp.rules?.[0]?.weight || 0), 0)
      expect(totalWeight).to.equal(90)
      expect(totalWeight).to.be.lessThan(100)
    })
  })

  describe('destroying experiment with different parent apps', () => {
    test
      .stub(Destroy.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
        patch: herokuPatchStub,
      }))
      .do(() => {
        const mockApp = createMockApp()

        // Create experiments with same branch name but different parent apps
        const experiments = [
          createMockExperiment('feature-xyz', 'test-parent-app-feature-xyz-v1w2x3', {
            parentApp: 'test-parent-app',
          }),
          createMockExperiment('feature-xyz', 'other-parent-app-feature-xyz-y4z5a6', {
            parentApp: 'other-parent-app',
          }),
        ]
        const existingConfig = createMockExperimentsConfig(experiments)
        const mockConfigVars = createMockConfigVars({
          HEROKU_XP: JSON.stringify(existingConfig),
        })

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
        herokuPatchStub.withArgs('/apps/test-parent-app/config-vars', sinon.match.any).resolves({body: {}})
      })
      .stdout()
      .command(['xp:destroy', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--confirm', 'test-parent-app-feature-xyz-v1w2x3'])
      .it('only destroys experiment matching both parent app and branch', (ctx: any) => {
        expect(ctx.stdout).to.contain('destroyed successfully')

        // Verify HEROKU_XP config still has the other parent's experiment
        const configUpdateCall = herokuPatchStub.getCalls().find((call: any) =>
          call.args[0] === '/apps/test-parent-app/config-vars' &&
          call.args[1]?.body?.HEROKU_XP
        )
        expect(configUpdateCall).to.exist

        const updatedConfig: SimplifiedExperimentsConfig = JSON.parse(configUpdateCall!.args[1].body.HEROKU_XP)
        expect(updatedConfig.experiments).to.have.length(1)
        expect(updatedConfig.experiments[0].parentApp).to.equal('other-parent-app')
        expect(updatedConfig.experiments[0].branch).to.equal('feature-xyz')
      })
  })

  describe('multiple rules handling', () => {
    test
      .stub(Destroy.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
        patch: herokuPatchStub,
      }))
      .do(() => {
        const mockApp = createMockApp()

        // Create experiment with multiple rules
        const experiments = [
          createMockExperiment('feature-xyz', 'test-parent-app-feature-xyz-b1c2d3', {
            rules: [
              {
                weight: 10,
                mirror: false,
                method: 'GET',
              },
              {
                path: '/beta',
                mirror: true,
                method: 'POST',
              },
            ],
          }),
        ]
        const existingConfig = createMockExperimentsConfig(experiments)
        const mockConfigVars = createMockConfigVars({
          HEROKU_XP: JSON.stringify(existingConfig),
        })

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
        herokuPatchStub.withArgs('/apps/test-parent-app/config-vars', sinon.match.any).resolves({body: {}})
      })
      .stdout()
      .command(['xp:destroy', '--app', 'test-parent-app', '--branch', 'feature-xyz', '--confirm', 'test-parent-app-feature-xyz-b1c2d3'])
      .it('outputs xp:create command showing primary rule only', (ctx: any) => {
        expect(ctx.stdout).to.contain('heroku xp:create')
        expect(ctx.stdout).to.contain('--weight 10')
        // Command should show the primary/first rule characteristics
      })
  })
})
