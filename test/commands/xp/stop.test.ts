import {expect, test} from '@oclif/test'
import * as sinon from 'sinon'
import Stop from '../../../src/commands/xp/stop'
import {
  createMockApp,
  createMockExperimentsConfig,
  createMockExperiment,
  createMockConfigVars,
  validateExperimentsConfig,
} from '../../helpers/setup'
import {SimplifiedExperimentsConfig} from '../../../src/types/experiment'

describe('xp:stop', () => {
  let herokuGetStub: sinon.SinonStub
  let herokuPatchStub: sinon.SinonStub

  beforeEach(() => {
    // Create fresh stubs for each test
    herokuGetStub = sinon.stub()
    herokuPatchStub = sinon.stub()
  })

  describe('argument validation', () => {
    test
      .command(['xp:stop'])
      .catch((error: Error) => {
        expect(error.message).to.contain('Missing required flag')
      })
      .it('requires --app flag')

    test
      .command(['xp:stop', '--app', 'test-app'])
      .catch((error: Error) => {
        expect(error.message).to.contain('Missing required flag')
      })
      .it('requires --branch flag')
  })

  describe('stopping an active experiment', () => {
    test
      .stub(Stop.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
        patch: herokuPatchStub,
      }))
      .do(() => {
        const mockApp = createMockApp()
        const experiments = [
          createMockExperiment('feature-xyz', 'test-parent-app-feature-xyz-a1b2c3', {
            active: true,
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
      .command(['xp:stop', '--app', 'test-parent-app', '--branch', 'feature-xyz'])
      .it('sets active: false for the experiment', (ctx: any) => {
        expect(ctx.stdout).to.contain('stopped successfully')
        expect(ctx.stdout).to.contain('test-parent-app-feature-xyz-a1b2c3')
        expect(ctx.stdout).to.contain('inactive and will not receive traffic')

        // Verify HEROKU_XP config was updated with active: false
        const configUpdateCall = herokuPatchStub.getCalls().find((call: any) =>
          call.args[0] === '/apps/test-parent-app/config-vars' &&
          call.args[1]?.body?.HEROKU_XP
        )
        expect(configUpdateCall).to.exist

        const updatedConfig: SimplifiedExperimentsConfig = JSON.parse(configUpdateCall!.args[1].body.HEROKU_XP)
        validateExperimentsConfig(updatedConfig)
        expect(updatedConfig.experiments).to.have.length(1)
        expect(updatedConfig.experiments[0].active).to.equal(false)
        expect(updatedConfig.experiments[0].branch).to.equal('feature-xyz')
      })
  })

  describe('stopping an already inactive experiment', () => {
    test
      .stub(Stop.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
        patch: herokuPatchStub,
      }))
      .do(() => {
        const mockApp = createMockApp()
        const experiments = [
          createMockExperiment('feature-xyz', 'test-parent-app-feature-xyz-a1b2c3', {
            active: false,
          }),
        ]
        const existingConfig = createMockExperimentsConfig(experiments)
        const mockConfigVars = createMockConfigVars({
          HEROKU_XP: JSON.stringify(existingConfig),
        })

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
      })
      .stdout()
      .command(['xp:stop', '--app', 'test-parent-app', '--branch', 'feature-xyz'])
      .it('shows info message without updating config', (ctx: any) => {
        expect(ctx.stdout).to.contain('already inactive')
        expect(ctx.stdout).to.contain('test-parent-app-feature-xyz-a1b2c3')

        // Verify HEROKU_XP config was NOT updated
        expect(herokuPatchStub.called).to.be.false
      })
  })

  describe('stopping experiment with implicit active: true (missing field)', () => {
    test
      .stub(Stop.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
        patch: herokuPatchStub,
      }))
      .do(() => {
        const mockApp = createMockApp()
        // Create experiment without active field (defaults to true)
        const experiments = [
          createMockExperiment('feature-xyz', 'test-parent-app-feature-xyz-a1b2c3'),
        ]
        const existingConfig = createMockExperimentsConfig(experiments)
        const mockConfigVars = createMockConfigVars({
          HEROKU_XP: JSON.stringify(existingConfig),
        })

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
        herokuPatchStub.withArgs('/apps/test-parent-app/config-vars', sinon.match.any).resolves({body: {}})
      })
      .stdout()
      .command(['xp:stop', '--app', 'test-parent-app', '--branch', 'feature-xyz'])
      .it('treats missing active field as true and stops the experiment', (ctx: any) => {
        expect(ctx.stdout).to.contain('stopped successfully')

        const configUpdateCall = herokuPatchStub.getCalls().find((call: any) =>
          call.args[0] === '/apps/test-parent-app/config-vars' &&
          call.args[1]?.body?.HEROKU_XP
        )
        expect(configUpdateCall).to.exist

        const updatedConfig: SimplifiedExperimentsConfig = JSON.parse(configUpdateCall!.args[1].body.HEROKU_XP)
        expect(updatedConfig.experiments[0].active).to.equal(false)
      })
  })

  describe('stopping one experiment among multiple', () => {
    test
      .stub(Stop.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
        patch: herokuPatchStub,
      }))
      .do(() => {
        const mockApp = createMockApp()
        const experiments = [
          createMockExperiment('feature-xyz', 'test-parent-app-feature-xyz-a1b2c3', {
            active: true,
          }),
          createMockExperiment('new-ui', 'test-parent-app-new-ui-d4e5f6', {
            active: true,
          }),
          createMockExperiment('api-v2', 'test-parent-app-api-v2-g7h8i9', {
            active: false,
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
      .command(['xp:stop', '--app', 'test-parent-app', '--branch', 'new-ui'])
      .it('only stops the specified experiment, leaving others unchanged', (ctx: any) => {
        expect(ctx.stdout).to.contain('stopped successfully')
        expect(ctx.stdout).to.contain('test-parent-app-new-ui-d4e5f6')

        const configUpdateCall = herokuPatchStub.getCalls().find((call: any) =>
          call.args[0] === '/apps/test-parent-app/config-vars' &&
          call.args[1]?.body?.HEROKU_XP
        )
        expect(configUpdateCall).to.exist

        const updatedConfig: SimplifiedExperimentsConfig = JSON.parse(configUpdateCall!.args[1].body.HEROKU_XP)
        validateExperimentsConfig(updatedConfig)
        expect(updatedConfig.experiments).to.have.length(3)

        const featureXyz = updatedConfig.experiments.find((exp: any) => exp.branch === 'feature-xyz')
        const newUi = updatedConfig.experiments.find((exp: any) => exp.branch === 'new-ui')
        const apiV2 = updatedConfig.experiments.find((exp: any) => exp.branch === 'api-v2')

        expect(featureXyz!.active).to.not.equal(false) // unchanged (true or undefined)
        expect(newUi!.active).to.equal(false) // stopped
        expect(apiV2!.active).to.equal(false) // already inactive
      })
  })

  describe('output messages', () => {
    test
      .stub(Stop.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
        patch: herokuPatchStub,
      }))
      .do(() => {
        const mockApp = createMockApp()
        const experiments = [
          createMockExperiment('feature-xyz', 'test-parent-app-feature-xyz-a1b2c3', {
            active: true,
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
      .command(['xp:stop', '--app', 'test-parent-app', '--branch', 'feature-xyz'])
      .it('displays helpful next steps', (ctx: any) => {
        expect(ctx.stdout).to.contain('To reactivate this experiment')
        expect(ctx.stdout).to.contain('heroku xp:start --app test-parent-app --branch feature-xyz')
        expect(ctx.stdout).to.contain('To permanently remove this experiment')
        expect(ctx.stdout).to.contain('heroku xp:destroy --app test-parent-app --branch feature-xyz')
      })
  })

  describe('error handling', () => {
    test
      .stub(Stop.prototype, 'heroku' as any, () => ({
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
      .command(['xp:stop', '--app', 'test-parent-app', '--branch', 'nonexistent'])
      .catch((error: Error) => {
        expect(error.message).to.contain('No experiment found')
        expect(error.message).to.contain('nonexistent')
      })
      .it('fails when experiment does not exist')

    test
      .stub(Stop.prototype, 'heroku' as any, () => ({
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
      .command(['xp:stop', '--app', 'test-parent-app', '--branch', 'different-exp'])
      .catch((error: Error) => {
        expect(error.message).to.contain('No experiment found')
        expect(error.message).to.contain('different-exp')
      })
      .it('fails when trying to stop a non-existent experiment')

    test
      .stub(Stop.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
      }))
      .do(() => {
        herokuGetStub.withArgs('/apps/nonexistent-app/config-vars').rejects(new Error('App not found'))
      })
      .command(['xp:stop', '--app', 'nonexistent-app', '--branch', 'feature-xyz'])
      .catch((error: Error) => {
        expect(error.message).to.contain('not found')
      })
      .it('fails when parent app does not exist')

    test
      .stub(Stop.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
      }))
      .do(() => {
        const mockApp = createMockApp()
        const mockConfigVars = createMockConfigVars()

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
      })
      .command(['xp:stop', '--app', 'test-parent-app', '--branch', 'feature-xyz'])
      .catch((error: Error) => {
        expect(error.message).to.contain('No experiment found')
      })
      .it('fails when HEROKU_XP config var is missing')

    test
      .stub(Stop.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
      }))
      .do(() => {
        const mockApp = createMockApp()
        const mockConfigVars = createMockConfigVars({
          HEROKU_XP: 'invalid json{',
        })

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
      })
      .command(['xp:stop', '--app', 'test-parent-app', '--branch', 'feature-xyz'])
      .catch((error: Error) => {
        expect(error.message).to.contain('Failed to parse HEROKU_XP')
      })
      .it('fails when HEROKU_XP config is malformed JSON')

    test
      .stub(Stop.prototype, 'heroku' as any, () => ({
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
      .command(['xp:stop', '--app', 'test-parent-app', '--branch', 'feature-xyz'])
      .catch((error: Error) => {
        expect(error.message).to.contain('Failed to update experiment configuration')
      })
      .it('handles config update failure gracefully')
  })

  describe('case sensitivity', () => {
    test
      .stub(Stop.prototype, 'heroku' as any, () => ({
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
      .command(['xp:stop', '--app', 'test-parent-app', '--branch', 'feature-xyz'])
      .catch((error: Error) => {
        expect(error.message).to.contain('No experiment found')
      })
      .it('branch name matching is case-sensitive')
  })

  describe('stopping experiment with different parent apps', () => {
    test
      .stub(Stop.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
        patch: herokuPatchStub,
      }))
      .do(() => {
        const mockApp = createMockApp()

        // Create experiments with same branch name but different parent apps
        const experiments = [
          createMockExperiment('feature-xyz', 'test-parent-app-feature-xyz-v1w2x3', {
            parentApp: 'test-parent-app',
            active: true,
          }),
          createMockExperiment('feature-xyz', 'other-parent-app-feature-xyz-y4z5a6', {
            parentApp: 'other-parent-app',
            active: true,
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
      .command(['xp:stop', '--app', 'test-parent-app', '--branch', 'feature-xyz'])
      .it('only stops experiment matching both parent app and branch', (ctx: any) => {
        expect(ctx.stdout).to.contain('stopped successfully')

        // Verify HEROKU_XP config has correct active states
        const configUpdateCall = herokuPatchStub.getCalls().find((call: any) =>
          call.args[0] === '/apps/test-parent-app/config-vars' &&
          call.args[1]?.body?.HEROKU_XP
        )
        expect(configUpdateCall).to.exist

        const updatedConfig: SimplifiedExperimentsConfig = JSON.parse(configUpdateCall!.args[1].body.HEROKU_XP)
        expect(updatedConfig.experiments).to.have.length(2)

        const testParentExp = updatedConfig.experiments.find(
          (exp: any) => exp.parentApp === 'test-parent-app'
        )
        const otherParentExp = updatedConfig.experiments.find(
          (exp: any) => exp.parentApp === 'other-parent-app'
        )

        expect(testParentExp!.active).to.equal(false) // stopped
        expect(otherParentExp!.active).to.not.equal(false) // unchanged
      })
  })

  describe('config var size and weight validation', () => {
    test
      .stub(Stop.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
        patch: herokuPatchStub,
      }))
      .do(() => {
        const mockApp = createMockApp()
        const experiments = [
          createMockExperiment('exp-1', 'app-1', {rules: [{weight: 50, mirror: false, method: 'GET'}]}),
          createMockExperiment('exp-2', 'app-2', {rules: [{weight: 30, mirror: false, method: 'GET'}]}),
          createMockExperiment('exp-3', 'app-3', {rules: [{weight: 10, mirror: false, method: 'GET'}]}),
        ]
        const existingConfig = createMockExperimentsConfig(experiments)
        const mockConfigVars = createMockConfigVars({
          HEROKU_XP: JSON.stringify(existingConfig),
        })

        herokuGetStub.withArgs('/apps/test-parent-app/config-vars').resolves({body: mockConfigVars})
        herokuPatchStub.withArgs('/apps/test-parent-app/config-vars', sinon.match.any).resolves({body: {}})
      })
      .stdout()
      .command(['xp:stop', '--app', 'test-parent-app', '--branch', 'exp-2'])
      .it('validates total weight does not exceed 100% after stopping', (ctx: any) => {
        expect(ctx.stdout).to.contain('stopped successfully')

        const configUpdateCall = herokuPatchStub.getCalls().find((call: any) =>
          call.args[0] === '/apps/test-parent-app/config-vars' &&
          call.args[1]?.body?.HEROKU_XP
        )
        expect(configUpdateCall).to.exist

        const updatedConfig: SimplifiedExperimentsConfig = JSON.parse(configUpdateCall!.args[1].body.HEROKU_XP)
        const totalWeight = updatedConfig.experiments.reduce(
          (sum: number, exp: any) => sum + (exp.rules?.[0]?.weight || 0),
          0
        )
        expect(totalWeight).to.equal(90) // 50 + 30 + 10 = 90
        expect(totalWeight).to.be.lessThan(100)
      })
  })

  describe('preserving experiment properties', () => {
    test
      .stub(Stop.prototype, 'heroku' as any, () => ({
        get: herokuGetStub,
        patch: herokuPatchStub,
      }))
      .do(() => {
        const mockApp = createMockApp()
        const experiments = [
          createMockExperiment('feature-xyz', 'test-parent-app-feature-xyz-a1b2c3', {
            repo: 'heroku/test-repo',
            rules: [{
              weight: 25,
              path: '/api/v2',
              query: 'beta: true',
              header: 'x-experiment: enabled',
              mirror: true,
              method: 'POST',
            }],
            active: true,
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
      .command(['xp:stop', '--app', 'test-parent-app', '--branch', 'feature-xyz'])
      .it('preserves all experiment properties except active', (ctx: any) => {
        expect(ctx.stdout).to.contain('stopped successfully')

        const configUpdateCall = herokuPatchStub.getCalls().find((call: any) =>
          call.args[0] === '/apps/test-parent-app/config-vars' &&
          call.args[1]?.body?.HEROKU_XP
        )
        expect(configUpdateCall).to.exist

        const updatedConfig: SimplifiedExperimentsConfig = JSON.parse(configUpdateCall!.args[1].body.HEROKU_XP)
        const experiment = updatedConfig.experiments[0]

        // Verify only active changed
        expect(experiment.active).to.equal(false)
        expect(experiment.repo).to.equal('heroku/test-repo')
        expect(experiment.rules).to.have.length(1)
        expect(experiment.rules![0].weight).to.equal(25)
        expect(experiment.rules![0].path).to.equal('/api/v2')
        expect(experiment.rules![0].query).to.equal('beta: true')
        expect(experiment.rules![0].header).to.equal('x-experiment: enabled')
        expect(experiment.rules![0].mirror).to.equal(true)
        expect(experiment.rules![0].method).to.equal('POST')
      })
  })
})
