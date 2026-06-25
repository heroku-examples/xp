#!/bin/bash
set -e

echo "=== Testing bin/web script ==="
echo ""

# Path to the script
BIN_WEB="/Users/cambrose/Documents/todo/worktrees/2026-06-25-xp-create-bin-web-self-contained-server/bin/web"

# Test 1: Basic connectivity (no delay)
echo "Test 1: Server accepts connections immediately (DELAY=0)"
echo "------------------------------------------------------"

PORT=8081 COLOR=green DELAY=0 "$BIN_WEB" &
SERVER_PID=$!

# Give server time to start
sleep 1

echo "Server started (PID: $SERVER_PID) on port 8081"

# Make a quick request
START=$(date +%s)
curl -s http://localhost:8081/ > /tmp/test-web-1.html
END=$(date +%s)
DURATION=$((END - START))

echo "Request completed in ${DURATION}s"

# Verify HTML response
if ! grep -q "<!DOCTYPE html>" /tmp/test-web-1.html; then
    echo "❌ FAIL: Did not receive valid HTML response"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

# Verify COLOR is in the response
if ! grep -q "green" /tmp/test-web-1.html; then
    echo "❌ FAIL: COLOR not found in response"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

echo "✅ PASS: Server accepts connections immediately"
echo "✅ PASS: COLOR (green) renders correctly in HTML"
echo ""

# Kill server for next test
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
sleep 1

# Test 2: DELAY functionality
echo "Test 2: DELAY affects response time correctly"
echo "----------------------------------------------"

PORT=8082 COLOR=red DELAY=3 "$BIN_WEB" &
SERVER_PID=$!

# Give server time to start
sleep 1

echo "Server started (PID: $SERVER_PID) on port 8082 with DELAY=3"

# Make request and measure time
START=$(date +%s)
curl -s http://localhost:8082/ > /tmp/test-web-2.html
END=$(date +%s)
DURATION=$((END - START))

echo "Request completed in ${DURATION}s (expected: ~3s)"

# Verify timing: should take ~3 seconds (allow 2-4 range)
if [ "$DURATION" -lt 2 ] || [ "$DURATION" -gt 5 ]; then
    echo "❌ FAIL: Duration ${DURATION}s outside expected range (2-5s)"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

# Verify HTML response
if ! grep -q "<!DOCTYPE html>" /tmp/test-web-2.html; then
    echo "❌ FAIL: Did not receive valid HTML response"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

# Verify COLOR changed
if ! grep -q "red" /tmp/test-web-2.html; then
    echo "❌ FAIL: COLOR (red) not found in response"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

echo "✅ PASS: DELAY works correctly (${DURATION}s delay observed)"
echo "✅ PASS: COLOR (red) renders correctly in HTML"
echo ""

# Kill server for next test
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
sleep 1

# Test 3: Sequential requests (netcat handles one at a time)
echo "Test 3: Multiple sequential requests work correctly"
echo "---------------------------------------------------"

PORT=8083 COLOR=blue DELAY=1 "$BIN_WEB" &
SERVER_PID=$!

# Give server time to start
sleep 1

echo "Server started (PID: $SERVER_PID) on port 8083"

# Make first request
echo "Making request 1..."
START1=$(date +%s)
curl -s http://localhost:8083/ > /tmp/test-web-3a.html
END1=$(date +%s)
DURATION1=$((END1 - START1))
echo "Request 1 completed in ${DURATION1}s"

# Make second request
echo "Making request 2..."
START2=$(date +%s)
curl -s http://localhost:8083/ > /tmp/test-web-3b.html
END2=$(date +%s)
DURATION2=$((END2 - START2))
echo "Request 2 completed in ${DURATION2}s"

# Make third request
echo "Making request 3..."
START3=$(date +%s)
curl -s http://localhost:8083/ > /tmp/test-web-3c.html
END3=$(date +%s)
DURATION3=$((END3 - START3))
echo "Request 3 completed in ${DURATION3}s"

# Verify all responses are valid
if ! grep -q "<!DOCTYPE html>" /tmp/test-web-3a.html; then
    echo "❌ FAIL: Request 1 did not receive valid HTML response"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

if ! grep -q "<!DOCTYPE html>" /tmp/test-web-3b.html; then
    echo "❌ FAIL: Request 2 did not receive valid HTML response"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

if ! grep -q "<!DOCTYPE html>" /tmp/test-web-3c.html; then
    echo "❌ FAIL: Request 3 did not receive valid HTML response"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

# Verify COLOR in all responses
for file in /tmp/test-web-3a.html /tmp/test-web-3b.html /tmp/test-web-3c.html; do
    if ! grep -q "blue" "$file"; then
        echo "❌ FAIL: COLOR (blue) not found in $file"
        kill $SERVER_PID 2>/dev/null || true
        exit 1
    fi
done

# Verify timing (each should be ~1 second, allow 0-3 range)
for duration in $DURATION1 $DURATION2 $DURATION3; do
    if [ "$duration" -lt 0 ] || [ "$duration" -gt 3 ]; then
        echo "❌ FAIL: Duration ${duration}s outside expected range (0-3s)"
        kill $SERVER_PID 2>/dev/null || true
        exit 1
    fi
done

echo "✅ PASS: All three sequential requests received valid responses"
echo "✅ PASS: Sequential processing works correctly (netcat model)"
echo ""

# Clean up
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

# Summary
echo "=========================================="
echo "✅ ALL TESTS PASSED!"
echo "=========================================="
echo ""
echo "Summary:"
echo "  ✅ Server accepts connections immediately"
echo "  ✅ DELAY affects response time correctly"
echo "  ✅ COLOR renders properly in HTML"
echo "  ✅ Multiple sequential requests work"
echo "  ✅ Sequential processing model verified"
echo ""
