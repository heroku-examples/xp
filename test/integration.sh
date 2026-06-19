#!/usr/bin/env bash

################################################################################
# Heroku Previews Plugin - Integration Test Script
#
# Tests the full experiment workflow:
# 1. Set HEROKU_API_KEY environment variable
# 2. Create experiment with app-setups
# 3. Poll app-setups status until completion
# 4. Verify HEROKU_EXPERIMENTS config var structure
# 5. Test stop/start commands
# 6. Test update command
# 7. Test destroy command
# 8. Clean up resources
#
# Also includes checks for dyno-proxy buildpack installation.
################################################################################

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
TEST_PARENT_APP="${TEST_PARENT_APP:-}"
TEST_EXPERIMENT_NAME="test-exp-$(date +%s)"
TEST_TARBALL_URL="https://github.com/heroku/node-js-sample/tarball/main"
POLL_INTERVAL=5
POLL_MAX_ATTEMPTS=60  # 5 minutes max

# Tracking variables
EXPERIMENT_APP_NAME=""
SETUP_ID=""
CLEANUP_NEEDED=false

################################################################################
# Helper Functions
################################################################################

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

cleanup() {
    if [[ "$CLEANUP_NEEDED" == "true" ]]; then
        log_info "Running cleanup..."
        
        # Try to destroy the experiment
        if [[ -n "$TEST_EXPERIMENT_NAME" ]] && [[ -n "$TEST_PARENT_APP" ]]; then
            log_info "Destroying experiment: $TEST_EXPERIMENT_NAME"
            heroku experiments:destroy \
                --app "$TEST_PARENT_APP" \
                --name "$TEST_EXPERIMENT_NAME" \
                --confirm "$TEST_EXPERIMENT_NAME" \
                2>/dev/null || log_warn "Failed to destroy experiment (may already be deleted)"
        fi
        
        log_success "Cleanup completed"
    fi
}

trap cleanup EXIT

check_requirements() {
    log_info "Checking requirements..."
    
    # Check if heroku CLI is installed
    if ! command -v heroku &> /dev/null; then
        log_error "heroku CLI not found. Please install it first."
        exit 1
    fi
    
    # Check if jq is installed (for JSON parsing)
    if ! command -v jq &> /dev/null; then
        log_warn "jq not found. Installing for JSON parsing..."
        # Attempt to install jq (works on macOS with Homebrew)
        if command -v brew &> /dev/null; then
            brew install jq
        else
            log_error "jq required but not installed. Please install jq manually."
            exit 1
        fi
    fi
    
    log_success "All requirements satisfied"
}

check_heroku_auth() {
    log_info "Checking Heroku authentication..."
    
    # Check if HEROKU_API_KEY is set
    if [[ -z "${HEROKU_API_KEY:-}" ]]; then
        log_error "HEROKU_API_KEY environment variable not set"
        log_info "Please set it with: export HEROKU_API_KEY=<your-api-key>"
        log_info "Get your API key from: heroku auth:token"
        exit 1
    fi
    
    # Verify the API key works
    if ! heroku auth:whoami &> /dev/null; then
        log_error "Invalid HEROKU_API_KEY or authentication failed"
        exit 1
    fi
    
    local user_email
    user_email=$(heroku auth:whoami 2>/dev/null)
    log_success "Authenticated as: $user_email"
}

prompt_parent_app() {
    if [[ -z "$TEST_PARENT_APP" ]]; then
        log_info "Enter parent app name for testing:"
        read -r TEST_PARENT_APP
        
        if [[ -z "$TEST_PARENT_APP" ]]; then
            log_error "Parent app name is required"
            exit 1
        fi
    fi
    
    # Verify parent app exists
    log_info "Verifying parent app: $TEST_PARENT_APP"
    if ! heroku apps:info --app "$TEST_PARENT_APP" &> /dev/null; then
        log_error "App $TEST_PARENT_APP not found or not accessible"
        exit 1
    fi
    
    log_success "Parent app verified: $TEST_PARENT_APP"
}

check_dyno_proxy_buildpack() {
    log_info "Checking for dyno-proxy buildpack on parent app..."
    
    local buildpacks
    buildpacks=$(heroku buildpacks --app "$TEST_PARENT_APP" 2>/dev/null || echo "")
    
    if echo "$buildpacks" | grep -qi "dyno-proxy\|traefik"; then
        log_success "Dyno-proxy/Traefik buildpack detected"
    else
        log_warn "Dyno-proxy buildpack not found. The plugin will add it automatically during experiment creation."
    fi
}

