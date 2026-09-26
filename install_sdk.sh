#!/usr/bin/env bash

set -e

# Target directory for the SDK
INSTALL_DIR="/opt/smartspectra"
VERSION="latest" # Replace with specific version tag if required (e.g., "3.3.0")

echo "Installing SmartSpectra SDK dependencies..."
sudo apt update
sudo apt install -y build-essential cmake libturbojpeg0-dev libopencv-dev curl

echo "Downloading and extracting SmartSpectra SDK tarball..."
sudo mkdir -p "${INSTALL_DIR}"

# Download and extract jammy-arm64 release tarball directly
TMP_DIR=$(mktemp -d)
curl -fsSL "https://github.com/Presage-Security/SmartSpectra/releases/latest/download/smartspectra-sdk-${VERSION}-linux-jammy-arm64.tar.gz" \
  | sudo tar -xzf - -C "${INSTALL_DIR}" --strip-components=1

echo "Configuring environment variables..."
# Export PKG_CONFIG_PATH so pkg-config and CMake can locate the library
export PKG_CONFIG_PATH="\({INSTALL_DIR}/lib/pkgconfig:\){PKG_CONFIG_PATH}"

# Write PKG_CONFIG_PATH to profile.d for persistent global availability
echo "export PKG_CONFIG_PATH=${INSTALL_DIR}/lib/pkgconfig:\$PKG_CONFIG_PATH" | sudo tee /etc/profile.d/smartspectra.sh > /dev/null
echo "${INSTALL_DIR}/lib" | sudo tee /etc/ld.so.conf.d/smartspectra.conf > /dev/null
sudo ldconfig

echo "Done"
version=$(pkg-config --modversion SmartSpectra)
echo "SDK Version: $version"