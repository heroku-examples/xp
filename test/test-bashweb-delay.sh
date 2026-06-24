#!/bin/bash
set -e

echo "=== Testing bin/bashweb with DELAY=5 ==="
echo ""

# Start server in background
DELAY=5 PORT=8080 /app/bashweb &
SERVER_PID=$!

# Give server time to start
sleep 2

echo "Server started (PID: $SERVER_PID)"
echo ""

# Record start time
START=$(date +%s)

# Start request 1 in background
echo "[$(date +%H:%M:%S)] Request 1: starting"
R1_START=$(date +%s)
curl -s http://localhost:8080/ > /tmp/r1.html &
R1_PID=$!

# Wait 1 second, then start request 2
sleep 1
echo "[$(date +%H:%M:%S)] Request 2: starting"
R2_START=$(date +%s)
curl -s http://localhost:8080/ > /tmp/r2.html &
R2_PID=$!

# Wait for both to complete
wait $R1_PID
R1_END=$(date +%s)
R1_DURATION=$((R1_END - R1_START))
echo "[$(date +%H:%M:%S)] Request 1: completed (${R1_DURATION}s)"

wait $R2_PID
R2_END=$(date +%s)
R2_DURATION=$((R2_END - R2_START))
echo "[$(date +%H:%M:%S)] Request 2: completed (${R2_DURATION}s)"

# Kill server
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo ""
echo "=== Test Results ==="
echo "Request 1: ${R1_DURATION}s (expected: ~5s)"
echo "Request 2: ${R2_DURATION}s (expected: ~5s)"

# Verify both received HTML responses
if ! grep -q "<!DOCTYPE html>" /tmp/r1.html; then
    echo "❌ FAIL: Request 1 did not receive valid HTML response"
    exit 1
fi

if ! grep -q "<!DOCTYPE html>" /tmp/r2.html; then
    echo "❌ FAIL: Request 2 did not receive valid HTML response"
    exit 1
fi

# Verify timing: each request should take ~5 seconds (allow 4-7 range)
if [ "$R1_DURATION" -lt 4 ] || [ "$R1_DURATION" -gt 7 ]; then
    echo "❌ FAIL: Request 1 duration ${R1_DURATION}s outside expected range (4-7s)"
    exit 1
fi

if [ "$R2_DURATION" -lt 4 ] || [ "$R2_DURATION" -gt 7 ]; then
    echo "❌ FAIL: Request 2 duration ${R2_DURATION}s outside expected range (4-7s)"
    exit 1
fi

echo ""
echo "✅ PASS: All tests passed!"
echo "  - Both requests received valid HTTP responses"
echo "  - Both requests experienced proper DELAY timing"
echo "  - Fork model working correctly (concurrent processing)"