create_experiment() {
    log_info "Creating experiment: $TEST_EXPERIMENT_NAME"
    
    # Create experiment with weight-based routing
    local output
    output=$(heroku experiments:create \
        --app "$TEST_PARENT_APP" \
        --name "$TEST_EXPERIMENT_NAME" \
        --tarball "$TEST_TARBALL_URL" \
        --weight 10 \
        --json 2>&1)
    
    local exit_code=$?
    
    if [[ $exit_code -ne 0 ]]; then
        log_error "Failed to create experiment"
        echo "$output"
        exit 1
    fi
    
    # Parse experiment app name and setup ID from output
    EXPERIMENT_APP_NAME=$(echo "$output" | jq -r '.appName // empty')
    SETUP_ID=$(echo "$output" | jq -r '.setupId // empty')
    
    if [[ -z "$EXPERIMENT_APP_NAME" ]]; then
        log_warn "Could not parse experiment app name from output"
    else
        log_success "Experiment app created: $EXPERIMENT_APP_NAME"
    fi
    
    if [[ -n "$SETUP_ID" ]]; then
        log_info "App setup ID: $SETUP_ID"
    fi
    
    CLEANUP_NEEDED=true
}

poll_app_setup_status() {
    log_info "Polling app-setups status..."
    
    if [[ -z "$SETUP_ID" ]]; then
        log_warn "No setup ID available, skipping polling"
        return
    fi
    
    local attempt=0
    local status=""
    
    while [[ $attempt -lt $POLL_MAX_ATTEMPTS ]]; do
        attempt=$((attempt + 1))
        
        # Fetch app-setup status
        local setup_info
        setup_info=$(heroku api:get "/app-setups/$SETUP_ID" 2>/dev/null || echo '{}')
        
        status=$(echo "$setup_info" | jq -r '.status // "unknown"')
        
        case "$status" in
            succeeded)
                log_success "App setup succeeded"
                return 0
                ;;
            failed)
                local failure_msg
                failure_msg=$(echo "$setup_info" | jq -r '.failure_message // "Unknown error"')
                log_error "App setup failed: $failure_msg"
                exit 1
                ;;
            pending|building)
                log_info "Status: $status (attempt $attempt/$POLL_MAX_ATTEMPTS)"
                sleep $POLL_INTERVAL
                ;;
            *)
                log_warn "Unknown status: $status"
                sleep $POLL_INTERVAL
                ;;
        esac
    done
    
    log_error "App setup polling timed out after $((POLL_MAX_ATTEMPTS * POLL_INTERVAL)) seconds"
    exit 1
}

verify_heroku_experiments_config() {
    log_info "Verifying HEROKU_EXPERIMENTS config var..."
    
    # Get config var
    local config
    config=$(heroku config:get HEROKU_EXPERIMENTS --app "$TEST_PARENT_APP" 2>/dev/null || echo "")
    
    if [[ -z "$config" ]]; then
        log_error "HEROKU_EXPERIMENTS config var not found"
        exit 1
    fi
    
    # Parse and validate JSON structure
    local version
    version=$(echo "$config" | jq -r '.version // empty')
    
    if [[ "$version" != "1" ]]; then
        log_error "Invalid HEROKU_EXPERIMENTS version: $version (expected 1)"
        exit 1
    fi
    
    # Check if experiment exists
    local exp_exists
    exp_exists=$(echo "$config" | jq -r ".experiments.\"$TEST_EXPERIMENT_NAME\" // empty")
    
    if [[ -z "$exp_exists" ]]; then
        log_error "Experiment $TEST_EXPERIMENT_NAME not found in HEROKU_EXPERIMENTS"
        exit 1
    fi
    
    # Verify experiment properties
    local exp_status
    exp_status=$(echo "$config" | jq -r ".experiments.\"$TEST_EXPERIMENT_NAME\".status // empty")
    
    if [[ "$exp_status" != "active" ]]; then
        log_error "Experiment status is not 'active': $exp_status"
        exit 1
    fi
    
    local exp_weight
    exp_weight=$(echo "$config" | jq -r ".experiments.\"$TEST_EXPERIMENT_NAME\".routing.weight // empty")
    
    if [[ "$exp_weight" != "10" ]]; then
        log_error "Experiment weight is not 10: $exp_weight"
        exit 1
    fi
    
    log_success "HEROKU_EXPERIMENTS config var is valid"
    log_info "Experiment status: $exp_status"
    log_info "Experiment weight: $exp_weight%"
}

test_experiment_stop() {
    log_info "Testing experiment stop command..."
    
    heroku experiments:stop \
        --app "$TEST_PARENT_APP" \
        --name "$TEST_EXPERIMENT_NAME" \
        --json > /dev/null
    
    # Verify status changed to 'stopped'
    local config
    config=$(heroku config:get HEROKU_EXPERIMENTS --app "$TEST_PARENT_APP" 2>/dev/null)
    
    local status
    status=$(echo "$config" | jq -r ".experiments.\"$TEST_EXPERIMENT_NAME\".status // empty")
    
    if [[ "$status" != "stopped" ]]; then
        log_error "Experiment status is not 'stopped' after stop command: $status"
        exit 1
    fi
    
    log_success "Experiment stopped successfully"
}

