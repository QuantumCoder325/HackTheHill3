#!/usr/bin/env bash
#
# raspi_camera_bridge.sh
#
# Bridges a Raspberry Pi CSI camera (libcamera-only device) into a
# standard V4L2 capture node that metrics_console's --camera_device_index
# can open, the same way it opens a USB webcam.
#
# Why this is needed:
#   metrics_console uses the SmartSpectra SDK's UseCamera(index), which
#   opens /dev/video<index> as a plain V4L2 capture device. A USB webcam
#   exposes itself that way automatically. A Pi CSI camera does not —
#   it's driven by libcamera, so there is no raw capture node for it
#   until you create one.
#
# What this script does:
#   1. Loads v4l2loopback and creates a virtual /dev/videoN device.
#   2. Runs a GStreamer pipeline that reads the CSI camera via
#      libcamerasrc and writes decoded frames into that virtual device.
#   3. metrics_console then opens the virtual device like any webcam.
#
# Usage:
#   ./raspi_camera_bridge.sh [camera_num] [width] [height] [fps]
#
#   camera_num - which CSI port to use: 0 or 1 (default 0).
#                On boards with two CSI connectors (e.g. Pi 5, CM4 IO
#                board), port 1 is often silkscreened "CAM/DISP1" or
#                "CAM1". Run `rpicam-hello --list-cameras` if unsure
#                which index libcamera assigns to that physical port.
#   width/height/fps - defaults: 1280 720 30 (match metrics_console's
#                defaults so no --capture_* flags are needed).
#
# Then, in another terminal:
#   ./metrics_console --api_key=YOUR_API_KEY --camera_device_index=<printed index>
#
# Stop the bridge with Ctrl+C; it tears down the loopback device on exit.

set -euo pipefail

CAMERA_NUM="${1:-0}"
WIDTH="${2:-1280}"
HEIGHT="${3:-720}"
FPS="${4:-30}"
LOOPBACK_DEVICE_NUM=10
LOOPBACK_PATH="/dev/video${LOOPBACK_DEVICE_NUM}"
LABEL="smartspectra-raspi-cam"

command -v gst-launch-1.0 >/dev/null || {
    echo "gst-launch-1.0 not found. Install it with:" >&2
    echo "  sudo apt install gstreamer1.0-tools gstreamer1.0-plugins-good \\" >&2
    echo "    gstreamer1.0-plugins-bad gstreamer1.0-libcamera" >&2
    exit 1
}

if ! lsmod | grep -q '^v4l2loopback'; then
    echo "Loading v4l2loopback and creating ${LOOPBACK_PATH}..."
    if ! modinfo v4l2loopback >/dev/null 2>&1; then
        echo "v4l2loopback is not installed. Install it with:" >&2
        echo "  sudo apt install v4l2loopback-dkms" >&2
        exit 1
    fi
    sudo modprobe v4l2loopback \
        video_nr="${LOOPBACK_DEVICE_NUM}" \
        card_label="${LABEL}" \
        exclusive_caps=1
else
    echo "v4l2loopback already loaded, reusing existing device(s)."
fi

if [ ! -e "${LOOPBACK_PATH}" ]; then
    echo "Expected ${LOOPBACK_PATH} to exist after modprobe but it doesn't." >&2
    echo "Another v4l2loopback device may already own that number; check 'v4l2-ctl --list-devices'." >&2
    exit 1
fi

cleanup() {
    echo
    echo "Stopping bridge..."
    sudo modprobe -r v4l2loopback 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo
echo "Bridging CSI camera ${CAMERA_NUM} -> ${LOOPBACK_PATH} (${WIDTH}x${HEIGHT}@${FPS})"
echo "Once you see frames flowing, run metrics_console with:"
echo "  --camera_device_index=${LOOPBACK_DEVICE_NUM}"
echo "Press Ctrl+C here to stop the bridge."
echo

gst-launch-1.0 -v \
    libcamerasrc camera-name="$(cat /proc/device-tree/model 2>/dev/null; true)" ! \
    "video/x-raw,width=${WIDTH},height=${HEIGHT},framerate=${FPS}/1,format=NV12" ! \
    videoconvert ! \
    "video/x-raw,format=YUY2" ! \
    v4l2sink device="${LOOPBACK_PATH}" sync=false

# Note: if libcamerasrc can't auto-pick the right physical port for
# CAMERA_NUM on your board, replace the camera-name property above with
# an explicit camera path from `rpicam-hello --list-cameras`, e.g.:
#   libcamerasrc camera-name=/base/soc/i2c0mux/i2c@1/imx708@1a
