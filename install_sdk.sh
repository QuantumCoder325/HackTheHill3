#!/usr/bin/env bash

echo "Installing Presage SDK..."
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://packages.presagetech.com/KEY.gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/presage-archive-keyring.gpg
sudo chmod 644 /etc/apt/keyrings/presage-archive-keyring.gpg

# Remove legacy key to prevent Signed-By conflicts
sudo rm -f /etc/apt/trusted.gpg.d/presage-technologies.gpg

# Target 'jammy' for Debian / Raspberry Pi OS package compatibility
echo "deb [signed-by=/etc/apt/keyrings/presage-archive-keyring.gpg] https://packages.presagetech.com/apt/ubuntu jammy main" \
  | sudo tee /etc/apt/sources.list.d/presage-technologies.list

sudo apt update
sudo apt install -y libsmartspectra-dev

echo "Done"
version=$(pkg-config --modversion SmartSpectra)
echo "SDK Version: $version"