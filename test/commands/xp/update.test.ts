import {expect, test} from '@oclif/test'

describe('xp:update', () => {
  test
    .stdout()
    .command(['xp:update', '--help'])
    .it('shows help', ctx => {
      expect(ctx.stdout).to.contain('Update experiment routing configuration')
    })
})
