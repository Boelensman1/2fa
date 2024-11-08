import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('entries:list', () => {
  it('runs entries:list cmd', async () => {
    const {stdout} = await runCommand('entries:list')
    expect(stdout).to.contain('hello world')
  })

  it('runs entries:list --name oclif', async () => {
    const {stdout} = await runCommand('entries:list --name oclif')
    expect(stdout).to.contain('hello oclif')
  })
})
