#!/usr/bin/env bash

set -e

INSTALL_DIR="/opt/smartspectra"
VERSION="3.3.0"
TARBALL_URL="https://github.com/Presage-Security/SmartSpectra/releases/download/v${VERSION}/smartspectra-sdk-${VERSION}-linux-jammy-arm64.tar.gz"
TARBALL_PATH="/tmp/smartspectra-sdk-${VERSION}.tar.gz"

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

echo "3. Downloading SmartSpectra SDK v${VERSION}..."
# Download to a file first rather than piping straight into tar, so the
# archive can be verified before anything is extracted or the old
# install is removed.
curl -fSL "${TARBALL_URL}" -o "${TARBALL_PATH}"

echo "   Verifying archive contents..."
if ! tar -tzf "${TARBALL_PATH}" | grep -q "^include/smartspectra/messages/metrics.h$"; then
    echo "ERROR: downloaded archive does not contain the expected SDK layout." >&2
    echo "Expected to find include/smartspectra/messages/metrics.h inside it." >&2
    echo "The download may be incomplete, or the release layout has changed." >&2
    exit 1
fi

echo "4. Installing SDK to ${INSTALL_DIR}..."
sudo rm -rf "${INSTALL_DIR}"
sudo mkdir -p "${INSTALL_DIR}"
# NOTE: this archive has NO top-level wrapping folder - its entries are
# bin/, include/, lib/ directly - so do NOT pass --strip-components here.
# (An earlier version of this script used --strip-components=1, which
# silently ate the first real path segment of every file, e.g. turning
# include/smartspectra/... into smartspectra/... one level too shallow.)
sudo tar -xzf "${TARBALL_PATH}" -C "${INSTALL_DIR}"

echo "5. Verifying extracted layout..."
if [ ! -f "${INSTALL_DIR}/include/smartspectra/messages/metrics.h" ]; then
    echo "ERROR: extraction did not produce the expected header layout." >&2
    echo "Expected: ${INSTALL_DIR}/include/smartspectra/messages/metrics.h" >&2
    exit 1
fi

echo "6. Configuring environment variables and dynamic linker..."
echo "export PKG_CONFIG_PATH=\"${INSTALL_DIR}/lib/pkgconfig:\${PKG_CONFIG_PATH:-}\"" | \
    sudo tee /etc/profile.d/smartspectra.sh > /dev/null
echo "${INSTALL_DIR}/lib" | sudo tee /etc/ld.so.conf.d/smartspectra.conf > /dev/null
sudo ldconfig

# Set it for the rest of *this* script run too (the /etc/profile.d file
# only takes effect in new shells). Fixed: the previous version of this
# line used literal "\(" "\)" instead of "${...}" and never actually
# expanded INSTALL_DIR or PKG_CONFIG_PATH.
export PKG_CONFIG_PATH="${INSTALL_DIR}/lib/pkgconfig:${PKG_CONFIG_PATH:-}"

echo
echo "Done."
echo "SDK installed at: ${INSTALL_DIR}"
echo "Headers:          ${INSTALL_DIR}/include/smartspectra/"
echo "Libs:              ${INSTALL_DIR}/lib/"
echo
echo "Note: this SDK bundles its own vendored protobuf headers under"
echo "  ${INSTALL_DIR}/include/smartspectra/interface/google/protobuf/"
echo "Your project's CMakeLists.txt include_directories() needs BOTH:"
echo "  ${INSTALL_DIR}/include"
echo "  ${INSTALL_DIR}/include/smartspectra/interface"
echo "or the compiler will fall through to the system protobuf (likely"
echo "older, and missing headers like runtime_version.h)."
echo

# pkg-config lookup is best-effort only - not all SDK builds ship a .pc
# file, so don't fail the whole install over this.
if pkg-config --exists SmartSpectra 2>/dev/null; then
    echo "SDK Version (via pkg-config): $(pkg-config --modversion SmartSpectra)"
else
    echo "(No pkg-config entry named 'SmartSpectra' found - that's OK if"
    echo " your CMakeLists.txt links against it via include_directories()"
    echo " / link_directories() directly instead of find_package(PkgConfig).)"
fi
