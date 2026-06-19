# Heroku Experiments

A Heroku CLI plugin for creating and managing experiment apps with advanced traffic routing and A/B testing capabilities.

## Table of Contents

- [What is Heroku Experiments?](#what-is-heroku-experiments)
- [How It Differs from Review Apps](#how-it-differs-from-review-apps)
- [Architecture](#architecture)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Routing Features](#routing-features)
- [Configuration](#configuration)
- [Workflow Examples](#workflow-examples)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [Security](#security)

## What is Heroku Experiments?

Heroku Experiments is a CLI plugin that enables **production A/B testing and experimentation** by creating temporary experiment apps that receive a portion of your production traffic. Unlike traditional deployment workflows, experiments allow you to:

- **Test new features with real production traffic** using weight-based routing (e.g., 10% of users see the new feature)
- **Route specific user segments** to experimental builds using paths, query parameters, headers, or JSON body matching
- **Mirror traffic** to test performance and stability without affecting user experience
- **Compare metrics** between your production app and experiment apps in real-time
- **Auto-expire experiments** with configurable TTLs
- **Create experiments from any source**: GitHub tarballs, parent app slugs, or manual deployments

## How It Differs from Review Apps

| Feature | Review Apps | Heroku Experiments |
|---------|-------------|-------------------|
| **Purpose** | Pre-merge testing in isolated environments | Production A/B testing with real traffic |
| **Requires Pipeline** | Yes, must be part of a Heroku Pipeline | No, works with any Heroku app |
| **Traffic Routing** | None (manual access only) | Advanced routing: weight, path, query, headers, JSON body |
| **Source** | Automatically created from PR branches | Flexible: tarballs, parent slug, or manual |
| **Production Traffic** | No production traffic | Receives real production traffic via routing rules |
| **Metrics** | Basic dyno stats only | Real-time traffic comparison and performance metrics |
| **Traffic Mirroring** | Not supported | Mirror requests to both apps for zero-impact testing |
| **Use Case** | Testing features before merge | Testing features in production with controlled exposure |

**Key Difference**: Review apps are for pre-production testing. Experiments are for controlled production testing with real users.

## Architecture

Heroku Experiments uses a **reverse proxy architecture** with Traefik running on your parent app's dyno:

```
                 ┌─────────────┐
                 │  Internet   │
                 └──────┬──────┘
                        │
                        ▼
        ┌───────────────────────────────────┐
        │  Parent App Dyno (Production)     │
        │  ┌─────────────────────────────┐  │
        │  │  Traefik Proxy ($PORT)      │  │
        │  │  ┌───────────────────────┐  │  │
        │  │  │  Routing Engine       │  │  │
        │  │  │  • Weight: 10%        │  │  │
        │  │  │  • Path: /exp/*       │  │  │
        │  │  │  • Query: ?exp=...    │  │  │
        │  │  │  • Header: x-exp=...  │  │  │
        │  │  │  • Body: $.user.beta  │  │  │
        │  │  └───────┬───────────────┘  │  │
        │  └──────────┼───────────────────┘  │
        │             │                       │
        │      ┌──────┴───────┐              │
        │      │              │              │
        │   90%│           10%│              │
        │      ▼              ▼              │
        │  ┌─────────┐   (proxy to)         │
        │  │Prod App │   external URL       │
        │  │ :5000   │                       │
        │  └─────────┘                       │
        └───────────────────┼─────────────────┘
                            │
                            ▼
                ┌────────────────────────┐
                │  Experiment App        │
                │  myapp-exp-123-a7f3d   │
                │  (separate dyno)       │
                └────────────────────────┘
```

### How It Works

1. **Plugin configures routing**: `heroku experiments:create` updates `HEROKU_EXPERIMENTS` config var on parent app
2. **Buildpack generates Traefik config**: On deploy, the dyno-proxy buildpack reads `HEROKU_EXPERIMENTS` and generates Traefik routing rules
3. **Traefik routes traffic**: All production traffic flows through Traefik, which routes based on rules:
   - Weight-based: Probabilistic load balancing (e.g., 10% → experiment)
   - Path/query/header/body: Deterministic routing based on request attributes
4. **Experiment app runs independently**: Separate Heroku app with its own dynos, config, and slug
5. **App-setups API creates experiments**: New experiment apps are created via Heroku's app-setups API, copying from parent or tarball

## Installation

### Step 1: Install CLI Plugin

```bash
heroku plugins:install @heroku-cli/plugin-previews
```

### Step 2: Add Dyno-Proxy Buildpack

The dyno-proxy buildpack installs Traefik on your parent app. It must be added **after** your language buildpack:

```bash
# Example for Node.js app
heroku buildpacks:add heroku/nodejs --app myapp
heroku buildpacks:add https://github.com/heroku/heroku-buildpack-dyno-proxy --app myapp
```

### Step 3: Update Procfile

Wrap your start command with `traefik-wrapper`:

```
web: traefik-wrapper npm start
```

The wrapper:
- Starts Traefik on `$PORT` (Heroku's assigned port)
- Sets `PORT=5000` for your app
- Routes traffic according to `HEROKU_EXPERIMENTS` config

### Step 4: Deploy

```bash
git add Procfile
git commit -m "Add Traefik proxy for experiments"
git push heroku main
```

## Quick Start

### Create Your First Experiment

```bash
# Create experiment with 10% weight-based traffic split
heroku experiments:create \
  --app prod-app \
  --name exp-new-ui \
  --tarball https://github.com/myorg/myrepo/tarball/new-ui-branch \
  --weight 10

# Or copy from parent app
heroku xp:create \
  --app prod-app \
  --name exp-new-ui \
  --copy-parent \
  --weight 10
```

### Deploy Parent App to Activate

Routing changes require a redeploy to regenerate Traefik config:

```bash
git commit --allow-empty -m "Activate experiment exp-new-ui"
git push heroku main
```

### View Experiment Status

```bash
# List all experiments
heroku experiments:list --app prod-app

# View detailed stats
heroku experiments:info --app prod-app --name exp-new-ui
```

### Clean Up

```bash
# Stop routing (keeps app running)
heroku experiments:stop --app prod-app --name exp-new-ui

# Destroy completely (deletes app)
heroku experiments:destroy --app prod-app --name exp-new-ui --confirm exp-new-ui
```

## Commands

All commands support `xp:` alias (e.g., `heroku xp:create` instead of `heroku experiments:create`).

### `experiments:create`

Create a new experiment app with routing configuration.

```bash
heroku experiments:create \
  --app PARENT_APP \
  --name EXPERIMENT_NAME \
  [--tarball URL | --copy-parent] \
  [--weight PERCENT] \
  [--path PATH] \
  [--query KEY=VALUE] \
  [--header KEY=VALUE] \
  [--body-json JSONPATH] \
  [--mirror-traffic] \
  [--ttl DURATION] \
  [--description TEXT]
```

**Options:**

- `--name`, `-n`: Unique experiment identifier (alphanumeric, hyphens, underscores)
- `--tarball`: GitHub tarball URL or custom tarball URL for source code
- `--copy-parent`: Copy slug from parent app (alternative to tarball)
- `--weight`, `-w`: Traffic weight percentage (0-100) for probabilistic routing
- `--path`, `-p`: Path-based routing (e.g., `/experiment/exp-123`), can specify multiple
- `--query`, `-q`: Query parameter routing (e.g., `experiment=exp-123`), can specify multiple
- `--header`, `-h`: Header-based routing (e.g., `x-experiment=exp-123`), can specify multiple
- `--body-json`: JSONPath expression for request body routing (e.g., `$.user.type == 'beta'`)
- `--mirror-traffic`: Send traffic to BOTH parent and experiment (for load testing)
- `--ttl`, `-t`: Auto-expire after duration (e.g., `1h`, `2d`, `30m`)
- `--description`: Human-readable description
- `--region`: Heroku region (default: `us`)
- `--stack`: Heroku stack (default: `heroku-22`)

**Examples:**

```bash
# Weight-based routing (10% of traffic)
heroku xp:create --app prod-app --name exp-123 \
  --tarball https://github.com/myorg/myrepo/tarball/feature-xyz \
  --weight 10

# Path-based routing
heroku xp:create --app prod-app --name exp-123 \
  --copy-parent \
  --path /experiment/exp-123

# Combined routing with TTL
heroku xp:create --app prod-app --name exp-123 \
  --tarball https://github.com/myorg/myrepo/tarball/feature-xyz \
  --weight 10 \
  --path /experiment/exp-123 \
  --query experiment=exp-123 \
  --header x-experiment=exp-123 \
  --ttl 24h

# Traffic mirroring (zero-impact testing)
heroku xp:create --app prod-app --name exp-load-test \
  --copy-parent \
  --mirror-traffic
```

### `experiments:list`

List all experiments for a parent app.

```bash
heroku experiments:list --app PARENT_APP [--json]
```

**Output:**

```
═══════════════════════════════════════════════════════════
  Experiments for prod-app
═══════════════════════════════════════════════════════════

NAME        APP NAME                STATUS    WEIGHT   CREATED
exp-123     prod-app-exp-123-a7f3   active    10%      2h ago
exp-456     prod-app-exp-456-b8e4   stopped   -        1d ago

─────────────────────────────────────────────────────────
Summary:
  Total experiments: 2
  Active: 1
  Stopped: 1
  Expired: 0
  Total active weight: 10%

Active routing methods:
  Weight-based: 1
  Path-based: 1
  Query-based: 1
```

### `experiments:info`

Show detailed information and traffic statistics for an experiment.

```bash
heroku experiments:info \
  --app PARENT_APP \
  --name EXPERIMENT_NAME \
  [--period DURATION] \
  [--json]
```

**Options:**

- `--period`, `-p`: Time period for stats (e.g., `1h`, `6h`, `24h`, `7d`), default: `1h`

**Output:**

```
═══════════════════════════════════════════════════════════
  Experiment: exp-123
  Period: 1h
═══════════════════════════════════════════════════════════

Configuration:
  App: prod-app-exp-123-a7f3
  Status: active
  Created: 2026-06-19 10:30:00
  Source: https://github.com/myorg/myrepo/tarball/feature-xyz
  Version: feature-xyz

Routing:
  Weight: 10%
  Paths: /experiment/exp-123
  Queries: experiment=exp-123
  Headers: x-experiment=exp-123

───────────────────────────────────────────────────────────
Traffic Comparison:
───────────────────────────────────────────────────────────
Metric               Parent App    Experiment App  Difference
Total Requests       9,000         1,000           
Throughput (req/min) 150.00        16.67           +11.1%
Avg Response Time    245ms         198ms           -47ms (better)
Error Rate           0.50%         0.30%           -0.2% (better)

Traffic Split: 90.0% Parent / 10.0% Experiment

───────────────────────────────────────────────────────────
Response Time Comparison:
───────────────────────────────────────────────────────────

Parent      ████████████████████████████████████████ 245ms
Experiment  ████████████████████████████████░░░░░░░░ 198ms

✓ Experiment is 19.2% faster
```

### `experiments:update`

Update routing configuration for an existing experiment.

```bash
heroku experiments:update \
  --app PARENT_APP \
  --name EXPERIMENT_NAME \
  [--weight PERCENT] \
  [--path PATH] \
  [--query KEY=VALUE] \
  [--header KEY=VALUE] \
  [--body-json JSONPATH] \
  [--mirror-traffic | --no-mirror-traffic] \
  [--ttl DURATION]
```

**Examples:**

```bash
# Update weight
heroku xp:update --app prod-app --name exp-123 --weight 20

# Update routing methods
heroku xp:update --app prod-app --name exp-123 \
  --path /experiment/exp-123 \
  --header x-experiment=exp-123

# Enable traffic mirroring
heroku xp:update --app prod-app --name exp-123 --mirror-traffic

# Extend TTL
heroku xp:update --app prod-app --name exp-123 --ttl 48h
```

### `experiments:start`

Resume routing traffic to a stopped experiment.

```bash
heroku experiments:start --app PARENT_APP --name EXPERIMENT_NAME
```

**What it does:**

- Changes experiment status from `stopped` to `active`
- Scales experiment app web dynos to 1 if currently at 0
- Updates `HEROKU_EXPERIMENTS` config var

**Note:** Requires redeploy to regenerate Traefik routing rules.

### `experiments:stop`

Stop routing traffic to an experiment (keeps app running).

```bash
heroku experiments:stop --app PARENT_APP --name EXPERIMENT_NAME
```

**What it does:**

- Changes experiment status to `stopped`
- Stops routing traffic to experiment
- Does NOT scale down or delete the app

**Use case:** Temporarily pause an experiment without destroying it.

### `experiments:destroy`

Permanently delete an experiment and its app.

```bash
heroku experiments:destroy \
  --app PARENT_APP \
  --name EXPERIMENT_NAME \
  --confirm EXPERIMENT_NAME
```

**What it does:**

- Removes experiment from `HEROKU_EXPERIMENTS` config
- Deletes the experiment app via Heroku API
- Requires explicit confirmation to prevent accidental deletion

### `experiments:watch`

Watch experiment traffic in real-time (continuous monitoring).

```bash
heroku experiments:watch \
  --app PARENT_APP \
  --name EXPERIMENT_NAME \
  [--interval SECONDS]
```

**Options:**

- `--interval`: Refresh interval in seconds (default: 10)

## Routing Features

### Weight-Based Routing

Probabilistic load balancing: randomly route a percentage of requests to the experiment.

```bash
heroku xp:create --app prod-app --name exp-perf \
  --copy-parent \
  --weight 15
```

**Use cases:**
- Gradual rollouts (start at 5%, increase to 50%)
- A/B testing (50/50 split)
- Canary deployments

**How it works:**
- Traefik uses weighted round-robin
- Each request has a 15% chance of routing to experiment
- Not sticky sessions (subsequent requests may route differently)

### Path-Based Routing

Route requests matching specific URL paths.

```bash
heroku xp:create --app prod-app --name exp-api \
  --tarball https://github.com/myorg/myrepo/tarball/api-v2 \
  --path /api/v2 \
  --path /graphql
```

**Use cases:**
- API versioning (`/api/v2` → new version)
- Feature-specific routes (`/checkout` → redesigned checkout)
- Admin interfaces (`/admin` → new admin panel)

**Behavior:**
- Exact prefix match: `/api/v2/users` matches `--path /api/v2`
- Multiple paths supported
- Path is stripped before forwarding to experiment app

### Query Parameter Routing

Route requests with specific query parameters.

```bash
heroku xp:create --app prod-app --name exp-beta \
  --copy-parent \
  --query beta=true \
  --query experiment=new-ui
```

**Use cases:**
- Beta opt-in: `?beta=true`
- Testing links: `?experiment=new-checkout`
- Debug mode: `?debug=experiment-123`

**Behavior:**
- Match any specified query parameter
- Value must match exactly
- Case-sensitive

### Header-Based Routing

Route requests with specific HTTP headers.

```bash
heroku xp:create --app prod-app --name exp-mobile \
  --tarball https://github.com/myorg/myrepo/tarball/mobile-opt \
  --header x-mobile-app=true \
  --header x-api-version=v2
```

**Use cases:**
- Mobile app routing: `X-Mobile-App: true`
- Internal testing: `X-Experiment: enabled`
- API versioning: `X-API-Version: v2`
- Feature flags from client: `X-Features: new-checkout`

**Behavior:**
- Header name and value must match exactly
- Case-insensitive header names (HTTP standard)
- Multiple headers supported (all must match)

### JSON Body Routing

Route requests based on JSON request body content using JSONPath expressions.

```bash
# Beta users only
heroku xp:create --app prod-app --name exp-beta-features \
  --copy-parent \
  --body-json '$.user.beta == true'

# Enterprise tier only
heroku xp:create --app prod-app --name exp-enterprise \
  --tarball https://github.com/myorg/myrepo/tarball/enterprise-features \
  --body-json '$.account.tier == "enterprise"'

# Specific product category
heroku xp:create --app prod-app --name exp-electronics \
  --copy-parent \
  --body-json '$.product.category == "electronics"'
```

**Use cases:**
- User segment routing (beta users, premium users)
- Tenant-based routing (enterprise vs. free tier)
- Feature flag routing (`$.features[?(@.name == "new-ui")].enabled == true`)
- Product-specific experiments

**Limitations:**
- Request body must be valid JSON
- Body size limited to 1MB
- Adds ~5-10ms latency due to body buffering
- Only works with POST/PUT/PATCH requests with JSON bodies

**Supported JSONPath syntax:**

```jsonpath
$.user.type                    # Simple property access
$.metadata.settings.theme      # Nested properties
$.items[0].id                  # Array access
$.products[?(@.price > 100)]   # Array filtering
$.user[?(@.age > 18 && @.verified == true)]  # Multiple conditions

# Operators: == != > < >= <= && ||
```

### Traffic Mirroring

Send requests to BOTH parent and experiment apps. Users always receive the parent app's response.

```bash
heroku xp:create --app prod-app --name exp-load-test \
  --copy-parent \
  --mirror-traffic
```

**Use cases:**
- Load testing (ensure experiment handles production traffic)
- Performance comparison (measure without user impact)
- Smoke testing (verify new deployment works before routing real traffic)

**Behavior:**
- User request → sent to BOTH apps in parallel
- User receives parent app response (always)
- Experiment response logged for metrics but not returned
- Zero user impact (experiment errors don't affect users)

### Routing Priority

When multiple routing methods are configured, Traefik evaluates in this order:

1. **Headers** (highest priority)
2. **Query Parameters**
3. **JSON Body**
4. **Paths**
5. **Weight** (lowest priority, probabilistic)

**Example:** A request with `x-experiment: exp-123` header will ALWAYS route to experiment, even if weight is only 10%.

## Configuration

### HEROKU_EXPERIMENTS Format

All experiment configurations are stored in the `HEROKU_EXPERIMENTS` config var as JSON:

```json
{
  "version": 1,
  "experiments": {
    "exp-123": {
      "name": "exp-123",
      "appName": "prod-app-exp-123-a7f3d",
      "createdAt": "2026-06-19T10:30:00Z",
      "updatedAt": "2026-06-19T10:30:00Z",
      "status": "active",
      "sourceType": "tarball",
      "sourceUrl": "https://github.com/myorg/myrepo/tarball/feature-xyz",
      "sourceVersion": "feature-xyz",
      "routing": {
        "weight": 10,
        "paths": ["/experiment/exp-123"],
        "queries": {
          "experiment": "exp-123"
        },
        "headers": {
          "x-experiment": "exp-123"
        },
        "bodyJson": "$.user.beta == true"
      },
      "mirror": false,
      "ttl": 86400,
      "expiresAt": "2026-06-20T10:30:00Z",
      "setupId": "a7f3d-1234-5678",
      "metadata": {
        "createdBy": "user@example.com",
        "description": "Testing new UI for beta users"
      }
    }
  }
}
```

**Field Descriptions:**

- `version`: Config format version (always `1`)
- `experiments`: Map of experiment name to experiment config
- `name`: Unique experiment identifier
- `appName`: Heroku app name for experiment app
- `status`: `active`, `stopped`, or `expired`
- `sourceType`: `tarball`, `parent`, or `manual`
- `sourceUrl`: URL of tarball (if `sourceType: tarball`)
- `sourceApp`: Parent app name (if `sourceType: parent`)
- `routing`: Routing configuration object
  - `weight`: Traffic percentage (0-100)
  - `paths`: Array of URL paths
  - `queries`: Map of query parameter key-value pairs
  - `headers`: Map of header key-value pairs
  - `bodyJson`: JSONPath expression string
- `mirror`: `false`, `true`, or `'both'` (traffic mirroring mode)
- `ttl`: Time-to-live in seconds
- `expiresAt`: ISO 8601 timestamp when experiment expires
- `setupId`: Heroku app-setups API ID
- `metadata`: Additional metadata (createdBy, description)

### Experiment App Naming

Experiment apps are automatically named using this pattern:

```
{parent-app}-{experiment-name}-{random-hash}
```

**Example:**

- Parent app: `prod-app`
- Experiment name: `exp-feature-xyz`
- Generated app name: `prod-app-exp-feature-xy-a7f3d` (max 30 chars)

### Environment Variables

Experiment apps automatically receive these environment variables:

- `HEROKU_EXPERIMENT_NAME`: Experiment name (e.g., `exp-123`)
- `HEROKU_EXPERIMENT_PARENT`: Parent app name
- `HEROKU_EXPERIMENT_CREATED`: ISO 8601 creation timestamp

### Config Var Inheritance

Experiment apps **do not** inherit config vars from parent app by default. You must set them manually:

```bash
# Copy specific config vars
heroku config:get DATABASE_URL --app prod-app | \
  xargs heroku config:set DATABASE_URL= --app prod-app-exp-123-a7f3d

# Or use Heroku CLI to copy all
heroku config --app prod-app --shell | \
  xargs heroku config:set --app prod-app-exp-123-a7f3d
```

**Security note:** Be cautious when copying production credentials to experiment apps.

## Workflow Examples

### Example 1: Gradual Rollout

Test a new feature with progressively more traffic:

```bash
# Step 1: Create experiment with 5% traffic
heroku xp:create --app prod-app --name exp-new-ui \
  --tarball https://github.com/myorg/myrepo/tarball/new-ui \
  --weight 5 \
  --ttl 7d

# Deploy
git commit --allow-empty -m "Add experiment exp-new-ui (5%)"
git push heroku main

# Step 2: Monitor for 24 hours
heroku xp:info --app prod-app --name exp-new-ui --period 24h

# Step 3: Increase to 25% if metrics look good
heroku xp:update --app prod-app --name exp-new-ui --weight 25
git commit --allow-empty -m "Increase exp-new-ui to 25%"
git push heroku main

# Step 4: Monitor for another 24 hours
heroku xp:info --app prod-app --name exp-new-ui --period 24h

# Step 5: Increase to 50%
heroku xp:update --app prod-app --name exp-new-ui --weight 50
git commit --allow-empty -m "Increase exp-new-ui to 50%"
git push heroku main

# Step 6: Full rollout - merge to main and destroy experiment
git merge new-ui
git push heroku main
heroku xp:destroy --app prod-app --name exp-new-ui --confirm exp-new-ui
```

### Example 2: Beta User Testing

Route only beta users to experiment:

```bash
# Create experiment with beta user routing
heroku xp:create --app prod-app --name exp-beta-features \
  --copy-parent \
  --body-json '$.user.beta == true' \
  --header x-beta=true

# Deploy
git commit --allow-empty -m "Add beta features experiment"
git push heroku main

# Deploy experiment code
git push heroku beta-features:main --app prod-app-exp-beta-feat-a7f3d

# Beta users access via:
# - API with JSON body: {"user": {"beta": true}}
# - OR with header: X-Beta: true

# Monitor beta user traffic
heroku xp:info --app prod-app --name exp-beta-features
```

### Example 3: API Version Testing

Test new API version on specific path:

```bash
# Create experiment for /api/v2
heroku xp:create --app prod-app --name exp-api-v2 \
  --tarball https://github.com/myorg/myrepo/tarball/api-v2 \
  --path /api/v2 \
  --ttl 48h

# Deploy
git commit --allow-empty -m "Add API v2 experiment"
git push heroku main

# Test API v2
curl https://prod-app.herokuapp.com/api/v2/users

# Monitor
heroku xp:info --app prod-app --name exp-api-v2

# Promote to production
git merge api-v2
git push heroku main
heroku xp:destroy --app prod-app --name exp-api-v2 --confirm exp-api-v2
```

### Example 4: Load Testing with Traffic Mirroring

Test performance without user impact:

```bash
# Create mirrored experiment
heroku xp:create --app prod-app --name exp-load-test \
  --copy-parent \
  --mirror-traffic \
  --ttl 2h

# Deploy
git commit --allow-empty -m "Add load test mirror"
git push heroku main

# Deploy test build to experiment
git push heroku load-test-branch:main --app prod-app-exp-load-tes-a7f3d

# ALL production traffic now mirrored to experiment
# Users always get parent response
# Monitor experiment performance
heroku xp:info --app prod-app --name exp-load-test --period 1h

# Check if experiment can handle load
# - Response time comparison
# - Error rate comparison
# - Throughput metrics

# Clean up
heroku xp:destroy --app prod-app --name exp-load-test --confirm exp-load-test
```

## Troubleshooting

### Experiment Not Receiving Traffic

**Symptoms:**
- `heroku xp:info` shows 0 requests to experiment
- All traffic going to parent app

**Causes & Solutions:**

1. **Traefik config not regenerated**
   ```bash
   # Config changes require redeploy
   git commit --allow-empty -m "Regenerate Traefik config"
   git push heroku main
   ```

2. **Experiment app not running**
   ```bash
   # Check dyno status
   heroku ps --app prod-app-exp-123-a7f3d
   
   # Scale up if needed
   heroku ps:scale web=1 --app prod-app-exp-123-a7f3d
   ```

3. **Experiment status is stopped**
   ```bash
   # Check status
   heroku xp:list --app prod-app
   
   # Start if stopped
   heroku xp:start --app prod-app --name exp-123
   ```

4. **Routing rules not matching**
   ```bash
   # View Traefik config
   heroku run 'cat .heroku/traefik/config/dynamic/*.yml' --app prod-app
   
   # Verify experiment config
   heroku config:get HEROKU_EXPERIMENTS --app prod-app | jq .
   ```

### Traefik Not Starting

**Symptoms:**
- App crashes on startup
- Logs show "Traefik not found"

**Solutions:**

1. **Buildpack not installed**
   ```bash
   # Check buildpacks
   heroku buildpacks --app prod-app
   
   # Add dyno-proxy buildpack
   heroku buildpacks:add https://github.com/heroku/heroku-buildpack-dyno-proxy --app prod-app
   ```

2. **Procfile not using traefik-wrapper**
   ```
   # Procfile should be:
   web: traefik-wrapper npm start
   
   # NOT:
   web: npm start
   ```

3. **Build cache issue**
   ```bash
   # Clear cache and rebuild
   heroku repo:purge_cache --app prod-app
   git commit --allow-empty -m "Rebuild with Traefik"
   git push heroku main
   ```

### Experiment App Returns 502 Bad Gateway

**Symptoms:**
- Requests to experiment return 502 error
- Parent app works fine

**Causes & Solutions:**

1. **Experiment app not deployed**
   ```bash
   # Check releases
   heroku releases --app prod-app-exp-123-a7f3d
   
   # Deploy if needed
   git push heroku experiment-branch:main --app prod-app-exp-123-a7f3d
   ```

2. **Experiment app crashed**
   ```bash
   # Check logs
   heroku logs --tail --app prod-app-exp-123-a7f3d
   
   # Restart
   heroku restart --app prod-app-exp-123-a7f3d
   ```

3. **Port binding issue**
   ```bash
   # Ensure app listens on $PORT
   # In your app code:
   const port = process.env.PORT || 5000;
   app.listen(port);
   ```

4. **Experiment app URL incorrect**
   ```bash
   # Verify app name in config
   heroku config:get HEROKU_EXPERIMENTS --app prod-app | jq '.experiments["exp-123"].appName'
   
   # Test direct access
   curl https://prod-app-exp-123-a7f3d.herokuapp.com
   ```

### High Latency After Adding Experiments

**Symptoms:**
- Parent app response time increased
- Logs show Traefik processing time

**Causes & Solutions:**

1. **JSON body routing enabled**
   - JSONPath adds ~5-10ms latency due to body buffering
   - Consider using headers or query params instead

2. **Too many routing rules**
   - Simplify routing (use weight instead of complex JSONPath)
   - Reduce number of experiments

3. **Experiment app slow response**
   ```bash
   # Check experiment app metrics
   heroku xp:info --app prod-app --name exp-123
   
   # Compare response times
   # If experiment is slower, optimize or stop it
   ```

### Config Var Size Limit Exceeded

**Symptoms:**
- Error: "HEROKU_EXPERIMENTS config var would exceed 32KB limit"

**Solutions:**

1. **Remove expired experiments**
   ```bash
   # List all experiments
   heroku xp:list --app prod-app
   
   # Destroy old ones
   heroku xp:destroy --app prod-app --name old-exp --confirm old-exp
   ```

2. **Use shorter experiment names**
   - Instead of `exp-feature-xyz-redesign-v2`
   - Use `exp-fxyz-v2`

3. **Reduce metadata**
   - Avoid long descriptions
   - Store detailed notes externally (e.g., GUS, Notion)

### Stats API Not Responding

**Symptoms:**
- `heroku xp:info` fails with "Stats API not responding"
- No traffic comparison data

**Causes & Solutions:**

1. **App not running**
   ```bash
   # Scale up if idle
   heroku ps:scale web=1 --app prod-app
   ```

2. **Traefik buildpack not installed or outdated**
   ```bash
   # Reinstall buildpack
   heroku buildpacks:remove https://github.com/heroku/heroku-buildpack-dyno-proxy --app prod-app
   heroku buildpacks:add https://github.com/heroku/heroku-buildpack-dyno-proxy --app prod-app
   git commit --allow-empty -m "Reinstall Traefik buildpack"
   git push heroku main
   ```

3. **Experiment just created**
   - Wait 5-10 minutes after deploy for metrics to populate
   - Stats reset on dyno restart

4. **Dyno sleeping**
   ```bash
   # Wake up dyno
   curl https://prod-app.herokuapp.com
   
   # Wait 30 seconds, then try again
   heroku xp:info --app prod-app --name exp-123
   ```

## Limitations

### Hard Limits

- **Maximum 50 experiments per app** - enforced by plugin
- **32KB config var size** - Heroku platform limit for `HEROKU_EXPERIMENTS`
- **1MB request body limit** - for JSON body routing (Traefik default)
- **Experiment name max 100 chars** - alphanumeric, hyphens, underscores only
- **App name max 30 chars** - Heroku platform limit

### Soft Limits / Best Practices

- **Recommended: 5-10 active experiments** - for performance and manageability
- **Weight total should not exceed 100%** - plugin validates this
- **TTL max 7 days** - plugin enforced maximum
- **Experiment apps must be publicly accessible** - no VPC peering support

### Technical Limitations

- **Traefik config regenerated on deploy only** - not at runtime
  - Changing `HEROKU_EXPERIMENTS` requires redeploy
  - Use `git commit --allow-empty && git push heroku main`

- **Stats not persistent** - reset on dyno restart
  - Stats API uses in-memory storage
  - Historical data not retained

- **External experiment app calls** - adds latency
  - Experiment app requests go over public internet
  - ~50-100ms additional latency vs. local routing

- **No sticky sessions** - weight-based routing is probabilistic
  - Subsequent requests from same user may route differently
  - Use headers/query params for deterministic routing

- **JSON body routing latency** - ~5-10ms overhead
  - Body must be buffered for JSONPath evaluation
  - Only use when necessary

## Security

### Input Validation

All CLI inputs are validated for security:

- **Command injection protection**: Shell metacharacters escaped
- **Path traversal protection**: `..` sequences blocked in paths
- **CRLF injection protection**: `\r\n` blocked in headers
- **JSONPath validation**: Dangerous patterns rejected
- **Prototype pollution protection**: JSON parsing secured

### Traefik Binary Verification

- Traefik binary verified with **SHA256 checksums**
- Downloaded from official Traefik GitHub releases
- Checksum validation happens during buildpack compile phase

### Config Security

- `HEROKU_EXPERIMENTS` parsed with prototype pollution checks
- Maximum config size enforced (32KB)
- JSON structure validated before parsing
- No arbitrary code execution in config generation

### Network Security

- Experiment apps must be **publicly accessible via `.herokuapp.com`**
- No VPC peering supported (routing over public internet)
- HTTPS used for all experiment app requests
- Traefik respects HTTP headers from upstream

### Permissions

- **App ownership**: Only app collaborators can create/manage experiments
- **Heroku API authentication**: Uses `heroku` CLI auth token
- **Confirmation required**: `experiments:destroy` requires explicit `--confirm` flag

### Best Practices

1. **Limit experiment access**: Use Heroku Teams to control who can manage experiments
2. **Review experiment configs**: Audit `HEROKU_EXPERIMENTS` regularly
3. **Rotate credentials**: Don't share production database credentials with experiment apps
4. **Monitor experiment apps**: Set up alerts for unusual behavior
5. **Use TTLs**: Always set `--ttl` to auto-expire experiments
6. **Clean up regularly**: Destroy old experiments to reduce config size
