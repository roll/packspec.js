const fs = require('fs')
const yaml = require('js-yaml')
const glob = require('glob')
const assert = require('assert')
const lodash = require('lodash')
// const program = require('commander')


// Module API

// program
  // .command('packspec-js <path>')
  // .parse(process.argv);


// Helpers

async function parseSpecs(path) {
  const mapping = {}
  const filepaths = glob.sync(`${path}/**/*.yml`)
  for (const filepath of filepaths) {
    const filecont = fs.readFileSync(filepath, 'utf8')
    const spec = await parseSpec(filecont)
    if (!spec) continue
    if (!mapping[spec.package]) {
      mapping[spec.package] = spec
    } else {
      mapping[spec.package].features = mapping[spec.package].features.concat(spec.features)
    }
  }
  const specs = Object.keys(mapping).sort().map(key => mapping[key])
  return specs
}


async function parseSpec(spec) {
  // Package
  let packageName
  const contents = yaml.safeLoad(spec)
  try {
    const feature = await parseFeature(contents[0])
    packageName = feature.result
    assert(feature.source[0] === 'PACKAGE')
  } catch (error) {
    console.log(error)
    return null
  }
  // Features
  const features = []
  for (const item of contents) {
    const feature = await parseFeature(item)
    features.push(feature)
  }
  // Variables
  const module = require(packageName)
  const variables = Object.assign({PACKAGE: packageName}, module)
  return {package: packageName, features, variables}
}


async function parseFeature(feature) {
  let [left, right] = Object.entries(feature)[0]
  left = left.replace(/(_.)/g, match => match[1].toUpperCase())
  // Left side
  const match = /^(?:([^=]*)=)?([^:]*)(?::{([^{}]*)})?$/g.exec(left)
  let [target, source, filter] = match.slice(1)
  if (source) {
    source = source.split('.')
  }
  if (filter) {
    const rules = filter.split(',')
    filter = rules.includes('!js') || !(filter.includes('!') || rules.includes('js'))
  }
  // Right side
  let result = right
  let params = null
  if (lodash.isArray(right)) {
    result = right.pop()
    params = right
  }
  // String repr
  let string = source.join('.')
  if (target) {
    string = `${target}=${source}`
  }
  if (params) {
    string = `${string}(<implement>)`
  }
  if (!target) {
    string = `${string} == ${result}`
  }
  return {string, source, params, result, target, filter}
}


async function testSpecs(specs) {
  let success = true
  for (const spec of specs) {
    const specSuccess = await testSpec(spec)
    success = success && specSuccess
  }
  return success
}


async function testSpec(spec) {
  let passed = 0
  const amount = spec.features.length
  for (const feature of spec.features) {
    passed += await testFeature(feature, spec.variables)
  }
  console.log(`${spec.package}: ${passed}/${amount}`)
  const success = (passed === amount)
  return success
}


async function testFeature(feature, variables) {
  // Filter
  if (feature.filter) {
    console.log(`(#) ${feature.string}`)
    return true
  }
  // Execute
  let result
  try {
    let name
    let source = variables
    for (name of feature.source) {
      source = source[name]
    }
    result = source
    if (feature.params) {
      if (name[0] === name[0].toUpperCase()) {
        result = await new source(...feature.params)
      } else {
        result = await source(...feature.params)
      }
    }
  } catch (error) {
    result = 'ERROR'
  }
  // Assign
  if (feature.target) {
    variables[feature.target] = result
  }
  // Verify
  const success = (result === feature.result) || (result !== 'ERROR' && feature.result === 'ANY')
  if (success) {
    console.log(`(+) ${feature.string}`)
  } else {
    console.log(`(-) ${feature.string} # ${result}`)
  }
  return success
}


// Main program

const path = [...process.argv].pop() || '.'
parseSpecs(path).then(specs => {
  testSpecs(specs).then(success => {
    if (!success) process.exit(1)
  })
})
