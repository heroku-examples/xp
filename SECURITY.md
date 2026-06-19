# Security Policy

## Security Considerations

This project implements several security measures based on the comprehensive security review:

### CLI Plugin Security

1. **Command Injection Prevention**: All user inputs displayed in shell commands are escaped using shell quoting
2. **JSON Prototype Pollution Protection**: HEROKU_XP config var parsing includes validation against dangerous prototype properties
3. **Path Traversal Prevention**: Routing paths are normalized and validated to reject `..` and `//` sequences
4. **CRLF Injection Prevention**: Header values are validated to reject carriage return and line feed characters
5. **Input Length Limits**: All user inputs have maximum length constraints (branch: 100 chars, path: 200 chars, values: 1KB, jq filter: 500 chars)
6. **Resource Limits**: Maximum 50 concurrent preview environments to prevent config exhaustion

### Buildpack Security

1. **Checksum Verification**: Traefik binary download is verified against SHA256 checksums from GitHub releases
2. **JSON Validation**: HEROKU_XP is validated as proper JSON before parsing
3. **Safe Config Generation**: Uses Python with PyYAML for safe YAML generation, falls back to bash with careful escaping
4. **Temporary File Safety**: Uses `mktemp` for temporary files to avoid race conditions

## Reporting a Vulnerability

If you discover a security vulnerability, please email security@heroku.com with:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if available)

**Please do not open public issues for security vulnerabilities.**

## Security Best Practices for Users

1. **Limit Access**: Only grant Heroku app access to trusted team members
2. **Review Changes**: Always review `HEROKU_XP` config changes before deploying
3. **Monitor Preview Environments**: Regularly audit active preview environments with `heroku xp:list`
4. **Set TTLs**: Use `--ttl` flag to auto-expire preview environments
5. **Validate Preview Apps**: Ensure preview apps don't contain sensitive data or secrets
6. **Use Read-Only Databases**: Configure preview apps to use read-only database replicas when possible

## Known Limitations

1. **Preview App Access**: Preview apps must be publicly accessible via `.herokuapp.com` URLs
2. **Config Size**: HEROKU_XP limited to 32KB (approximately 50-80 preview environments)
3. **Deploy-time Config**: Routing changes require a deploy to take effect (not runtime updates)

## Threat Model

### In Scope

- Command injection via CLI inputs
- JSON injection via HEROKU_XP config var
- Path traversal via routing paths
- CRLF injection via header values
- Prototype pollution via JSON parsing
- Supply chain attacks via Traefik binary download

### Out of Scope

- Heroku platform security (authentication, authorization, network isolation)
- Preview app security (each app is responsible for its own security)
- DDoS attacks (Heroku platform handles this)
- Physical security of Heroku infrastructure

## Security Updates

Security patches will be released as soon as possible after verification. Users should:

1. Subscribe to GitHub releases for notifications
2. Regularly update the plugin: `heroku plugins:update`
3. Rebuild apps to get buildpack updates: `git push heroku main`

## Audit History

- **2026-06-18**: Initial security review by workflow subagents
  - Identified and fixed CRITICAL command injection vulnerabilities
  - Implemented JSON prototype pollution protection
  - Added path traversal and CRLF injection validation
  - Implemented resource limits

## Security Testing

The project includes security-focused tests:

```bash
# Run security tests
yarn test:security

# Test command injection
yarn test test/security/command-injection.test.ts

# Test JSON security
yarn test test/security/json-security.test.ts
```

## Responsible Disclosure Timeline

- **Day 0**: Vulnerability reported to security@heroku.com
- **Day 1-2**: Vulnerability confirmed and severity assessed
- **Day 3-7**: Patch developed and tested
- **Day 7-14**: Patch released, users notified
- **Day 30**: Public disclosure (if vulnerability is fixed)
