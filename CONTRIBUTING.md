# Contributing to Heroku Previews Plugin

Thank you for your interest in contributing to the Heroku Previews Plugin! This document provides guidelines for setting up your development environment, running tests, and submitting contributions.

## Table of Contents

- [Development Setup](#development-setup)
- [Running Tests](#running-tests)
- [Code Style](#code-style)
- [Testing with Real Apps](#testing-with-real-apps)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Release Process](#release-process)
- [Security](#security)

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- Yarn package manager
- Heroku CLI installed (`heroku --version`)
- Git

### Initial Setup

1. **Clone the repository**

```bash
git clone https://github.com/heroku/heroku-cli-plugin-previews.git
cd heroku-cli-plugin-previews
```

2. **Install dependencies**

```bash
yarn install
```

3. **Build the plugin**

```bash
yarn build
```

This compiles TypeScript files from `src/` to `lib/`.

4. **Link the plugin to Heroku CLI**

```bash
heroku plugins:link .
```

This allows you to test your local changes with the `heroku` command.

5. **Verify installation**

```bash
heroku previews --help
heroku experiments --help
heroku xp --help
```

## Running Tests

### Run all tests

```bash
yarn test
```

This runs the full Mocha test suite located in `test/`.

### Run tests for specific commands

```bash
# Test a specific command
yarn test test/commands/experiments/create.test.ts

# Test all experiments commands
yarn test test/commands/experiments/*.test.ts
```

### Run tests in watch mode

```bash
npx mocha --watch "test/**/*.test.ts"
```

### Run linting

```bash
yarn lint
```

Fix auto-fixable linting issues:

```bash
yarn lint --fix
```

### Test configuration

- Test framework: **Mocha** with **Chai** assertions
- Mocking: **Sinon** for stubbing Heroku API calls
- Test files: `test/**/*.test.ts`
- Test setup: `test/helpers/setup.ts`
- Test TypeScript config: `test/tsconfig.json`

## Code Style

### TypeScript Guidelines

- **Strict mode enabled**: All TypeScript strict checks are enforced
- **Target**: ES2021
- **Module system**: CommonJS
- **Linting**: ESLint with oclif TypeScript config

### Formatting Standards

- **Indentation**: 2 spaces
- **Semicolons**: Required
- **Quotes**: Single quotes for strings
- **Line length**: 120 characters maximum
- **Trailing commas**: Required for multiline arrays/objects

### File Organization

```
src/
├── commands/          # CLI command implementations
│   ├── experiments/   # experiments:* commands
│   ├── previews/      # previews:* commands
│   └── xp/            # xp:* commands (aliases)
├── lib/               # Shared utilities
└── types/             # TypeScript type definitions
```

### Command Structure

All commands should extend `@heroku-cli/command` and follow this pattern:

```typescript
import {Command, flags} from '@heroku-cli/command'
import {Args} from '@oclif/core'

export default class MyCommand extends Command {
  static description = 'Brief description'
  
  static examples = [
    '$ heroku mycommand --app myapp',
  ]
  
  static flags = {
    app: flags.app({required: true}),
    remote: flags.remote(),
  }
  
  static args = {
    name: Args.string({required: true}),
  }
  
  async run(): Promise<void> {
    const {args, flags} = await this.parse(MyCommand)
    // Implementation
  }
}
```

### Security Guidelines

All code must follow security best practices:

1. **Input Validation**: Validate all user inputs for length, format, and dangerous characters
2. **Command Injection**: Use proper escaping for shell commands (see `src/lib/shell.ts`)
3. **JSON Security**: Validate against prototype pollution when parsing JSON
4. **Path Traversal**: Normalize and validate paths to prevent `..` and `//` sequences
5. **CRLF Injection**: Reject carriage return and line feed characters in headers
6. **Resource Limits**: Enforce maximum limits (e.g., 50 preview environments)

See [SECURITY.md](/Users/cambrose/Documents/heroku-previews-plugin/SECURITY.md) for detailed security considerations.

## Testing with Real Apps

### Manual Testing Workflow

1. **Create a test Heroku app**

```bash
heroku create my-test-app
```

2. **Deploy a simple app**

```bash
# Create a minimal Node.js app
mkdir test-app && cd test-app
npm init -y
echo "console.log('Hello')" > index.js
echo "web: node index.js" > Procfile
git init && git add . && git commit -m "Initial commit"
git push heroku main
```

3. **Add the buildpack**

```bash
# Add your local buildpack for testing
heroku buildpacks:add file:///path/to/heroku-previews-plugin/buildpack --app my-test-app
git commit --allow-empty -m "Add buildpack"
git push heroku main
```

4. **Test CLI commands**

```bash
# Create a preview
heroku previews:create --app my-test-app --branch test-branch --weight 10 --mirror

# List previews
heroku previews:list --app my-test-app

# Get info
heroku previews:info --app my-test-app --branch test-branch

# Update preview
heroku previews:update --app my-test-app --branch test-branch --weight 20

# Destroy preview
heroku previews:destroy --app my-test-app --branch test-branch
```

5. **Verify configuration**

```bash
# Check HEROKU_PREVIEWS config var
heroku config:get HEROKU_PREVIEWS --app my-test-app | jq .

# Check Traefik configuration
heroku run 'cat .heroku/traefik/config/dynamic/*.yml' --app my-test-app
```

### Testing Traffic Routing

1. **Set up routing rules**

```bash
heroku previews:create --app my-test-app --branch test \
  --weight 10 \
  --path /test \
  --query branch=test \
  --header x-test=true \
  --mirror
```

2. **Deploy to activate**

```bash
git commit --allow-empty -m "Update routing"
git push heroku main
```

3. **Test routing**

```bash
# Test weight-based routing (repeat multiple times)
curl https://my-test-app.herokuapp.com

# Test path-based routing
curl https://my-test-app.herokuapp.com/test

# Test query parameter routing
curl https://my-test-app.herokuapp.com?branch=test

# Test header-based routing
curl -H "x-test: true" https://my-test-app.herokuapp.com
```

### Buildpack Testing

To test buildpack changes locally:

```bash
# Make changes to buildpack/
cd buildpack/

# Test locally with a sample app
cd /path/to/test-app
heroku buildpacks:clear --app my-test-app
heroku buildpacks:add file:///path/to/heroku-previews-plugin/buildpack --app my-test-app
git push heroku main

# Check logs for buildpack output
heroku logs --app my-test-app --tail
```

## Pull Request Guidelines

### Before Submitting

1. **Run tests**: Ensure all tests pass (`yarn test`)
2. **Run linter**: Fix all linting issues (`yarn lint`)
3. **Build successfully**: Ensure TypeScript compiles (`yarn build`)
4. **Test manually**: Verify your changes with a real Heroku app
5. **Update documentation**: Update README.md, FEATURES.md, or other docs if needed
6. **Add tests**: Include tests for new features or bug fixes

### PR Description Template

```markdown
## Summary

Brief description of what this PR does.

## Motivation

Why is this change needed? What problem does it solve?

## Changes

- Bullet point list of changes
- Include any breaking changes
- Note any new dependencies

## Testing

- [ ] All existing tests pass
- [ ] Added new tests for changes
- [ ] Manually tested with Heroku app
- [ ] Verified buildpack changes (if applicable)

## Documentation

- [ ] Updated README.md
- [ ] Updated CHANGELOG.md
- [ ] Updated relevant feature docs

## Security

- [ ] No security vulnerabilities introduced
- [ ] Input validation implemented
- [ ] Follows security guidelines in SECURITY.md
```

### PR Review Process

1. **Submit PR**: Push your branch and create a PR against `main`
2. **CI checks**: Automated tests and linting must pass
3. **Code review**: At least one maintainer approval required
4. **Manual testing**: Reviewer may test changes with a real app
5. **Merge**: Maintainer will merge once approved

### Branch Naming

- Feature: `feature/short-description`
- Bug fix: `fix/short-description`
- Documentation: `docs/short-description`
- Security: `security/short-description`

### Commit Messages

- Use present tense: "Add feature" not "Added feature"
- Use imperative mood: "Fix bug" not "Fixes bug"
- Keep first line under 70 characters
- Reference issues: "Fix routing bug (#123)"

## Release Process

### Version Numbering

This project follows [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes, backward compatible

### Release Steps (Maintainers Only)

1. **Update version**

```bash
# For patch release (1.0.0 -> 1.0.1)
npm version patch

# For minor release (1.0.0 -> 1.1.0)
npm version minor

# For major release (1.0.0 -> 2.0.0)
npm version major
```

2. **Update CHANGELOG.md**

Add release notes under a new version heading:

```markdown
## [1.1.0] - 2026-06-19

### Added
- New traffic mirroring feature
- JSONPath body routing

### Fixed
- Path traversal vulnerability

### Changed
- Improved error messages
```

3. **Build and verify**

```bash
yarn clean
yarn build
yarn test
yarn lint
```

4. **Create release commit**

```bash
git add .
git commit -m "Release v1.1.0"
git tag v1.1.0
```

5. **Push to GitHub**

```bash
git push origin main --tags
```

6. **Publish to npm**

```bash
npm publish --access public
```

7. **Create GitHub Release**

- Go to GitHub Releases
- Create new release from tag
- Copy CHANGELOG.md entry as release notes
- Attach any relevant files

8. **Announce release**

- Update README.md badges if needed
- Notify users in relevant channels
- Update documentation site (if applicable)

### Pre-release Testing

Before releasing:

1. Test with multiple Heroku apps
2. Verify all commands work
3. Test buildpack compilation
4. Verify traffic routing works
5. Check backward compatibility
6. Review security implications

## Security

### Reporting Vulnerabilities

**Do not open public issues for security vulnerabilities.**

Email security@heroku.com with:
1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if available)

See [SECURITY.md](/Users/cambrose/Documents/heroku-previews-plugin/SECURITY.md) for full security policy.

### Security Testing

Always test security implications:

```bash
# Test command injection resistance
heroku previews:create --app test --branch "'; rm -rf /" --weight 10

# Test path traversal
heroku previews:create --app test --branch test --path "../etc/passwd"

# Test CRLF injection
heroku previews:create --app test --branch test --header "x-test: value\r\nInjected: true"

# Test prototype pollution
heroku config:set HEROKU_PREVIEWS='{"__proto__": {"polluted": true}}' --app test
```

All of these should be rejected with appropriate error messages.

## Questions?

- **Documentation**: See [README.md](/Users/cambrose/Documents/heroku-previews-plugin/README.md), [QUICKSTART.md](/Users/cambrose/Documents/heroku-previews-plugin/QUICKSTART.md), [FEATURES.md](/Users/cambrose/Documents/heroku-previews-plugin/FEATURES.md)
- **Issues**: Open an issue on GitHub
- **Security**: Email security@heroku.com
- **General questions**: Open a discussion on GitHub

Thank you for contributing!
