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
  const specmap = {}
  const filepaths = glob.sync(`${path}/**/*.yml`)
  for (const filepath of filepaths) {
    const filecont = fs.readFileSync(filepath, 'utf8')
    const spec = await parseSpec(filecont)
    if (!spec) continue
    if (!specmap[spec.package]) {
      specmap[spec.package] = spec
    } else {
      specmap[spec.package].features = specmap[spec.package].features.concat(spec.features)
    }
  }
  const specs = Object.keys(specmap).sort().map(key => specmap[key])
  return specs
}


async function parseSpec(spec) {
  // Package
  let packageName
  const contents = yaml.safeLoad(spec)
  try {
    const feature = await parseFeature(contents[0])
    packageName = feature.result
    assert(feature.property === 'PACKAGE')
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
  const match = /^(?:([^=]*)=)?([^:]*)(?::(.*))*$/g.exec(left)
  let [assign, property, skip] = match.slice(1)
  if (skip) {
    const filters = skip.split(',')
    skip = filters.includes('!js') || !(skip.includes('!') || filters.includes('js'))
  }
  // Right side
  let result = right
  let args = null
  if (lodash.isArray(right)) {
    result = right.pop()
    args = right
  }
  // Text repr
  let text = property
  if (assign) {
    text = `${assign}=${property}`
  }
  if (args) {
    text = `${text}(<implement>)`
  }
  if (!assign) {
    text = `${text} == ${result}`
  }
  return {assign, property, args, result, text, skip}
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
  // Skip
  if (feature.skip) {
    console.log(`(#) ${feature.text}`)
    return true
  }
  // Execute
  let result
  try {
    let name
    let source = variables
    for (name of feature.property.split('.')) {
      source = source[name]
    }
    result = source
    if (feature.args) {
      if (name[0] === name[0].toUpperCase()) {
        result = await new source(...feature.args)
      } else {
        result = await source(...feature.args)
      }
    }
  } catch (error) {
    console.log(error)
    result = 'ERROR'
  }
  // Assign
  if (feature.assign) {
    variables[feature.assign] = result
  }
  // Verify
  const success = (result === feature.result) || (result !== 'ERROR' && feature.result === 'ANY')
  if (success) {
    console.log(`(+) ${feature.text}`)
  } else {
    console.log(`(-) ${feature.text} # ${result}`)
  }
  return success
}


// Main program

let argv = [...process.argv]
if (argv[0].endsWith('node')) {
  argv = argv.slice(1)
}
const path = argv[1] || '.'
parseSpecs(path).then(specs => {
  testSpecs(specs).then(success => {
    if (!success) process.exit(1)
  })
})
