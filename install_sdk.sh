#!/usr/bin/env bash


echo "Installing Presage SDK..."
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://packages.presagetech.com/KEY.gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/presage-archive-keyring.gpg
sudo chmod 644 /etc/apt/keyrings/presage-archive-keyring.gpg

echo "deb [signed-by=/etc/apt/keyrings/presage-archive-keyring.gpg] https://packages.presagetech.com/apt/ubuntu noble main" \
  | sudo tee /etc/apt/sources.list.d/presage-technologies.list

sudo apt update
sudo apt install libsmartspectra-dev

echo "Done"
version=$(pkg-config --modversion SmartSpectra)
echo "SDK Version: $version"

