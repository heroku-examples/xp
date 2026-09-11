# Heroku XP (Experiments)

<a href="https://drive.google.com/file/d/1D_mtNkTVWTJvP9AwHAerH2EhD3VN-zKR/view"><img width="1860" height="1206" alt="image" src="https://github.com/user-attachments/assets/ed788267-a657-4819-8858-f06f500999ad" /></a>


[video](https://drive.google.com/file/d/1D_mtNkTVWTJvP9AwHAerH2EhD3VN-zKR/view) | [slides](https://docs.google.com/presentation/d/1KvxAeJ0Xug6wQNI0cdC4rvCINTaKzChldM2JTwtH5n4/edit?usp=sharing)

## Overview

**Test features with real traffic before full rollout.** Unlike review apps (which are isolated sandboxes), experiments enable you to:

- **Route a percentage of production traffic** to experimental builds (e.g., 10% of users see the new feature)
- **Target specific user segments** using paths, query parameters, headers, or JSON body matching
- **Mirror traffic** to both versions for zero-impact
- **Share Config Vars and environment** inherit app configuration automatically
- **Auto-expire experiments** with configurable time-to-live (TTL)
- **Monitor real-time metrics** comparing experiment vs. production performance

## Quick Installation

```bash
# Install the CLI plugin
heroku plugins:install @heroku-cli/xp
```

## Basic Usage

### Create an Experiment

```bash
# Route 50% of traffic to a new feature branch
heroku xp:create \
  --app myapp \
  --branch new-ui \
  --weight 50
```

### Monitor Performance

```bash
# View real-time traffic comparison
heroku xp:watch --app prod-app
```

### Update Routing Rule

```bash
# Lower to 1% of traffic
heroku xp:update -app myapp --branch new-ui \
  --weight 1
```

### Advanced Routing

```bash
# Route specific paths to experiment
heroku xp:create --app myapp --branch api-v2 \
  --path /api/v2

# Route beta users via JSON body content
heroku xp:create --app myapp --branch beta-user \
  --body-json '$.user.id == 123'

# Mirror all traffic to git tag to load test for 5 min
heroku xp:create --app myapp --branch v1.1 \
  --path / --mirror --ttl 5min
```

### Clean Up

```bash
# Stop routing traffic
heroku xp:stop --app myapp --branch new-ui

# Destroy experiment completely
heroku xp:destroy --app myapp --branch exp-new-ui --confirm prod-app
```

## Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - Get up and running in 5 minutes
- **[FEATURES.md](FEATURES.md)** - Deep dive into JSONPath routing, traffic mirroring, and stats
- **[EXAMPLE.md](EXAMPLE.md)** - Step-by-step walkthrough with real commands
- **[SECURITY.md](SECURITY.md)** - Security policy, best practices, and audit history
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Development setup and contribution guidelines

## Architecture

Heroku XP uses a **reverse proxy architecture** with Traefik running on your web dyno:

```
┌─────────────┐
│  Internet   │
└──────┬──────┘
       │
       ▼
┌───────────────────────────────────┐
│  Parent App Dyno     │
│  ┌─────────────────────────────┐  │
│  │  Traefik Proxy ($PORT)      │  │
│  │  • Weight: 10%              │  │
│  │  • Path: /exp/*             │  │
│  │  • Query: ?exp=...          │  │
│  │  • Header: x-exp=...        │  │
│  └─────────┬───────────────────┘  │
│            │                       │
│      ┌─────┴──────┐               │
│      │            │               │
│   90%│         10%│               │
│      ▼            ▼               │
│  ┌────────┐  (external URL)      │
│  │Prod App│                       │
│  │ :5000  │                       │
│  └────────┘                       │
└────────────────┼───────────────────┘
                 │
                 ▼
     ┌────────────────────────┐
     │  Experiment App        │
     │  myapp-exp-123-a7f3d   │
     └────────────────────────┘
```

### How It Works

1. **Plugin configures routing**: `heroku xp:create` updates `HEROKU_EXPERIMENTS` config var on parent app
2. **Buildpack installs Traefik**: On deploy, the buildpack generates Traefik routing rules from `HEROKU_EXPERIMENTS`
3. **Traefik routes traffic**: All traffic flows through Traefik on `$PORT`, which routes based on configured rules
4. **Experiment app runs independently**: Separate Heroku app with its own dynos, config, and slug
5. **Real-time metrics**: Traefik logs traffic stats for parent vs. experiment comparison

## Routing Features

### Weight-Based Routing

Probabilistic load balancing - route a percentage of requests to the experiment:

```bash
heroku xp:create --app prod-app --name exp-gradual \
  --copy-parent --weight 10
```

### Path-Based Routing

Route specific URL paths to the experiment:

```bash
heroku xp:create --app prod-app --name exp-new-checkout \
  --tarball https://github.com/myorg/myrepo/tarball/new-checkout \
  --path /checkout
```

### Query Parameter Routing

Route requests with specific query parameters:

```bash
heroku xp:create --app prod-app --name exp-beta \
  --copy-parent --query beta=true
```

### Header-Based Routing

Route requests with specific HTTP headers:

```bash
heroku xp:create --app prod-app --name exp-mobile \
  --copy-parent --header x-mobile-app=true
```

### JSON Body Routing

Route based on JSON request body content using JSONPath:

```bash
heroku xp:create --app prod-app --name exp-enterprise \
  --copy-parent --body-json '$.account.tier == "enterprise"'
```

### Traffic Mirroring

Send traffic to BOTH parent and experiment (users always get parent response):

```bash
heroku xp:create --app prod-app --name exp-load-test \
  --copy-parent --mirror-traffic
```

See [FEATURES.md](FEATURES.md) for detailed routing documentation.

## Commands

| Command | Description |
|---------|-------------|
| `heroku xp:create` | Create a new experiment with routing configuration |
| `heroku xp:list` | List all experiments for a parent app |
| `heroku xp:info` | Show detailed information and traffic statistics |
| `heroku xp:update` | Update routing configuration for an experiment |
| `heroku xp:start` | Resume routing traffic to a stopped experiment |
| `heroku xp:stop` | Stop routing traffic (keeps app running) |
| `heroku xp:destroy` | Permanently delete an experiment and its app |
| `heroku xp:watch` | Watch experiment traffic in real-time |

All commands support both `xp:` and `experiments:` prefixes.

Run `heroku xp:COMMAND --help` for detailed usage information.

## Local Testing

Test experiments locally before deploying to production:

```bash
# Start local Traefik proxy
cd test/local
./start-local-proxy.sh

# Configure experiments
export HEROKU_EXPERIMENTS='{"version":1,"experiments":{...}}'

# Test routing
curl http://localhost:5000
```

See [test/local/README.md](test/local/README.md) for complete local testing setup.

## Use Cases

### Gradual Rollout

Test a new feature with progressively more traffic:

```bash
# Step 1: Start with 5%
heroku xp:create --app prod-app --name exp-new-ui --weight 5 --tarball URL

# Step 2: Monitor metrics
heroku xp:info --app prod-app --name exp-new-ui --period 24h

# Step 3: Increase to 25% if metrics look good
heroku xp:update --app prod-app --name exp-new-ui --weight 25

# Step 4: Full rollout - merge to main and destroy experiment
```

### Beta User Testing

Route only beta users to experiment:

```bash
heroku xp:create --app prod-app --name exp-beta-features \
  --copy-parent \
  --body-json '$.user.beta == true' \
  --header x-beta=true
```

### API Versioning

Test new API version on specific path:

```bash
heroku xp:create --app prod-app --name exp-api-v2 \
  --tarball https://github.com/myorg/myrepo/tarball/api-v2 \
  --path /api/v2
```

### Load Testing

Test performance with production traffic without user impact:

```bash
heroku xp:create --app prod-app --name exp-load-test \
  --copy-parent \
  --mirror-traffic \
  --ttl 2h
```

See [EXAMPLE.md](EXAMPLE.md) for detailed workflow examples.

## Differences from Review Apps

| Feature | Review Apps | Heroku XP |
|---------|-------------|-----------|
| **Purpose** | Pre-merge testing in isolated environments | Production A/B testing with real traffic |
| **Requires Pipeline** | Yes | No, works with any Heroku app |
| **Traffic Routing** | None (manual access only) | Weight, path, query, headers, JSON body |
| **Production Traffic** | No | Receives real production traffic |
| **Metrics** | Basic dyno stats only | Real-time traffic comparison |
| **Traffic Mirroring** | Not supported | Supported |
| **Source** | Automatically from PR branches | Flexible: tarballs, parent slug, or manual |
| **Use Case** | Testing before merge | Testing in production with controlled exposure |

## Limitations

- Maximum 50 experiments per app (plugin enforced)
- 32KB config var size limit (Heroku platform limit)
- Routing changes require deploy to take effect (not runtime updates)
- Stats reset on dyno restart (not persistent)
- Experiment apps must be publicly accessible (no VPC peering support)
- JSON body routing adds ~5-10ms latency (body buffering required)

## Security

Heroku XP implements comprehensive security measures:

- **Command injection protection** - All shell inputs properly escaped
- **JSON prototype pollution protection** - Safe parsing with validation
- **Path traversal prevention** - Normalized and validated paths
- **CRLF injection prevention** - Header value validation
- **Traefik binary verification** - SHA256 checksum validation
- **Input length limits** - Maximum constraints on all user inputs
- **Resource limits** - Maximum 50 experiments to prevent config exhaustion

See [SECURITY.md](SECURITY.md) for complete security policy and best practices.

### Reporting Security Issues

For security vulnerabilities, please email **security@heroku.com**. Do not open public GitHub issues.

## Requirements

- Heroku CLI installed
- Node.js >= 18.0.0 (for plugin development)
- A deployed Heroku app
- Git repository

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development setup
- Running tests
- Code style guidelines
- Pull request process
- Security testing

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- **Documentation**: See documentation links above
- **Issues**: [GitHub Issues](https://github.com/heroku/experiments/issues)
- **Questions**: [GitHub Discussions](https://github.com/heroku/experiments/discussions)
- **Security**: security@heroku.com

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

---

**Ready to experiment?** Start with [QUICKSTART.md](QUICKSTART.md) to get up and running in 5 minutes.
