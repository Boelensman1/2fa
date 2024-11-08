import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('entries:get-token', () => {
  it('runs entries:get-token cmd', async () => {
    const {stdout} = await runCommand('entries:get-token')
    expect(stdout).to.contain('hello world')
  })

  it('runs entries:get-token --name oclif', async () => {
    const {stdout} = await runCommand('entries:get-token --name oclif')
    expect(stdout).to.contain('hello oclif')
  })
})
