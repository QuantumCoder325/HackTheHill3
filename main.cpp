// Copyright (C) 2024-2026 Presage Technologies, Inc.
//
// SPDX-License-Identifier: LicenseRef-Proprietary
//
// Console-only SmartSpectra example.
// Uses a USB camera and prints cardio/breathing metrics to stdout.
//
// Usage:
//   ./metrics_console --api_key=YOUR_API_KEY
//
// Optional:
//   --camera_device_index=0
//   --capture_width_px=1280
//   --capture_height_px=720
//   --capture_fps=30

#include <chrono>
#include <csignal>
#include <iostream>
#include <string>
#include <thread>

#include <absl/flags/flag.h>
#include <absl/flags/parse.h>

#include <smartspectra/messages/metrics.h>
#include <smartspectra/smartspectra.h>
#include <smartspectra/smartspectra_config.h>

namespace spectra = presage::smartspectra;

namespace {

volatile std::sig_atomic_t g_stop_requested = 0;

void HandleSignal(int) {
    g_stop_requested = 1;
}

}  // namespace

ABSL_FLAG(
    std::string,
    api_key,
    "",
    "API key for the Physiology service.");

ABSL_FLAG(
    int,
    camera_device_index,
    0,
    "USB camera device index. Usually 0 (/dev/video0).");

ABSL_FLAG(
    int,
    capture_width_px,
    1280,
    "Camera capture width.");

ABSL_FLAG(
    int,
    capture_height_px,
    720,
    "Camera capture height.");

ABSL_FLAG(
    int,
    capture_fps,
    30,
    "Camera capture FPS.");

int main(int argc, char** argv) {
    std::signal(SIGINT, HandleSignal);

    absl::ParseCommandLine(argc, argv);

    const std::string api_key = absl::GetFlag(FLAGS_api_key);

    if (api_key.empty()) {
        std::cerr
            << "Missing API key.\n\n"
            << "Usage:\n"
            << "  ./metrics_console --api_key=YOUR_API_KEY\n\n"
            << "Optional:\n"
            << "  --camera_device_index=0\n"
            << "  --capture_width_px=1280\n"
            << "  --capture_height_px=720\n"
            << "  --capture_fps=30\n";

        return 1;
    }

    // ------------------------------------------------------------
    // SmartSpectra configuration
    // ------------------------------------------------------------

    spectra::SmartSpectraConfig config;

    config.api_key = api_key;

    // Request the same metric groups as the working hello_vitals example.
    config.requested_metrics =
        spectra::SmartSpectraConfig::BreathingMetrics();

    config.AddMetrics(
        spectra::SmartSpectraConfig::CardioMetrics());

    spectra::SmartSpectra sdk(std::move(config));

    std::cout
        << "SmartSpectra version: "
        << spectra::SmartSpectra::version
        << '\n';

    // ------------------------------------------------------------
    // Validation callback
    // ------------------------------------------------------------

    sdk.SetOnValidationStatusChanged(
        [](const spectra::ValidationStatus& status, int64_t timestamp) {
            std::cout
                << "[Validation] "
                << status.code
                << ": "
                << status.hint
                << " @ "
                << timestamp
                << '\n';
        });

    // ------------------------------------------------------------
    // Metrics callback
    // ------------------------------------------------------------

    sdk.SetOnMetrics(
        [](const spectra::Metrics& metrics, int64_t timestamp) {

            std::cout
                << "\n========== METRICS ==========\n"
                << "Timestamp: "
                << timestamp
                << '\n';

            if (metrics.has_cardio()) {
                std::cout
                    << "\n--- CARDIO ---\n"
                    << metrics.cardio().ShortDebugString()
                    << '\n';
            }

            if (metrics.has_breathing()) {
                std::cout
                    << "\n--- BREATHING ---\n"
                    << metrics.breathing().ShortDebugString()
                    << '\n';
            }

            std::cout
                << "=============================\n";
        });

    // ------------------------------------------------------------
    // Error callback
    // ------------------------------------------------------------

    sdk.SetOnError(
        [](const spectra::SmartSpectraError& error) {
            std::cerr
                << "[SmartSpectra Error] "
                << error.FullMessage()
                << '\n';
        });

    // ------------------------------------------------------------
    // Configure USB camera
    // ------------------------------------------------------------

    const int camera_index =
        absl::GetFlag(FLAGS_camera_device_index);

    const int width =
        absl::GetFlag(FLAGS_capture_width_px);

    const int height =
        absl::GetFlag(FLAGS_capture_height_px);

    const int fps =
        absl::GetFlag(FLAGS_capture_fps);

    std::cout
        << "Configuring camera:\n"
        << "  Device index: " << camera_index << '\n'
        << "  Resolution:   " << width << "x" << height << '\n'
        << "  FPS:           " << fps << '\n';

    const auto source_error =
        sdk.UseCamera(camera_index)
            .SetResolution(width, height)
            .SetFps(fps)
            .Build();

    if (!source_error.ok()) {
        std::cerr
            << "Failed to create camera source: "
            << source_error.message
            << '\n';

        return 1;
    }

    // ------------------------------------------------------------
    // Start SmartSpectra
    // ------------------------------------------------------------

    if (const auto err = sdk.Start(); !err.ok()) {
        std::cerr
            << "Failed to start SmartSpectra: "
            << err.FullMessage()
            << '\n';

        return 1;
    }

    std::cout
        << "\nSmartSpectra is running.\n"
        << "Camera: /dev/video"
        << camera_index
        << '\n'
        << "Press Ctrl+C to stop.\n\n';

    // ------------------------------------------------------------
    // Run until Ctrl+C
    // ------------------------------------------------------------

    while (!g_stop_requested) {
        std::this_thread::sleep_for(
            std::chrono::milliseconds(200));
    }

    std::cout << "\nStopping SmartSpectra...\n";

    // ------------------------------------------------------------
    // Stop
    // ------------------------------------------------------------

    if (const auto err = sdk.Stop(); !err.ok()) {
        std::cerr
            << "Stop failed: "
            << err.FullMessage()
            << '\n';

        return 1;
    }

    std::cout << "SmartSpectra stopped.\n";

    return 0;
}
