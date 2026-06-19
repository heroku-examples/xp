#!/bin/bash
set -e

# Helper script for running common XP testing scenarios
# Usage: ./test-scenarios.sh [scenario-name]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
  echo -e "\n${BLUE}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  $1${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_info() {
  echo -e "${YELLOW}ℹ $1${NC}"
}

# Scenario 1: Weight-based routing (10%)
scenario_weight() {
  print_header "Scenario 1: Weight-Based Routing (10%)"

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

  print_info "Starting services..."
  docker-compose up -d parent-app experiment-1

  print_info "Waiting for services to be ready..."
  sleep 5

  print_info "Sending 20 requests to observe distribution..."
  echo ""

  for i in {1..20}; do
    APP=$(curl -s http://localhost:8080/ | jq -r '.app.name')
    echo "Request $i: $APP"
  done

  echo ""
  print_success "Expected: ~18 parent-app, ~2 experiment-1"
}

# Scenario 2: Path-based routing
scenario_path() {
  print_header "Scenario 2: Path-Based Routing"

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

  print_info "Starting services..."
  docker-compose up -d parent-app experiment-1

  print_info "Waiting for services to be ready..."
  sleep 5

  echo ""
  print_info "Testing / (should go to parent-app)..."
  APP=$(curl -s http://localhost:8080/ | jq -r '.app.name')
  if [ "$APP" = "parent-app" ]; then
    print_success "/ → parent-app"
  else
    print_error "/ → $APP (expected parent-app)"
  fi

  print_info "Testing /experiment (should go to experiment-1)..."
  APP=$(curl -s http://localhost:8080/experiment | jq -r '.app.name')
  if [ "$APP" = "experiment-1" ]; then
    print_success "/experiment → experiment-1"
  else
    print_error "/experiment → $APP (expected experiment-1)"
  fi

  print_info "Testing /experiment/test (should go to experiment-1)..."
  APP=$(curl -s http://localhost:8080/experiment/test | jq -r '.app.name')
  if [ "$APP" = "experiment-1" ]; then
    print_success "/experiment/test → experiment-1"
  else
    print_error "/experiment/test → $APP (expected experiment-1)"
  fi
}

# Scenario 3: Query parameter routing
scenario_query() {
  print_header "Scenario 3: Query Parameter Routing"

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

  print_info "Starting services..."
  docker-compose up -d parent-app experiment-1

  print_info "Waiting for services to be ready..."
  sleep 5

  echo ""
  print_info "Testing / (should go to parent-app)..."
  APP=$(curl -s http://localhost:8080/ | jq -r '.app.name')
  if [ "$APP" = "parent-app" ]; then
    print_success "/ → parent-app"
  else
    print_error "/ → $APP (expected parent-app)"
  fi

  print_info "Testing /?exp=1 (should go to experiment-1)..."
  APP=$(curl -s "http://localhost:8080/?exp=1" | jq -r '.app.name')
  if [ "$APP" = "experiment-1" ]; then
    print_success "/?exp=1 → experiment-1"
  else
    print_error "/?exp=1 → $APP (expected experiment-1)"
  fi

  print_info "Testing /?exp=2 (should go to parent-app)..."
  APP=$(curl -s "http://localhost:8080/?exp=2" | jq -r '.app.name')
  if [ "$APP" = "parent-app" ]; then
    print_success "/?exp=2 → parent-app"
  else
    print_error "/?exp=2 → $APP (expected parent-app)"
  fi
}

# Scenario 4: Header-based routing
scenario_header() {
  print_header "Scenario 4: Header-Based Routing"

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

  print_info "Starting services..."
  docker-compose up -d parent-app experiment-1

  print_info "Waiting for services to be ready..."
  sleep 5

  echo ""
  print_info "Testing without header (should go to parent-app)..."
  APP=$(curl -s http://localhost:8080/ | jq -r '.app.name')
  if [ "$APP" = "parent-app" ]; then
    print_success "No header → parent-app"
  else
    print_error "No header → $APP (expected parent-app)"
  fi

  print_info "Testing with X-Experiment: exp-1 (should go to experiment-1)..."
  APP=$(curl -s -H "X-Experiment: exp-1" http://localhost:8080/ | jq -r '.app.name')
  if [ "$APP" = "experiment-1" ]; then
    print_success "X-Experiment: exp-1 → experiment-1"
  else
    print_error "X-Experiment: exp-1 → $APP (expected experiment-1)"
  fi
}

# Scenario 5: Multi-experiment
scenario_multi() {
  print_header "Scenario 5: Multi-Experiment Setup"

  export HEROKU_EXPERIMENTS='{
    "version": 1,
    "experiments": {
      "exp-1": {
        "name": "exp-1",
        "appName": "xp-experiment-1",
        "status": "active",
        "routing": {
          "paths": ["/api/v2"]
        }
      },
      "exp-2": {
        "name": "exp-2",
        "appName": "xp-experiment-2",
        "status": "active",
        "routing": {
          "queries": {
            "beta": "true"
          }
        }
      }
    }
  }'

  print_info "Starting services..."
  docker-compose up -d parent-app experiment-1 experiment-2

  print_info "Waiting for services to be ready..."
  sleep 5

  echo ""
  print_info "Testing / (should go to parent-app)..."
  APP=$(curl -s http://localhost:8080/ | jq -r '.app.name')
  if [ "$APP" = "parent-app" ]; then
    print_success "/ → parent-app"
  else
    print_error "/ → $APP (expected parent-app)"
  fi

  print_info "Testing /api/v2 (should go to experiment-1)..."
  APP=$(curl -s http://localhost:8080/api/v2 | jq -r '.app.name')
  if [ "$APP" = "experiment-1" ]; then
    print_success "/api/v2 → experiment-1"
  else
    print_error "/api/v2 → $APP (expected experiment-1)"
  fi

  print_info "Testing /?beta=true (should go to experiment-2)..."
  APP=$(curl -s "http://localhost:8080/?beta=true" | jq -r '.app.name')
  if [ "$APP" = "experiment-2" ]; then
    print_success "/?beta=true → experiment-2"
  else
    print_error "/?beta=true → $APP (expected experiment-2)"
  fi
}

# Clean up
cleanup() {
  print_header "Cleaning Up"

  print_info "Stopping all services..."
  docker-compose down

  print_success "Cleanup complete"
}

# View Traefik config
view_config() {
  print_header "Traefik Configuration"

  if [ ! "$(docker ps -q -f name=xp-parent-app)" ]; then
    print_error "Parent app container is not running"
    print_info "Start services first: docker-compose up -d parent-app"
    exit 1
  fi

  docker exec xp-parent-app cat /app/.heroku/traefik/config/dynamic/experiments.yml
}

# View logs
view_logs() {
  print_header "Service Logs"

  docker-compose logs --tail=50 "$@"
}

# Show help
show_help() {
  cat << EOF
Usage: ./test-scenarios.sh [command]

Commands:
  weight      Test weight-based routing (10%)
  path        Test path-based routing
  query       Test query parameter routing
  header      Test header-based routing
  multi       Test multi-experiment setup
  config      View generated Traefik configuration
  logs        View service logs (pass service name: parent-app, experiment-1, experiment-2)
  cleanup     Stop all services and clean up
  all         Run all test scenarios
  help        Show this help message

Examples:
  ./test-scenarios.sh weight
  ./test-scenarios.sh path
  ./test-scenarios.sh config
  ./test-scenarios.sh logs parent-app
  ./test-scenarios.sh cleanup

EOF
}

# Run all scenarios
run_all() {
  print_header "Running All Test Scenarios"

  scenario_weight
  cleanup
  sleep 2

  scenario_path
  cleanup
  sleep 2

  scenario_query
  cleanup
  sleep 2

  scenario_header
  cleanup
  sleep 2

  scenario_multi
  cleanup

  print_header "All Scenarios Complete"
}

# Main script logic
case "${1:-help}" in
  weight)
    scenario_weight
    ;;
  path)
    scenario_path
    ;;
  query)
    scenario_query
    ;;
  header)
    scenario_header
    ;;
  multi)
    scenario_multi
    ;;
  config)
    view_config
    ;;
  logs)
    shift
    view_logs "$@"
    ;;
  cleanup)
    cleanup
    ;;
  all)
    run_all
    ;;
  help|--help|-h)
    show_help
    ;;
  *)
    print_error "Unknown command: $1"
    echo ""
    show_help
    exit 1
    ;;
esac
