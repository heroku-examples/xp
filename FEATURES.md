# Feature Guide: Advanced Routing & Monitoring

## JSONPath Body Routing

Route requests based on JSON request body content.

### How It Works

1. Request arrives with JSON body
2. Traefik buffers the request body
3. JSONPath expression evaluated against body
4. If match, routes to preview app
5. Otherwise, routes based on other rules or weight

### Use Cases

#### Beta User Routing

```bash
heroku xp:create \
  --app myapp \
  --branch beta-ui \
  --body-json '$.user.beta == true' \
  --mirror

# Requests with JSON body:
# { "user": { "beta": true } } → Preview
# { "user": { "beta": false } } → Production
```

#### Feature Flag Routing

```bash
heroku xp:create \
  --app myapp \
  --branch new-checkout \
  --body-json '$.features[?(@.name == "new-checkout")].enabled == true' \
  --mirror

# Requests with:
# { "features": [{"name": "new-checkout", "enabled": true}] } → Preview
```

#### Tenant-based Routing

```bash
heroku xp:create \
  --app myapp \
  --branch enterprise-features \
  --body-json '$.tenant.tier == "enterprise"' \
  --mirror

# Enterprise tenants get preview, others get production
```

#### Product-specific Routing

```bash
heroku xp:create \
  --app myapp \
  --branch product-redesign \
  --body-json '$.product.category == "electronics"' \
  --mirror

# Only electronics category sees new design
```

### JSONPath Syntax

Supported expressions:

```jsonpath
# Simple property access
$.user.type

# Nested property
$.metadata.settings.theme

# Array access
$.items[0].id

# Array filtering
$.products[?(@.price > 100)]

# Multiple conditions
$.user[?(@.age > 18 && @.verified == true)]

# Comparison operators
== != > < >= <=

# Logical operators
&& ||
```

### Limitations

- Request body must be valid JSON
- Body size limited to 1MB (Traefik default)
- Adds ~5-10ms latency (body buffering)
- Complex expressions may increase latency
- No support for XML or other formats (JSON only)

### Security Considerations

- JSONPath expressions validated before deployment
- Maximum expression length: 500 characters
- Dangerous characters rejected: `; & | \` $ ( ) { }`
- No code execution - pure data matching only

---

## Traffic Mirroring

Send requests to BOTH parent and preview apps simultaneously.

### How It Works

```
                    ┌─────────────────────┐
                    │   Incoming Request  │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │      Traefik        │
                    └──────────┬──────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
                ▼                             ▼
    ┌──────────────────────┐      ┌─────────────────────┐
    │   Parent App         │      │   Preview App       │
    │   (returns response) │      │   (response ignored)│
    └──────────┬───────────┘      └─────────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │   User receives      │
    │   parent response    │
    └──────────────────────┘
```

### Use Cases

#### Load Testing

```bash
# Test preview app with 100% production traffic
heroku xp:create \
  --app myapp \
  --branch performance-optimizations \
  --mirror-traffic \
  --mirror

# Monitor stats
heroku xp:info --app myapp --branch performance-optimizations

# Check if preview handles load:
# - Compare throughput (should be equal)
# - Compare response times (preview should be faster/equal)
# - Check error rates (preview should have 0% errors)
```

#### Pre-deployment Validation

```bash
# Mirror traffic before switching
heroku xp:create \
  --app myapp \
  --branch release-candidate \
  --mirror-traffic \
  --mirror

# Wait 1 hour, then check stats
sleep 3600
heroku xp:info --app myapp --branch release-candidate --period 1h

# If error rate is 0%, promote:
heroku xp:update --app myapp --branch release-candidate --weight 100
```

#### A/B Test Preparation

```bash
# Mirror traffic to verify stability
heroku xp:create \
  --app myapp \
  --branch variant-b \
  --mirror-traffic \
  --mirror

# After validation, switch to weight-based split
heroku xp:update --app myapp --branch variant-b --weight 50
heroku xp:update --app myapp --branch variant-b --no-mirror-traffic
```

#### Error Rate Comparison

```bash
# Test bug fix with production traffic
heroku xp:create \
  --app myapp \
  --branch bug-fix-123 \
  --mirror-traffic \
  --mirror

# Check if preview has lower error rate
heroku xp:info --app myapp --branch bug-fix-123 | grep "Error Rate"

# If preview errors < parent errors, promote fix
```

### Benefits

- **Zero user impact**: Users always get parent app response
- **Real traffic testing**: No need for synthetic load tests
- **Risk-free validation**: Preview errors don't affect users
- **Cost-effective**: No dedicated load testing infrastructure needed

### Limitations

- **2x server load**: Both apps process every request
- **Preview dyno costs**: Preview app runs at 100% capacity
- **No response comparison**: Only logs captured, not response bodies
- **Write operations**: Careful with database writes (2x writes!)

### Best Practices

1. **Read-only workloads**: Ideal for read-heavy apps
2. **Short duration**: Use for validation (hours), not production (days)
3. **Monitor costs**: Preview dynos consume resources
4. **Database writes**: Use read replicas or mock writes in preview
5. **External APIs**: Consider rate limits (2x API calls)

### Combining with Other Routing

```bash
# Mirror traffic AND route specific users
heroku xp:create \
  --app myapp \
  --branch new-feature \
  --mirror-traffic \
  --header x-internal-testing=true \
  --mirror

# Result:
# - ALL traffic mirrored to preview
# - Users with x-internal-testing header → see preview response
# - All other users → see parent response
```

