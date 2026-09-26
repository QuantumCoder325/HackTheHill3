#!/usr/bin/env bash

set -e

INSTALL_DIR="/opt/smartspectra"
VERSION="3.3.0"

echo "1. Cleaning up broken APT packages and legacy configurations..."
sudo apt purge -y libsmartspectra-dev 'libsmartspectra*' 'libturbojpeg-dummy' 2>/dev/null || true
sudo rm -f /etc/apt/sources.list.d/presage-technologies.list \
           /etc/apt/keyrings/presage-archive-keyring.gpg \
           /etc/apt/trusted.gpg.d/presage-technologies.gpg
sudo apt update --fix-missing
sudo apt autoremove -y
sudo apt autoclean

echo "2. Installing native Debian/Raspberry Pi OS build dependencies..."
sudo apt install -y build-essential cmake libturbojpeg0-dev libopencv-dev curl

echo "3. Downloading and extracting SmartSpectra SDK v${VERSION}..."
sudo rm -rf "${INSTALL_DIR}"
sudo mkdir -p "${INSTALL_DIR}"

curl -fsSL "https://github.com/Presage-Security/SmartSpectra/releases/download/v3.3.0/smartspectra-sdk-3.3.0-linux-jammy-arm64.tar.gz" | sudo tar -xzf - -C "${INSTALL_DIR}" --strip-components=1

echo "4. Configuring environment variables and dynamic linker..."
echo "export PKG_CONFIG_PATH=${INSTALL_DIR}/lib/pkgconfig:\$PKG_CONFIG_PATH" | sudo tee /etc/profile.d/smartspectra.sh > /dev/null
echo "${INSTALL_DIR}/lib" | sudo tee /etc/ld.so.conf.d/smartspectra.conf > /dev/null
sudo ldconfig

export PKG_CONFIG_PATH="\({INSTALL_DIR}/lib/pkgconfig:\){PKG_CONFIG_PATH}"

echo "Done"
version=$(pkg-config --modversion SmartSpectra)
echo "SDK Version: $version"