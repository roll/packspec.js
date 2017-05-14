const fs = require('fs')
const glob = require('glob')
const chalk = require('chalk')
const yaml = require('js-yaml')
const assert = require('assert')
const lodash = require('lodash')
const nodepath = require('path')
const emojify = require('node-emoji').emojify
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
    if (!specmap[spec.package]) {
      specmap[spec.package] = spec
    } else {
      specmap[spec.package].features = specmap[spec.package]
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
    assert(feature.assign === 'PACKAGE')
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

  // Scope
  const module = require(packageName)
  const scope = Object.assign({}, module)

  return {package: packageName, features, scope}
}


async function parseFeature(feature) {
  let [left, right] = Object.entries(feature)[0]

  // Left side
  left = left.replace(/(_.)/g, match => match[1].toUpperCase())
  const match = /^(?:(.*):)?(?:([^=]*)=)?(.*)?$/g.exec(left)
  let [skip, assign, property] = match.slice(1)
  if (skip) {
    const filters = skip.split(':')
    skip = (filters[0] === 'not') === (filters.includes('js'))
  }
  if (!assign && !property) {
    throw new Error('Non-valid feature')
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
    text = `${assign} = ${property || JSON.stringify(result)}`
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
  let message = chalk.blue.bold(emojify('\n :small_blue_diamond:  '))
  message += chalk.bold('JavaScript\n')
  console.log(message)
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
  const success = (passed === amount)
  let message = chalk.green.bold(emojify('\n :heavy_check_mark:  '))
  if (!success) {
    message = chalk.red.bold(emojify('\n :x:  '))
  }
  message += chalk.bold(`${spec.package}: ${passed}/${amount}\n`)
  console.log(message)
  return success
}


async function testFeature(feature, scope) {

  // Skip
  if (feature.skip) {
    let message = chalk.yellow(emojify(' :question:  '))
    message += `${feature.text}`
    console.log(message)
    return true
  }

  // Execute
  let result = feature.result
  if (feature.property) {
    try {
      let owner = scope
      const names = feature.property.split('.')
      const lastName = names[names.length - 1]
      for (const name of names.slice(0, -1)) {
        owner = owner[name]
      }
      const property = owner[lastName]
      if (feature.args !== null) {
        const args = []
        for (let arg of feature.args) {
          const name = parseInterpolation(arg)
          if (name) {
            arg = scope[name]
          }
          args.push(arg)
        }
        const firstLetter = lastName[0]
        if (firstLetter === firstLetter.toUpperCase()) {
          result = await new property(...args)
        } else {
          result = await property.bind(owner)(...args)
        }
      } else {
        result = property
      }
    } catch (error) {
      result = 'ERROR'
    }
  }

  // Assign
  if (feature.assign) {
    let owner = scope
    const names = feature.assign.split('.')
    const lastName = names[names.length - 1]
    for (const name of names.slice(0, -1)) {
      owner = owner[name]
    }
    if (owner[lastName] !== undefined && lastName === lastName.toUpperCase()) {
      throw new Error(`Can't update the constant ${lastName}`)
    }
    owner[lastName] = result
  }

  // Compare
  const success = (result === feature.result) || (result !== 'ERROR' && feature.result === 'ANY')
  if (success) {
    let message = chalk.green(emojify(' :heavy_check_mark:  '))
    message += `${feature.text}`
    console.log(message)
  } else {
    let message = chalk.red(emojify(' :x:  '))
    message += `${feature.text} # ${JSON.stringify(result)}`
    console.log(message)
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
