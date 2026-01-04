#!/bin/bash
set -e

# Start Xvfb (virtual framebuffer) for headful browser support
echo "Starting Xvfb virtual display on :99..."
Xvfb :99 -screen 0 1920x1080x24 -ac &
XVFB_PID=$!

# Wait for Xvfb to start
sleep 2

# Verify Xvfb is running
if ! kill -0 $XVFB_PID 2>/dev/null; then
    echo "ERROR: Xvfb failed to start"
    exit 1
fi

echo "Xvfb started successfully (PID: $XVFB_PID)"

# Set DISPLAY environment variable
export DISPLAY=:99

# Run the actual command (passed as arguments)
echo "Starting application..."
exec "$@"
