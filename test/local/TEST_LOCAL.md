# Local Testing Guide for Heroku XP Plugin

This guide explains how to test traffic routing locally using Docker to simulate a Heroku dyno environment.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Testing Scenarios](#testing-scenarios)
- [Configuration](#configuration)
- [Debugging](#debugging)
- [Advanced Usage](#advanced-usage)
- [Troubleshooting](#troubleshooting)

## Overview

This Docker-based setup simulates the Heroku XP plugin's production architecture:

- **Parent app**: Runs Traefik proxy on port 8080, routes to experiments
- **Experiment apps**: Separate containers simulating experiment dynos
- **Traefik configuration**: Auto-generated from `HEROKU_EXPERIMENTS` JSON

### What Gets Tested

✅ Weight-based routing  
✅ Path-based routing  
✅ Query parameter routing  
✅ Header-based routing  
✅ Traffic mirroring  
✅ Multi-experiment scenarios  
✅ Traefik configuration generation  

## Prerequisites

- **Docker** 20.10+ and **Docker Compose** 2.0+
- **curl** or **HTTPie** for testing requests
- Basic understanding of the XP plugin architecture

### Installation

```bash
# Install Docker Desktop (macOS/Windows)
# https://www.docker.com/products/docker-desktop

# Or install Docker Engine (Linux)
# https://docs.docker.com/engine/install/

# Verify installation
docker --version
docker-compose --version
```

## Architecture

```
┌─────────────────────────────────────────┐
│  Docker Host                            │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  parent-app (container)           │ │
│  │  Port: 8080 (Traefik)            │ │
│  │  Port: 8081 (Dashboard)          │ │
│  │                                   │ │
│  │  ┌─────────────────────────────┐ │ │
│  │  │  Traefik Proxy              │ │ │
│  │  │  Routes based on:           │ │ │
│  │  │  • HEROKU_EXPERIMENTS       │ │ │
│  │  └──────────┬──────────────────┘ │ │
│  │             │                     │ │
│  │      ┌──────┴──────┐             │ │
│  │      │             │             │ │
│  │   90%│          10%│             │ │
│  │      ▼             ▼             │ │
│  │  ┌────────┐   (proxy to)        │ │
│  │  │App:5000│   container         │ │
│  │  └────────┘                      │ │
│  └───────────────┼───────────────────┘ │
│                  │                     │
│  ┌───────────────▼───────────────────┐ │
│  │  experiment-1 (container)         │ │
│  │  Port: 9001 (direct access)      │ │
│  │  Port: 5000 (internal)           │ │
│  └───────────────────────────────────┘ │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  experiment-2 (container)       │   │
│  │  Port: 9002 (direct access)    │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## Quick Start

### 1. Navigate to Test Directory

```bash
cd /Users/cambrose/Documents/xp/test/local
```

### 2. Start All Services

```bash
docker-compose up --build
```

This starts:
- Parent app with Traefik on `localhost:8080`
- Experiment 1 on `localhost:9001`
- Experiment 2 on `localhost:9002`

### 3. Verify Services

```bash
# Check parent app
curl http://localhost:8080/health

# Check experiment 1 (direct access)
curl http://localhost:9001/health

# Check Traefik dashboard
open http://localhost:8081
```

### 4. Test Basic Routing

```bash
# Request will go to parent app (no routing configured yet)
curl http://localhost:8080/
```

### 5. Stop Services

```bash
# Ctrl+C to stop
# Or in separate terminal:
docker-compose down
```

## Testing Scenarios

### Scenario 1: Weight-Based Routing (10% to Experiment)

Route 10% of traffic to experiment-1, 90% to parent.

#### 1. Set Configuration

```bash
export HEROKU_EXPERIMENTS='{
  "version": 1,
  "experiments": {
    "exp-1": {
      "name": "exp-1",
      "appName": "xp-experiment-1",
      "status": "active",
      "routing": {
        "weight": 10
      }
    }
  }
}'
```

#### 2. Start Services

```bash
docker-compose up parent-app experiment-1
```

#### 3. Test Distribution

```bash
# Send 20 requests and observe distribution
for i in {1..20}; do
  curl -s http://localhost:8080/ | jq -r '.app.name'
done

# Expected output: ~18 "parent-app", ~2 "experiment-1"
```

#### 4. View Traefik Configuration

```bash
docker exec xp-parent-app cat /app/.heroku/traefik/config/dynamic/experiments.yml
```

### Scenario 2: Path-Based Routing

Route `/experiment/*` paths to experiment-1.

#### 1. Set Configuration

```bash
export HEROKU_EXPERIMENTS='{
  "version": 1,
  "experiments": {
    "exp-1": {
      "name": "exp-1",
      "appName": "xp-experiment-1",
      "status": "active",
      "routing": {
        "paths": ["/experiment"]
      }
    }
  }
}'
```

#### 2. Start Services

```bash
docker-compose up parent-app experiment-1
```

#### 3. Test Path Routing

```bash
# Goes to parent app
curl http://localhost:8080/ | jq '.app.name'
# Output: "parent-app"

# Goes to experiment-1
curl http://localhost:8080/experiment | jq '.app.name'
# Output: "experiment-1"

# Also goes to experiment-1 (prefix match)
curl http://localhost:8080/experiment/test | jq '.app.name'
# Output: "experiment-1"
```

### Scenario 3: Query Parameter Routing

Route requests with `?exp=1` to experiment-1.

#### 1. Set Configuration

```bash
export HEROKU_EXPERIMENTS='{
  "version": 1,
  "experiments": {
    "exp-1": {
      "name": "exp-1",
      "appName": "xp-experiment-1",
      "status": "active",
      "routing": {
        "queries": {
          "exp": "1"
        }
      }
    }
  }
}'
```

#### 2. Start Services

```bash
docker-compose up parent-app experiment-1
```

#### 3. Test Query Routing

```bash
# Goes to parent app
curl http://localhost:8080/ | jq '.app.name'
# Output: "parent-app"

# Goes to experiment-1
curl http://localhost:8080/?exp=1 | jq '.app.name'
# Output: "experiment-1"

# Goes to parent (query value doesn't match)
curl http://localhost:8080/?exp=2 | jq '.app.name'
# Output: "parent-app"
```

### Scenario 4: Header-Based Routing

Route requests with `X-Experiment: exp-1` header to experiment-1.

#### 1. Set Configuration

```bash
export HEROKU_EXPERIMENTS='{
  "version": 1,
  "experiments": {
    "exp-1": {
      "name": "exp-1",
      "appName": "xp-experiment-1",
      "status": "active",
      "routing": {
        "headers": {
          "x-experiment": "exp-1"
        }
      }
    }
  }
}'
```

#### 2. Start Services

```bash
docker-compose up parent-app experiment-1
```

#### 3. Test Header Routing

```bash
# Goes to parent app
curl http://localhost:8080/ | jq '.app.name'
# Output: "parent-app"

# Goes to experiment-1
curl -H "X-Experiment: exp-1" http://localhost:8080/ | jq '.app.name'
# Output: "experiment-1"
```

### Scenario 5: Combined Routing (Weight + Path + Query)

Combine multiple routing methods for a single experiment.

#### 1. Set Configuration

```bash
export HEROKU_EXPERIMENTS='{
  "version": 1,
  "experiments": {
    "exp-1": {
      "name": "exp-1",
      "appName": "xp-experiment-1",
      "status": "active",
      "routing": {
        "weight": 10,
        "paths": ["/experiment"],
        "queries": {
          "beta": "true"
        },
        "headers": {
          "x-beta": "true"
        }
      }
    }
  }
}'
```

#### 2. Start Services

```bash
docker-compose up parent-app experiment-1
```

#### 3. Test Combined Routing

```bash
# Header routing (highest priority)
curl -H "X-Beta: true" http://localhost:8080/ | jq '.app.name'
# Output: "experiment-1" (always)

# Query routing
curl http://localhost:8080/?beta=true | jq '.app.name'
# Output: "experiment-1" (always)

# Path routing
curl http://localhost:8080/experiment | jq '.app.name'
# Output: "experiment-1" (always)

# Weight routing (probabilistic)
for i in {1..20}; do
  curl -s http://localhost:8080/ | jq -r '.app.name'
done
# Output: ~18 "parent-app", ~2 "experiment-1"
```

### Scenario 6: Multi-Experiment Setup

Route different traffic to multiple experiments.

#### 1. Set Configuration

```bash
export HEROKU_EXPERIMENTS='{
  "version": 1,
  "experiments": {
    "exp-1": {
      "name": "exp-1",
      "appName": "xp-experiment-1",
      "status": "active",
      "routing": {
        "weight": 10,
        "paths": ["/api/v2"]
      }
    },
    "exp-2": {
      "name": "exp-2",
      "appName": "xp-experiment-2",
      "status": "active",
      "routing": {
        "weight": 5,
        "queries": {
          "beta": "true"
        }
      }
    }
  }
}'
```

#### 2. Start Services

```bash
docker-compose up
```

#### 3. Test Multi-Experiment Routing

```bash
# Path routing to exp-1
curl http://localhost:8080/api/v2/users | jq '.app.name'
# Output: "experiment-1"

# Query routing to exp-2
curl http://localhost:8080/?beta=true | jq '.app.name'
# Output: "experiment-2"

# Weight routing (10% exp-1, 5% exp-2, 85% parent)
for i in {1..100}; do
  curl -s http://localhost:8080/ | jq -r '.app.name'
done | sort | uniq -c
# Output:
#   85 parent-app
#   10 experiment-1
#    5 experiment-2
```

### Scenario 7: Traffic Mirroring

Send requests to BOTH parent and experiment (users get parent response).

#### 1. Set Configuration

```bash
export HEROKU_EXPERIMENTS='{
  "version": 1,
  "experiments": {
    "exp-1": {
      "name": "exp-1",
      "appName": "xp-experiment-1",
      "status": "active",
      "mirror": true,
      "routing": {}
    }
  }
}'
```

#### 2. Start Services with Logs

```bash
docker-compose up parent-app experiment-1 | grep -E "App: (parent|experiment)"
```

#### 3. Test Mirroring

```bash
# Send request
curl http://localhost:8080/

# Observe logs: both parent-app and experiment-1 receive the request
# User receives parent-app response
```

### Scenario 8: Stopped Experiment

Test that stopped experiments don't receive traffic.

#### 1. Set Configuration

```bash
export HEROKU_EXPERIMENTS='{
  "version": 1,
  "experiments": {
    "exp-1": {
      "name": "exp-1",
      "appName": "xp-experiment-1",
      "status": "stopped",
      "routing": {
        "weight": 50
      }
    }
  }
}'
```

#### 2. Start Services

```bash
docker-compose up parent-app experiment-1
```

#### 3. Verify No Routing

```bash
# All requests go to parent (experiment is stopped)
for i in {1..20}; do
  curl -s http://localhost:8080/ | jq -r '.app.name'
done
# Output: 20x "parent-app"
```

## Configuration

### Environment Variables

#### Parent App

```bash
HEROKU_EXPERIMENTS   # JSON config (see examples above)
PORT                 # Traefik listens on this (default: 8080)
NODE_ENV             # production (default)
APP_NAME             # Identifier for logging
APP_VERSION          # Version identifier
```

#### Experiment Apps

```bash
PORT                          # App port (default: 5000)
APP_NAME                      # Identifier for logging
APP_VERSION                   # Version identifier
HEROKU_EXPERIMENT_NAME        # Experiment name
HEROKU_EXPERIMENT_PARENT      # Parent app name
HEROKU_EXPERIMENT_CREATED     # ISO 8601 timestamp
```

### Docker Compose Ports

| Service | Internal Port | Host Port | Description |
|---------|---------------|-----------|-------------|
| parent-app | 8080 | 8080 | Main entry (Traefik) |
| parent-app | 8081 | 8081 | Traefik dashboard |
| parent-app | 5000 | - | App server (internal) |
| experiment-1 | 5000 | 9001 | Direct access |
| experiment-2 | 5000 | 9002 | Direct access |

### Test App Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Root - shows app identity |
| `/health` | GET | Health check |
| `/api/*` | GET | API endpoint for path testing |
| `/experiment*` | ANY | Experiment endpoint for path testing |
| `/echo` | ANY | Echo request details |
| `/users` | POST | User endpoint for JSON body testing |
| `/products` | POST | Product endpoint for JSON body testing |
| `/slow?delay=1000` | GET | Slow endpoint (latency testing) |
| `/error` | GET | Returns 500 error |
| `/load?iterations=100000` | GET | CPU load endpoint |

## Debugging

### View Traefik Configuration

```bash
# View generated config
docker exec xp-parent-app cat /app/.heroku/traefik/config/dynamic/experiments.yml

# Or from host (if volume mounted)
cat test-app/.heroku/traefik/config/dynamic/experiments.yml
```

### View Container Logs

```bash
# All services
docker-compose logs -f

# Parent app only
docker-compose logs -f parent-app

# Experiment 1 only
docker-compose logs -f experiment-1

# Last 100 lines
docker-compose logs --tail=100 parent-app
```

### Access Traefik Dashboard

```bash
# Open dashboard in browser
open http://localhost:8081

# Or via curl
curl http://localhost:8081/api/http/routers
curl http://localhost:8081/api/http/services
```

### Inspect Network

```bash
# List networks
docker network ls

# Inspect xp-network
docker network inspect xp_xp-network

# Test connectivity between containers
docker exec xp-parent-app ping -c 2 xp-experiment-1
```

### Shell Access

```bash
# Access parent app container
docker exec -it xp-parent-app bash

# Access experiment container
docker exec -it xp-experiment-1 bash

# Check environment variables
docker exec xp-parent-app env | grep HEROKU
```

### Test Direct Container Access

```bash
# Bypass Traefik, access parent app directly
curl http://localhost:5000/  # Won't work (not exposed)

# Access via docker exec
docker exec xp-parent-app curl http://localhost:5000/

# Access experiment directly (exposed port)
curl http://localhost:9001/
```

## Advanced Usage

### Custom Test App Code

Modify `test-app/server.js` to add custom endpoints:

```javascript
// Add to server.js
app.get('/custom', (req, res) => {
  res.json({
    message: 'Custom endpoint',
    app: appName,
    // ... your logic
  });
});
```

Restart services:

```bash
docker-compose restart parent-app
```

### Different Experiment Versions

Create different versions by modifying `APP_VERSION`:

```yaml
# In docker-compose.yml
experiment-1:
  environment:
    - APP_VERSION=v2-feature-xyz
```

### Test Performance

```bash
# Benchmark with Apache Bench
ab -n 1000 -c 10 http://localhost:8080/

# Benchmark with wrk
wrk -t4 -c100 -d30s http://localhost:8080/

# Test latency
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:8080/
```

Create `curl-format.txt`:

```
time_namelookup:  %{time_namelookup}s\n
time_connect:     %{time_connect}s\n
time_appconnect:  %{time_appconnect}s\n
time_pretransfer: %{time_pretransfer}s\n
time_redirect:    %{time_redirect}s\n
time_starttransfer: %{time_starttransfer}s\n
time_total:       %{time_total}s\n
```

### Persist Traefik Config

Mount config directory as volume:

```yaml
# Add to parent-app service in docker-compose.yml
volumes:
  - ./traefik-config:/app/.heroku/traefik/config/dynamic
```

### Use Real Heroku URLs

Test with real experiment apps on Heroku:

```bash
export HEROKU_EXPERIMENTS='{
  "version": 1,
  "experiments": {
    "exp-1": {
      "name": "exp-1",
      "appName": "my-real-heroku-app",
      "status": "active",
      "routing": {
        "weight": 10
      }
    }
  }
}'

docker-compose up parent-app
```

Traefik will route to `https://my-real-heroku-app.herokuapp.com`.

## Troubleshooting

### Issue: Traefik Not Starting

**Symptoms:**
- Parent app crashes
- Logs show "traefik: command not found"

**Solutions:**

1. **Rebuild image:**
   ```bash
   docker-compose build --no-cache parent-app
   docker-compose up parent-app
   ```

2. **Verify Traefik binary:**
   ```bash
   docker exec xp-parent-app which traefik
   docker exec xp-parent-app traefik version
   ```

### Issue: Experiment Not Receiving Traffic

**Symptoms:**
- All requests go to parent app
- Experiment logs show no activity

**Solutions:**

1. **Verify HEROKU_EXPERIMENTS is set:**
   ```bash
   docker exec xp-parent-app env | grep HEROKU_EXPERIMENTS
   ```

2. **Check experiment status:**
   ```bash
   echo $HEROKU_EXPERIMENTS | jq '.experiments."exp-1".status'
   # Should output: "active"
   ```

3. **Verify Traefik config:**
   ```bash
   docker exec xp-parent-app cat /app/.heroku/traefik/config/dynamic/experiments.yml
   ```

4. **Check Docker network:**
   ```bash
   docker exec xp-parent-app ping -c 2 xp-experiment-1
   ```

### Issue: 502 Bad Gateway

**Symptoms:**
- Traefik returns 502 when routing to experiment
- Parent app works fine

**Solutions:**

1. **Check experiment is running:**
   ```bash
   docker-compose ps
   curl http://localhost:9001/health
   ```

2. **Check experiment health:**
   ```bash
   docker-compose logs experiment-1
   ```

3. **Verify container name in config:**
   ```bash
   # Should match docker-compose service name or container_name
   echo $HEROKU_EXPERIMENTS | jq '.experiments."exp-1".appName'
   ```

### Issue: Configuration Not Applied

**Symptoms:**
- Changed `HEROKU_EXPERIMENTS` but routing unchanged
- Old config still active

**Solutions:**

1. **Restart parent app:**
   ```bash
   docker-compose restart parent-app
   ```

2. **Or rebuild:**
   ```bash
   docker-compose up --build parent-app
   ```

3. **Verify config regenerated:**
   ```bash
   docker exec xp-parent-app cat /app/.heroku/traefik/config/dynamic/experiments.yml
   ```

### Issue: Port Already in Use

**Symptoms:**
- Error: "bind: address already in use"
- Can't start services

**Solutions:**

1. **Find process using port:**
   ```bash
   lsof -i :8080
   lsof -i :9001
   ```

2. **Kill process:**
   ```bash
   kill -9 <PID>
   ```

3. **Or change ports in docker-compose.yml:**
   ```yaml
   ports:
     - "8090:8080"  # Change host port
   ```

### Issue: JSON Parse Error

**Symptoms:**
- Error: "Error parsing HEROKU_EXPERIMENTS"
- Config generation fails

**Solutions:**

1. **Validate JSON:**
   ```bash
   echo $HEROKU_EXPERIMENTS | jq .
   ```

2. **Use single quotes in shell:**
   ```bash
   export HEROKU_EXPERIMENTS='{"version":1,...}'
   ```

3. **Escape quotes if needed:**
   ```bash
   export HEROKU_EXPERIMENTS="{\"version\":1,...}"
   ```

### Issue: Weight Distribution Incorrect

**Symptoms:**
- Expected 10% to experiment, but getting 50%
- Traffic not evenly distributed

**Causes:**

1. **Small sample size** - Run more requests (100+)
2. **Cached connections** - Use different clients
3. **Traefik weighted algorithm** - May not be exactly probabilistic

**Test distribution:**

```bash
# Test 100 requests
for i in {1..100}; do
  curl -s http://localhost:8080/ | jq -r '.app.name'
done | sort | uniq -c

# Expected: ~90 parent-app, ~10 experiment-1
```

## Additional Resources

- **Traefik Documentation**: https://doc.traefik.io/traefik/
- **Docker Compose Reference**: https://docs.docker.com/compose/
- **Heroku XP Plugin README**: `/Users/cambrose/Documents/xp/EXPERIMENTS_README.md`
- **Integration Tests**: `/Users/cambrose/Documents/xp/test/integration.sh`

## Next Steps

1. **Run all scenarios** - Work through each testing scenario
2. **Modify test app** - Add custom endpoints for your use case
3. **Test edge cases** - Multiple experiments, high weights, complex routing
4. **Performance testing** - Benchmark latency and throughput
5. **Integration testing** - Test with real Heroku experiment apps

## Questions?

For issues or questions about the XP plugin:
- Open an issue: https://github.com/heroku/experiments/issues
- Review plugin docs: See `EXPERIMENTS_README.md`
