import {expect, test} from '@oclif/test'
import * as sinon from 'sinon'
import Start from '../../../src/commands/xp/start'
import {
  createMockExperiment,
  createMockExperimentsConfig,
  createMockConfigVars,
} from '../../helpers/setup'
import {ExperimentEntry, ExperimentsConfig} from '../../../src/types/experiment'

describe('xp:start', () => {
  let herokuGetStub: sinon.SinonStub
  let herokuPatchStub: sinon.SinonStub

  beforeEach(() => {
    herokuGetStub = sinon.stub()
    herokuPatchStub = sinon.stub()
  })

  function givenExperiments(experiments: ExperimentEntry[]) {
    herokuGetStub
      .withArgs('/apps/test-parent-app/config-vars')
      .resolves({body: createMockConfigVars({HEROKU_XP: JSON.stringify(createMockExperimentsConfig(experiments))})})
    herokuPatchStub.resolves({body: {}})
  }

  function patchedConfig(): ExperimentsConfig {
    const call = herokuPatchStub.getCalls().find(c => c.args[1]?.body?.HEROKU_XP)
    expect(call).to.exist
    return JSON.parse(call!.args[1].body.HEROKU_XP)
  }

  test
    .command(['xp:start'])
    .catch((error: Error) => {
      expect(error.message).to.contain('Missing required flag')
    })
    .it('requires --app and --branch')

  test
    .stub(Start.prototype, 'heroku', stub => stub.get(() => ({get: herokuGetStub, patch: herokuPatchStub})))
    .do(() => givenExperiments([
      createMockExperiment('feature-xyz', 'exp-app', {active: false}),
    ]))
    .stdout()
    .command(['xp:start', '--app', 'test-parent-app', '--branch', 'feature-xyz'])
    .it('reactivates a stopped experiment', (ctx: any) => {
      expect(ctx.stdout).to.contain('started successfully')

      const experiment = patchedConfig().experiments[0]
      expect(experiment).to.not.have.property('active')
    })

  test
    .stub(Start.prototype, 'heroku', stub => stub.get(() => ({get: herokuGetStub, patch: herokuPatchStub})))
    .do(() => givenExperiments([
      createMockExperiment('feature-xyz', 'exp-app', {active: true}),
    ]))
    .stdout()
    .command(['xp:start', '--app', 'test-parent-app', '--branch', 'feature-xyz'])
    .it('does nothing for an experiment that is already active', (ctx: any) => {
      expect(ctx.stdout).to.contain('already active')
      expect(herokuPatchStub.called).to.be.false
    })

  test
    .stub(Start.prototype, 'heroku', stub => stub.get(() => ({get: herokuGetStub, patch: herokuPatchStub})))
    .do(() => givenExperiments([
      createMockExperiment('one', 'exp-one', {active: false}),
      createMockExperiment('two', 'exp-two', {active: false}),
    ]))
    .stdout()
    .command(['xp:start', '--app', 'test-parent-app', '--branch', 'two'])
    .it('only starts the requested branch', () => {
      const [one, two] = patchedConfig().experiments
      expect(one.active).to.equal(false)
      expect(two).to.not.have.property('active')
    })

  test
    .stub(Start.prototype, 'heroku', stub => stub.get(() => ({get: herokuGetStub, patch: herokuPatchStub})))
    .do(() => givenExperiments([createMockExperiment('other', 'exp-app')]))
    .command(['xp:start', '--app', 'test-parent-app', '--branch', 'feature-xyz'])
    .catch((error: Error) => {
      expect(error.message).to.contain('No experiment found for branch "feature-xyz"')
    })
    .it('fails when the experiment does not exist')

  test
    .stub(Start.prototype, 'heroku', stub => stub.get(() => ({get: herokuGetStub, patch: herokuPatchStub})))
    .do(() => {
      herokuGetStub.resolves({body: createMockConfigVars()})
    })
    .command(['xp:start', '--app', 'test-parent-app', '--branch', 'feature-xyz'])
    .catch((error: Error) => {
      expect(error.message).to.contain('No experiments configured')
    })
    .it('fails when HEROKU_XP is not set')
})
