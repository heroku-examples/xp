import {expect, test} from '@oclif/test'
import * as sinon from 'sinon'
import Create from '../../../src/commands/xp/create'
import {
  createMockApp,
  createMockBuildpack,
  createMockConfigVars,
  createMockExperiment,
  createMockExperimentsConfig,
} from '../../helpers/setup'

describe('xp:create', () => {
  const herokuGetStub = sinon.stub()
  const herokuPatchStub = sinon.stub()

  beforeEach(() => {
    herokuGetStub.reset()
    herokuPatchStub.reset()
  })

  const experiments = (count: number) =>
    Array.from({length: count}, (_, i) => createMockExperiment(`branch-${i}`, `exp-app-${i}`))

  const withStubs = (count: number) => test
    .stub(Create.prototype, 'heroku', stub => stub.get(() => ({get: herokuGetStub, patch: herokuPatchStub})))
    .do(() => {
      herokuGetStub.withArgs('/apps/test-parent-app').resolves({body: createMockApp({name: 'test-parent-app'})})
      herokuGetStub.withArgs('/apps/test-parent-app/buildpack-installations')
        .resolves({body: [createMockBuildpack('https://github.com/heroku-examples/xp/releases/latest/download/xp-buildpack.tgz')]})
      herokuGetStub.withArgs('/apps/test-parent-app/config-vars')
        .resolves({body: createMockConfigVars({HEROKU_XP: JSON.stringify(createMockExperimentsConfig(experiments(count)))})})
    })

  withStubs(50)
    .command(['xp:create', '--app', 'test-parent-app', '--branch', 'one-too-many', '--weight', '10'])
    .catch((error: Error) => {
      expect(error.message).to.contain('maximum of 50 experiments')
      expect(herokuPatchStub.called).to.equal(false)
    })
    .it('refuses a new experiment beyond 50')
})
