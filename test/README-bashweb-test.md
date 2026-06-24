# bin/bashweb DELAY Test

Docker-based test to verify that `bin/bashweb` handles the `DELAY` variable correctly in a Heroku-like container environment.

## What it tests

- Starts bashweb with `DELAY=5`
- Sends 2 concurrent HTTP requests
- Verifies both requests take ~5 seconds (fork model working)
- Verifies both receive valid HTML responses

## Running the test

```bash
# Build the test image
docker build -f test/Dockerfile.bashweb-test -t bashweb-test .

# Run the test
docker run --rm bashweb-test
```

## Expected output

```
=== Testing bin/bashweb with DELAY=5 ===

Server started (PID: 8)

[23:45:00] Request 1: starting
[23:45:01] Request 2: starting
[23:45:05] Request 1: completed (5s)
[23:45:06] Request 2: completed (5s)

=== Test Results ===
Request 1: 5s (expected: ~5s)
Request 2: 5s (expected: ~5s)

✅ PASS: All tests passed!
  - Both requests received valid HTTP responses
  - Both requests experienced proper DELAY timing
  - Fork model working correctly (concurrent processing)
```

## What this proves

- The Perl fork model allows concurrent request handling
- Each forked process can delay independently
- DELAY timing works correctly in Heroku's container environment
- No serialization issues (both requests run in parallel)
