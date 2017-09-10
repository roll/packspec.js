const {assert} = require('chai')
const cli = require('../src/cli')


// Tests

describe('cli', () => {

  it('should work with packspec', async () => {
    const specs = await cli.parseSpecs('test/packspec.yml')
    const valid = await cli.testSpecs(specs)
    assert.ok(valid)
  })

  it('should work with packspec assertion fail', async () => {
    const specs = await cli.parseSpecs('test/packspec.yml')
    specs[0].features.length = 3
    specs[0].features[2].result = 'FAIL'
    const valid = await cli.testSpecs(specs)
    assert.notOk(valid)
  })

  it('should work with packspec exception fail', async () => {
    const specs = await cli.parseSpecs('test/packspec.yml')
    specs[0].features.length = 3
    specs[0].features[2].call = true
    const valid = await cli.testSpecs(specs)
    assert.notOk(valid)
  })

})