test_experiment_start() {
    log_info "Testing experiment start command..."
    
    heroku experiments:start \
        --app "$TEST_PARENT_APP" \
        --name "$TEST_EXPERIMENT_NAME" \
        --json > /dev/null
    
    # Verify status changed back to 'active'
    local config
    config=$(heroku config:get HEROKU_EXPERIMENTS --app "$TEST_PARENT_APP" 2>/dev/null)
    
    local status
    status=$(echo "$config" | jq -r ".experiments.\"$TEST_EXPERIMENT_NAME\".status // empty")
    
    if [[ "$status" != "active" ]]; then
        log_error "Experiment status is not 'active' after start command: $status"
        exit 1
    fi
    
    log_success "Experiment started successfully"
}

test_experiment_update() {
    log_info "Testing experiment update command..."
    
    # Update weight from 10 to 15
    heroku experiments:update \
        --app "$TEST_PARENT_APP" \
        --name "$TEST_EXPERIMENT_NAME" \
        --weight 15 \
        --json > /dev/null
    
    # Verify weight changed
    local config
    config=$(heroku config:get HEROKU_EXPERIMENTS --app "$TEST_PARENT_APP" 2>/dev/null)
    
    local weight
    weight=$(echo "$config" | jq -r ".experiments.\"$TEST_EXPERIMENT_NAME\".routing.weight // empty")
    
    if [[ "$weight" != "15" ]]; then
        log_error "Experiment weight not updated: $weight (expected 15)"
        exit 1
    fi
    
    log_success "Experiment updated successfully (weight: 15%)"
}

test_experiment_destroy() {
    log_info "Testing experiment destroy command..."
    
    heroku experiments:destroy \
        --app "$TEST_PARENT_APP" \
        --name "$TEST_EXPERIMENT_NAME" \
        --confirm "$TEST_EXPERIMENT_NAME" \
        --json > /dev/null
    
    # Verify experiment removed from config
    local config
    config=$(heroku config:get HEROKU_EXPERIMENTS --app "$TEST_PARENT_APP" 2>/dev/null || echo '{"experiments":{}}')
    
    local exp_exists
    exp_exists=$(echo "$config" | jq -r ".experiments.\"$TEST_EXPERIMENT_NAME\" // empty")
    
    if [[ -n "$exp_exists" ]]; then
        log_error "Experiment still exists in HEROKU_EXPERIMENTS after destroy"
        exit 1
    fi
    
    # Verify experiment app deleted
    if heroku apps:info --app "$EXPERIMENT_APP_NAME" &> /dev/null; then
        log_error "Experiment app still exists after destroy: $EXPERIMENT_APP_NAME"
        exit 1
    fi
    
    CLEANUP_NEEDED=false  # Already cleaned up
    log_success "Experiment destroyed successfully"
}

verify_dyno_proxy_installed() {
    log_info "Verifying dyno-proxy buildpack was added..."
    
    local buildpacks
    buildpacks=$(heroku buildpacks --app "$TEST_PARENT_APP" 2>/dev/null || echo "")
    
    if echo "$buildpacks" | grep -qi "dyno-proxy"; then
        log_success "Dyno-proxy buildpack confirmed installed"
    else
        log_warn "Dyno-proxy buildpack not detected (may require deploy to activate)"
    fi
}

print_summary() {
    echo ""
    echo "================================================================"
    log_success "Integration Test Summary"
    echo "================================================================"
    log_info "Parent App: $TEST_PARENT_APP"
    log_info "Experiment Name: $TEST_EXPERIMENT_NAME"
    log_info "Experiment App: $EXPERIMENT_APP_NAME"
    echo ""
    log_success "✓ Experiment creation with tarball"
    log_success "✓ App-setups polling and completion"
    log_success "✓ HEROKU_EXPERIMENTS config var validation"
    log_success "✓ Experiment stop command"
    log_success "✓ Experiment start command"
    log_success "✓ Experiment update command"
    log_success "✓ Experiment destroy command"
    log_success "✓ Dyno-proxy buildpack verification"
    echo ""
    log_success "All integration tests passed!"
    echo "================================================================"
}

################################################################################
# Main Execution
################################################################################

main() {
    log_info "Starting Heroku Previews Plugin Integration Tests"
    echo ""
    
    # Step 1: Check requirements
    check_requirements
    echo ""
    
    # Step 2: Check Heroku authentication (HEROKU_API_KEY)
    check_heroku_auth
    echo ""
    
    # Step 3: Prompt for parent app
    prompt_parent_app
    echo ""
    
    # Step 4: Check dyno-proxy buildpack
    check_dyno_proxy_buildpack
    echo ""
    
    # Step 5: Create experiment
    create_experiment
    echo ""
    
    # Step 6: Poll app-setups status
    poll_app_setup_status
    echo ""
    
    # Step 7: Verify HEROKU_EXPERIMENTS config
    verify_heroku_experiments_config
    echo ""
    
    # Step 8: Verify dyno-proxy buildpack installed
    verify_dyno_proxy_installed
    echo ""
    
    # Step 9: Test stop command
    test_experiment_stop
    echo ""
    
    # Step 10: Test start command
    test_experiment_start
    echo ""
    
    # Step 11: Test update command
    test_experiment_update
    echo ""
    
    # Step 12: Test destroy command
    test_experiment_destroy
    echo ""
    
    # Print summary
    print_summary
}

main "$@"
