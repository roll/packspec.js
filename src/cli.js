const fs = require('fs')
const yaml = require('js-yaml')
const glob = require('glob')
const assert = require('assert')
const lodash = require('lodash')
const nodepath = require('path')
// const program = require('commander')


// Module API

// program
  // .command('packspec-js <path>')
  // .parse(process.argv);


// Helpers

async function parseSpecs(path) {
  // Specs
  const specmap = {}
  let filepaths = glob.sync(`${path}/**/*.yml`)
  for (const filepath of filepaths) {
    const filecont = fs.readFileSync(filepath, 'utf8')
    const spec = await parseSpec(filecont)
    if (!spec) continue
    if (!specmap[spec.scope.PACKAGE]) {
      specmap[spec.scope.PACKAGE] = spec
    } else {
      specmap[spec.scope.PACKAGE].features = specmap[spec.scope.PACKAGE]
        .features.concat(spec.features)
    }
  }
  // Hooks
  let hookmap = {}
  filepaths = glob.sync(`${path}/**/packspec.js`)
  for (const filepath of filepaths) {
    const relpath = nodepath.relative(__dirname, filepath)
    const module = require(relpath)
    hookmap = Object.assign(hookmap, module)
  }
  // Result
  const specs = Object.keys(specmap).sort().map(key => specmap[key])
  for (const spec of specs) {
    for (const [name, hook] of Object.entries(hookmap)) {
      spec.scope[name] = lodash.partial(hook, spec.scope)
    }
  }
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
    assert(!feature.skip)
  } catch (error) {
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
  const scope = Object.assign({PACKAGE: packageName}, module)
  return {features, scope}
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
  if (args !== null) {
    const items = []
    for (const arg of args) {
      let item = parseInterpolation(arg)
      if (!item) {
        item = JSON.stringify(arg)
      }
      items.push(item)
    }
    text = `${text}(${items.join(', ')})`
  }
  if (!assign) {
    text = `${text} == ${JSON.stringify(result)}`
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
    passed += await testFeature(feature, spec.scope)
  }
  console.log(`${spec.scope.PACKAGE}: ${passed}/${amount}`)
  const success = (passed === amount)
  return success
}


async function testFeature(feature, scope) {
  // Skip
  if (feature.skip) {
    console.log(`(#) ${feature.text}`)
    return true
  }
  // Execute
  let result
  try {
    let owner = scope
    const names = feature.property.split('.')
    for (const name of names.slice(0, -1)) {
      owner = owner[name]
    }
    const property = owner[names[names.length - 1]]
    // Call property
    if (feature.args !== null) {
      const args = []
      for (let arg of feature.args) {
        // Property interpolation
        const name = parseInterpolation(arg)
        if (name) {
          arg = scope[name]
        }
        args.push(arg)
      }
      const firstLetter = names[names.length - 1][0]
      if (firstLetter === firstLetter.toUpperCase()) {
        result = await new property(...args)
      } else {
        result = await property.bind(owner)(...args)
      }
    // Get property
    } else if (property) {
      result = property
    // Set property
    } else {
      if (names[names.length - 1] === names[names.length - 1].toUpperCase()) {
        throw new Error('Can\'t update the constant')
      }
      result = feature.result
      owner[names[names.length - 1]] = result
    }
  } catch (error) {
    result = 'ERROR'
  }
  // Assign
  if (feature.assign) {
    scope[feature.assign] = result
  }
  // Verify
  const success = (result === feature.result) || (result !== 'ERROR' && feature.result === 'ANY')
  if (success) {
    console.log(`(+) ${feature.text}`)
  } else {
    console.log(`(-) ${feature.text} # ${JSON.stringify(result)}`)
  }
  return success
}

function parseInterpolation(arg) {
  if (lodash.isPlainObject(arg) && Object.keys(arg).length === 1) {
    const [left, right] = Object.entries(arg)[0]
    if (right === null) {
      return left
    }
  }
  return null
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
