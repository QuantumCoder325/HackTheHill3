#!/usr/bin/env bash

set -euo pipefail

echo "=============================================="
echo " SmartSpectra Raspberry Pi dependencies"
echo "=============================================="
echo

if [[ "${EUID}" -eq 0 ]]; then
    echo "Please run this script as a normal user."
    echo "It will use sudo when needed."
    exit 1
fi

echo "[1/6] Checking architecture..."

ARCH="$(uname -m)"
DPKG_ARCH="$(dpkg --print-architecture)"

echo "CPU architecture: $ARCH"
echo "Debian architecture: $DPKG_ARCH"

if [[ "$ARCH" != "aarch64" && "$DPKG_ARCH" != "arm64" ]]; then
    echo
    echo "WARNING:"
    echo "This does not appear to be a 64-bit ARM system."
    echo
    echo "SmartSpectra must provide an ARM64/aarch64 SDK"
    echo "for this setup to work."
    echo
fi

echo
echo "[2/6] Updating apt..."

sudo apt update

echo
echo "[3/6] Installing build tools..."

sudo apt install -y \
    build-essential \
    gcc \
    g++ \
    make \
    cmake \
    ninja-build \
    pkg-config \
    git \
    curl \
    wget \
    unzip

echo
echo "[4/6] Installing C++ libraries..."

sudo apt install -y \
    libprotobuf-dev \
    protobuf-compiler \
    libabsl-dev

echo
echo "[5/6] Installing camera/OpenCV dependencies..."

sudo apt install -y \
    libopencv-dev \
    v4l-utils \
    libv4l-dev

echo
echo "[6/6] Checking installation..."

echo
echo "CMake:"
cmake --version | head -1

echo
echo "G++:"
g++ --version | head -1

echo
echo "Protobuf:"
protoc --version

echo
echo "OpenCV:"
pkg-config --modversion opencv4 2>/dev/null || \
    echo "OpenCV pkg-config entry not found."

echo
echo "Video devices:"
ls /dev/video* 2>/dev/null || \
    echo "No /dev/video* devices currently detected."

echo
echo "=============================================="
echo " Dependency installation complete."
echo "=============================================="
echo
echo "IMPORTANT:"
echo
echo "The proprietary SmartSpectra SDK itself is NOT"
echo "installed by apt."
echo
echo "You still need the ARM64/aarch64 SmartSpectra SDK"
echo "package from Presage installed on this Pi."
echo
echo "After installing the SDK, verify:"
echo
echo "  ls /usr/local/lib/cmake/SmartSpectra"
echo "  ls /usr/local/lib/libsmartspectra.so"
echo
