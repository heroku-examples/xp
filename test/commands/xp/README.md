# xp:watch Command Tests

This directory contains unit tests for the `xp:watch` command.

## Test Structure

### watch.test.ts

Comprehensive test suite covering:

1. **Basic functionality**
   - Command accepts `-a/--app` flag
   - Requires app flag
   - Fetches HEROKU_XP config var correctly
   - Constructs correct metrics URLs

2. **Prometheus parsing**
   - Parses histogram metrics (sum, count)
   - Parses counter metrics (requests_total)
   - Extracts router labels correctly
   - Handles missing metrics gracefully

3. **Calculations**
   - Avg response time calculated correctly (sum/count)
   - Error rate calculated correctly
   - Throughput rate calculated correctly (difference between samples)

4. **Error handling**
   - Handles missing HEROKU_XP config
   - Handles HTTP request failures
   - Handles malformed Prometheus data
   - Handles empty experiment list
   - Handles API authentication errors
   - Handles non-existent app

5. **Table display**
   - Formats metrics for display
   - Handles N/A values for experiments with no traffic
   - Displays multiple experiments in table

6. **Continuous monitoring**
   - Supports interval flag for continuous monitoring

## Running Tests

```bash
# Run all tests
npm test

# Run only xp:watch tests
npm test -- test/commands/xp/watch.test.ts

# Run with verbose output
npm test -- --reporter spec

# Run in watch mode (requires mocha watch plugin)
npm test -- --watch
```

## Test Helpers

The test suite uses helpers from `test/helpers.ts`:

- `createMockExperimentConfig(overrides)` - Creates mock experiment configuration
- `createMockPrometheusMetrics(options)` - Creates mock Prometheus metrics
- `createMockConfigVars(config)` - Creates mock Heroku config vars

## Mocking Strategy

Tests use:
- **@oclif/test** for command testing framework
- **nock** for mocking Heroku API calls
- **sinon** for stubbing fetch requests to metrics endpoints
- **chai** for assertions

## Implementation Requirements

The tests expect the `xp:watch` command to:

1. Fetch HEROKU_XP config from Heroku API
2. For each experiment, construct metrics URL: `{experiment.url}/metrics`
3. Fetch Prometheus metrics from each experiment app
4. Parse Prometheus text format:
   - Extract histogram metrics: `metric_name_sum{labels}` and `metric_name_count{labels}`
   - Extract counter metrics: `metric_name{labels}`
   - Parse labels (route, method, status, etc.)
5. Calculate metrics:
   - Avg response time = sum / count
   - Error rate = error_requests / total_requests
   - Throughput = (current_total - previous_total) / time_diff
6. Display results in a table using cli-ux
7. Handle errors gracefully with informative messages
8. Support continuous monitoring with `--interval` flag

## Expected Prometheus Metrics Format

```prometheus
# HELP http_request_duration_seconds HTTP request latency
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_sum{route="/api/users"} 125.5
http_request_duration_seconds_count{route="/api/users"} 100

# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{route="/api/users",status="200"} 1500
http_requests_total{route="/api/users",status="500"} 100
```

## Notes

- Tests are designed to run before the implementation exists
- Once implementation is complete, run tests to verify behavior
- All tests use TypeScript and follow oclif testing patterns
- Tests mock external dependencies (Heroku API, metrics endpoints)
- No actual network calls are made during testing
