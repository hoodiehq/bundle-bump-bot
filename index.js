#!/usr/bin/env node

var path = require('path')
var fs = require('fs')

var defaults = require('lodash.defaults')
var githubChangeRemoteFile = require('github-change-remote-file')
var githubUrl = require('github-url-from-git')
var nopt = require('nopt')
var semver = require('semver')
var template = require('lodash.template')

var config = defaults(nopt({
  branch: String,
  ci: Boolean,
  user: String,
  repo: String,
  type: [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies'
  ],
  token: String
}, {
  b: 'branch',
  u: '--user',
  r: '--repo',
  t: '--type'
}), {
  branch: 'master',
  ci: process.env.CI === 'true',
  user: 'hoodiehq',
  repo: 'hoodie',
  type: 'dependencies',
  token: process.env.GH_TOKEN
})

if (!config.token) {
  console.error('You need to specify a token')
  process.exit(1)
}

if (config.debug) {
  console.error('You should run this on a CI server')
  process.exit(1)
}

var pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json')))
var url = githubUrl(pkg.repository.url)
var data = {
  config: config,
  pkg: pkg,
  // Ensure that we get a standard github repository URL for
  // insertion into the template
  url: url,
  // Link to the package version that has just been released!
  release: url + '/releases/tag/v' + pkg.version
}

var options = {
  branch: config.branch,
  user: config.user,
  repo: config.repo,
  filename: 'package.json',
  transform: function (bundlePkg) {
    bundlePkg = JSON.parse(bundlePkg)
    var oldVersion = bundlePkg[config.type][pkg.name] || '0.0.0'
    bundlePkg[config.type][pkg.name] = pkg.version

    var options = pushOrPR(oldVersion, pkg.version)
    options.content = JSON.stringify(bundlePkg, null, 2) + '\n'

    return options
  },
  token: config.token
}

function pushOrPR (oldVersion, newVersion) {
  var messageFragment = 'updated ' + pkg.name + ' to version ' + pkg.version

  // remove ranges
  oldVersion = oldVersion.replace(/^[\^~]/, '')

  // this should essentially never be the case
  // but if so let's handle it gracefully
  if (!semver.valid(oldVersion)) {
    return {
      message: 'chore(package): ' + messageFragment,
      pr: {
        title: messageFragment
      }
    }
  }

  var diff = semver.diff(oldVersion, newVersion)

  if (diff === 'major') {
    // When older PRs couldn't be merged yet, the actual new version that was
    // released doesn't necessarily have to be  a major version at this point.
    // Let's find out :)
    if (semver.minor(newVersion) === 0 && semver.patch(newVersion) === 0) {
      data.type = 'major'
    } else if (semver.minor(newVersion) !== 0 && semver.patch(newVersion) === 0) {
      data.type = 'minor'
    } else {
      data.type = 'patch'
    }

    // we don't really know what a braking change means for the bundle
    // so we just use the `chore` type so this can be determined by humans
    // also we're only sending a PR rather than pushing to master
    return {
      message: 'chore(package): ' + messageFragment,
      pr: {
        title: '[Potentially Breaking] ' + messageFragment,
        // Read the pr-body file and process it with lodash.template
        body: template(
          fs.readFileSync(path.join(__dirname, 'pr-body.md')).toString()
        )(data)
      }
    }
  }

  if (diff === 'minor') {
    return {
      message: 'feat(package): ' + messageFragment,
      push: true
    }
  }

  if (diff === 'patch') {
    return {
      message: 'fix(package): ' + messageFragment,
      push: true
    }
  }

  return {
    message: 'chore(package): ' + messageFragment,
    pr: {
      title: '[Pre-Release] ' + messageFragment
    }
  }
}

githubChangeRemoteFile(options, function (err, res) {
  if (err) throw console.log(err)

  if (res.html_url) console.log(res.html_url)
  if (res.object && res.object.url) console.log(res.object.url)
})
