import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('entries:search', () => {
  it('runs entries:search cmd', async () => {
    const {stdout} = await runCommand('entries:search')
    expect(stdout).to.contain('hello world')
  })

  it('runs entries:search --name oclif', async () => {
    const {stdout} = await runCommand('entries:search --name oclif')
    expect(stdout).to.contain('hello oclif')
  })
})