---

## Traffic Statistics & Monitoring

Real-time comparison of parent vs preview app performance.

### Command: `heroku xp:info`

```bash
heroku xp:info --app myapp --branch my-feature [--period 1h] [--json]
```

### Output Example

```
═══════════════════════════════════════════════════════════
  Preview Environment: my-feature
  Period: 1h
═══════════════════════════════════════════════════════════

Configuration:
  App: myapp-preview-my-feature-a3f2c1
  Created: 6/18/2026, 10:00:00 AM
  Weight: 10%
  Paths: ["/preview/my-feature"]
  Traffic Mirroring: Disabled

───────────────────────────────────────────────────────────
Traffic Comparison:
───────────────────────────────────────────────────────────
Metric              Parent App    Preview App   Difference
Total Requests      45,231        4,892         
Throughput (req/min) 753.85       81.53        -672.32 (expected)
Avg Response Time   142ms         98ms          -44ms (better)
Error Rate          2.1%          0.8%          -1.3% (better)

Traffic Split: 90.2% Parent / 9.8% Preview

───────────────────────────────────────────────────────────
Response Time Comparison:
───────────────────────────────────────────────────────────

Parent   ████████████████████████████████░░░░░░░░ 142ms
Preview  ████████████████████████░░░░░░░░░░░░░░░░ 98ms

✓ Preview is 31.0% faster

───────────────────────────────────────────────────────────
Status Code Breakdown:
───────────────────────────────────────────────────────────
Status  Type          Parent Count  Parent %  Preview Count  Preview %
200     Success       43,128        95.3%     4,839          98.9%
301     Redirect      1,203         2.7%      13             0.3%
404     Client Error  678           1.5%      28             0.6%
500     Server Error  222           0.5%      12             0.2%

───────────────────────────────────────────────────────────
Summary:
  ✓ Preview performance: BETTER than parent
  ✓ Preview stability: BETTER than parent
  ℹ Preview receiving 10.8% of parent's throughput
───────────────────────────────────────────────────────────
```

### Time Periods

```bash
# Last hour (default)
heroku xp:info --app myapp --branch my-feature

# Last 6 hours
heroku xp:info --app myapp --branch my-feature --period 6h

# Last 24 hours
heroku xp:info --app myapp --branch my-feature --period 24h

# Last 7 days
heroku xp:info --app myapp --branch my-feature --period 7d
```

### JSON Output

```bash
heroku xp:info --app myapp --branch my-feature --json

{
  "preview": { ... },
  "stats": {
    "branch": "my-feature",
    "parent": {
      "totalRequests": 45231,
      "avgResponseTime": 142.3,
      "throughput": 753.85,
      "statusCodes": {
        "200": 43128,
        "301": 1203,
        "404": 678,
        "500": 222
      }
    },
    "preview": {
      "totalRequests": 4892,
      "avgResponseTime": 98.1,
      "throughput": 81.53,
      "statusCodes": {
        "200": 4839,
        "301": 13,
        "404": 28,
        "500": 12
      }
    },
    "comparison": {
      "throughputDiff": -672.32,
      "responseTimeDiff": -44.2,
      "errorRateDiff": -1.3
    },
    "period": "1h"
  }
}
```

### Monitoring & Alerting

#### Check for regressions

```bash
# Fail if preview is slower
DIFF=$(heroku xp:info --app myapp --branch my-feature --json | \
  jq -r '.stats.comparison.responseTimeDiff')

if (( $(echo "$DIFF > 50" | bc -l) )); then
  echo "Preview is too slow!"
  exit 1
fi
```

#### Check for errors

```bash
# Fail if preview error rate is higher
DIFF=$(heroku xp:info --app myapp --branch my-feature --json | \
  jq -r '.stats.comparison.errorRateDiff')

if (( $(echo "$DIFF > 0" | bc -l) )); then
  echo "Preview has more errors!"
  exit 1
fi
```

#### Continuous monitoring

```bash
# Monitor every 5 minutes
while true; do
  heroku xp:info --app myapp --branch my-feature --period 5m
  sleep 300
done
```

### Internal API

Direct API access (for custom dashboards):

```bash
# GET /.heroku-previews/api/stats?branch=<name>&period=<duration>
curl "https://myapp.herokuapp.com/.heroku-previews/api/stats?branch=my-feature&period=1h"

# Health check
curl "https://myapp.herokuapp.com/.heroku-previews/api/health"
```

### Data Sources

Stats are aggregated from:
- Traefik JSON access logs (`.heroku/traefik/logs/access.log`)
- Log entries include: timestamp, router, service, status code, duration, path
- Logs rotated every 24 hours (or 100MB, whichever first)
- Stats refresh every 30 seconds

### Limitations

- Stats reset on dyno restart (not persistent)
- Maximum 7 days of history (log retention)
- In-memory aggregation (limited by dyno RAM)
- No drill-down by endpoint (only aggregate stats)
- No percentiles (only averages)

### Roadmap

Future enhancements:
- Persistent storage (PostgreSQL addon)
- Percentile metrics (p50, p95, p99)
- Per-endpoint breakdown
- Real-time streaming stats
- Alerting integration (PagerDuty, Slack)
