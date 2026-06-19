# Local Testing for Heroku XP Plugin

Docker-based environment for testing traffic routing locally.

## Quick Start

```bash
# Start all services
docker-compose up

# Test basic routing
curl http://localhost:8080/

# Run automated test scenarios
./test-scenarios.sh all
```

## Files

| File | Description |
|------|-------------|
| `Dockerfile` | Simulates Heroku dyno environment with Traefik |
| `docker-compose.yml` | Orchestrates parent app and experiment containers |
| `test-app/` | Express.js test application |
| `test-scenarios.sh` | Automated testing script for common scenarios |
| `TEST_LOCAL.md` | **Comprehensive testing guide** 📖 |

## Ports

- **8080**: Main entry point (Traefik proxy)
- **8081**: Traefik dashboard
- **9001**: Experiment 1 (direct access)
- **9002**: Experiment 2 (direct access)

## Common Commands

```bash
# Start specific services
docker-compose up parent-app experiment-1

# View logs
docker-compose logs -f parent-app

# View Traefik config
./test-scenarios.sh config

# Run test scenarios
./test-scenarios.sh weight    # Weight-based routing
./test-scenarios.sh path      # Path-based routing
./test-scenarios.sh query     # Query parameter routing
./test-scenarios.sh header    # Header-based routing
./test-scenarios.sh multi     # Multi-experiment setup

# Clean up
docker-compose down
```

## Configuration

Set `HEROKU_EXPERIMENTS` environment variable:

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

docker-compose up parent-app experiment-1
```

## Testing Examples

### Weight-Based Routing

```bash
# Send 20 requests, observe ~10% go to experiment
for i in {1..20}; do
  curl -s http://localhost:8080/ | jq -r '.app.name'
done
```

### Path-Based Routing

```bash
curl http://localhost:8080/experiment | jq '.app.name'
# Output: "experiment-1"
```

### Query Parameter Routing

```bash
curl "http://localhost:8080/?exp=1" | jq '.app.name'
# Output: "experiment-1"
```

### Header-Based Routing

```bash
curl -H "X-Experiment: exp-1" http://localhost:8080/ | jq '.app.name'
# Output: "experiment-1"
```

## Documentation

**📖 Read TEST_LOCAL.md for comprehensive guide** including:
- Architecture overview
- Detailed testing scenarios
- Debugging techniques
- Troubleshooting
- Advanced usage

## Requirements

- Docker 20.10+
- Docker Compose 2.0+
- curl or HTTPie
- jq (for JSON parsing)

## Next Steps

1. Read `TEST_LOCAL.md` for detailed guide
2. Run `./test-scenarios.sh all` to test all scenarios
3. Modify `test-app/server.js` for custom testing
4. Experiment with different routing configurations
