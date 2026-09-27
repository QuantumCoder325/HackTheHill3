// main.js
// Copyright (C) 2026 Presage Technologies, Inc.
//
// SPDX-License-Identifier: LicenseRef-Proprietary
//
// Main-process entry point for the SmartSpectra Electron quickstart.
//
// Responsibilities:
//   1. Spawn a BrowserWindow that hosts the renderer-side SDK.
//   2. Wire the IPC channel that the renderer uses to talk to the
//      main-process SDK (via bindSmartSpectraIpc).
//   3. Auto-allow camera permission for the sample window so the user is
//      prompted by the OS once (macOS) or implicitly (Windows / Linux).

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { app, BrowserWindow, session } = require('electron');

// In a packaged build the native runtime closure is delivered as an extra
// resource at `resources/smartspectra/` (see package.json#build.extraResources),
// NOT inside app.asar — a .dylib/.dll/.so cannot be dlopen'd from within an asar
// archive. Point the binding's resolver at that unpacked copy BEFORE requiring
// the binding (the require triggers the native load). During `npm start` (not
// packaged) this is skipped and the resolver uses the per-platform package or
// the SMARTSPECTRA_CAPI_PATH you exported in your shell.
// Note: this honors a pre-set SMARTSPECTRA_CAPI_PATH even in a packaged build,
// so the bundled-resource path is the default but not forced. That's the
// binding's deliberate dev/override escape hatch. A production app that doesn't
// want its native library redirectable via the environment should set the
// bundled resource path UNCONDITIONALLY (drop the `!process.env...` guard).
if (app.isPackaged && !process.env.SMARTSPECTRA_CAPI_PATH) {
    const LIB = {
        darwin: 'libsmartspectra_capi.dylib',
        win32:  'smartspectra_capi.dll',
        linux:  'libsmartspectra_capi.so',
    }[process.platform];
    if (LIB) {
        process.env.SMARTSPECTRA_CAPI_PATH =
            path.join(process.resourcesPath, 'smartspectra', LIB);
    } else {
        // We shouldn't get here — electron-builder is configured only for the
        // platforms above. Flag it clearly so the imminent resolver failure
        // reads as "this packaged build has no resource layout for <platform>"
        // rather than the generic missing-platform-package message.
        console.error(
            `[smartspectra] packaged build on unsupported platform "${process.platform}" — ` +
            `no resources/smartspectra/ layout for it; the native binding will fail to load.`);
    }
}

const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');

// Verbose IPC logging + auto-opened DevTools are opt-in via the
// `SMARTSPECTRA_DIAGNOSTICS=1` env var. A regular `npm start` launches
// a clean production-style window; pass the env var when debugging the
// frame pump or graph wiring (e.g. `SMARTSPECTRA_DIAGNOSTICS=1 npm start`).
const DIAGNOSTICS = process.env.SMARTSPECTRA_DIAGNOSTICS === '1';

// The renderer pumps camera frames to the SDK in real time. Stop Chromium
// from deprioritising or throttling it if the window is covered, minimised,
// or the Pi display blanks mid-measurement. Must be set before app ready.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');


// ---------------------------------------------------------------------------
// Camera preflight (Raspberry Pi + v4l2loopback)
// ---------------------------------------------------------------------------
// Chromium only lists the loopback device as a camera when:
//   1. v4l2loopback is loaded with exclusive_caps=1, and
//   2. the rpicam-vid | ffmpeg pipe is writing to it (Device Caps shows
//      "Video Capture" and not "Video Output").
// This checks both before the window opens. If the pipe isn't up yet it
// waits for it, so starting the app before the pipe no longer breaks things.
// Skipped on non-Linux and when v4l2loopback isn't loaded (USB webcams).
//
// Overrides:
//   VITASPECTRA_CAMERA_DEVICE=/dev/video10   loopback device node
//   VITASPECTRA_CAMERA_WAIT_MS=60000         how long to wait for the pipe (0 = don't wait)

const CAMERA_DEVICE = process.env.VITASPECTRA_CAMERA_DEVICE || '/dev/video10';
const CAMERA_WAIT_MS = (() => {
    const parsed = Number(process.env.VITASPECTRA_CAMERA_WAIT_MS);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 60000;
})();
const LOOPBACK_PARAMS_DIR = '/sys/module/v4l2loopback/parameters';
const LOOPBACK_RELOAD_CMD =
    'sudo modprobe -r v4l2loopback && ' +
    'sudo modprobe v4l2loopback video_nr=10 card_label="picam" exclusive_caps=1';

function cameraLog(message) {
    console.log(`[VitaSpectra] camera: ${message}`);
}

function cameraWarn(message) {
    console.warn(`[VitaSpectra] camera: ${message}`);
}

function readLoopbackParam(name) {
    try {
        return fs.readFileSync(path.join(LOOPBACK_PARAMS_DIR, name), 'utf8').trim();
    } catch {
        return null;
    }
}

// Parses the indented list under "Device Caps" in `v4l2-ctl --info`.
// Resolves { capture, output }, or null if v4l2-ctl can't be run.
function readDeviceCaps(device) {
    return new Promise((resolve) => {
        execFile('v4l2-ctl', ['-d', device, '--info'], { timeout: 3000 }, (error, stdout) => {
            if (error) {
                resolve(null);
                return;
            }
            const lines = String(stdout).split('\n');
            const start = lines.findIndex((line) => /Device Caps/.test(line));
            if (start < 0) {
                resolve(null);
                return;
            }
            const indentOf = (line) => line.length - line.trimStart().length;
            const baseIndent = indentOf(lines[start]);
            const caps = [];
            for (let i = start + 1; i < lines.length; i++) {
                if (!lines[i].trim() || indentOf(lines[i]) <= baseIndent) break;
                caps.push(lines[i].trim());
            }
            resolve({
                capture: caps.includes('Video Capture'),
                output: caps.includes('Video Output'),
            });
        });
    });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForLoopbackCamera() {
    if (process.platform !== 'linux') return;

    const exclusiveCaps = readLoopbackParam('exclusive_caps');
    if (exclusiveCaps === null) {
        cameraLog('v4l2loopback not loaded, skipping loopback checks.');
        return;
    }

    // Comma-separated array, one slot per possible device; slot 0 is ours.
    if (!exclusiveCaps.startsWith('Y')) {
        cameraWarn(
            'v4l2loopback is loaded WITHOUT exclusive_caps=1, so Chromium will not ' +
            'list it as a camera. Close the app, stop the pipe, then run:\n  ' +
            LOOPBACK_RELOAD_CMD);
        return;
    }

    if (!fs.existsSync(CAMERA_DEVICE)) {
        cameraWarn(
            `${CAMERA_DEVICE} does not exist (v4l2loopback video_nr=` +
            `${readLoopbackParam('video_nr')}). Check \`v4l2-ctl --list-devices\`.`);
        return;
    }

    const deadline = Date.now() + Math.max(0, CAMERA_WAIT_MS);
    let announced = false;

    for (;;) {
        const caps = await readDeviceCaps(CAMERA_DEVICE);

        if (caps === null) {
            cameraWarn(
                'could not run v4l2-ctl to check the pipe. Make sure ' +
                'rpicam-vid | ffmpeg is running before pressing START.');
            return;
        }

        if (caps.capture && !caps.output) {
            cameraLog(`${CAMERA_DEVICE} is live.`);
            return;
        }

        if (caps.capture && caps.output) {
            // What exclusive_caps=N looks like: Chromium skips any device
            // that also reports Video Output, so waiting won't help.
            cameraWarn(
                `${CAMERA_DEVICE} reports both Video Capture and Video Output, so ` +
                'Chromium will not list it. Close the app, stop the pipe, then run:\n  ' +
                LOOPBACK_RELOAD_CMD);
            return;
        }

        if (Date.now() >= deadline) {
            cameraWarn(
                `${CAMERA_DEVICE} still has no producer. Opening the window anyway; ` +
                'start the pipe, then restart the app.');
            return;
        }

        if (!announced) {
            cameraLog(
                `waiting for the rpicam-vid | ffmpeg pipe on ${CAMERA_DEVICE} ` +
                `(up to ${Math.round(CAMERA_WAIT_MS / 1000)} s)...`);
            announced = true;
        }

        await sleep(500);
    }
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1100,
        height: 760,
        backgroundColor: '#101218',
        webPreferences: {
            // Point the BrowserWindow at the package's preload bridge so
            // the renderer's SmartSpectraSDK can talk to this main process.
            // The preload runs in its own isolated world and exposes a
            // tightly-scoped `window.__smartspectraBridge` to the renderer.
            preload: require.resolve('@smartspectra/node-sdk/preload'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            backgroundThrottling: false,
        },
    });

    bindSmartSpectraIpc(win);

    // A quickstart only ever renders its own bundled page. Block popups and
    // navigation away from it so a copied-and-extended app can't be steered to
    // remote content that would inherit this window's camera grant.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());

    win.loadFile(path.join(__dirname, 'index.html'));
    if (DIAGNOSTICS) {
        // Opt-in via SMARTSPECTRA_DIAGNOSTICS=1 so the renderer-side
        // `console` output (frame pump diagnostics, validation /
        // processing status traces) is visible without extra setup.
        // Silent by default so a casual `npm start` looks production-like.
        win.webContents.openDevTools({ mode: 'detach' });
    }
}

app.whenReady().then(async () => {
    // Allow the renderer's `getUserMedia({ video: true })` call without an
    // extra in-page prompt. The OS-level camera prompt (macOS) and
    // indicator LED still fire normally. Grant ONLY the camera and ONLY to
    // the bundled local page — deny everything else so a copied app that
    // later loads remote content doesn't auto-grant the camera.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
        const url = (details && details.requestingUrl) || (wc && wc.getURL()) || '';
        // Electron's 'media' permission covers camera AND microphone. The
        // quickstart only needs the camera (the SDK calls
        // getUserMedia({ video: ... }) with no audio), so require a video-only
        // request and deny anything that also asks for the mic — don't hand a
        // copied sample a broader grant than it uses.
        const mediaTypes = (details && details.mediaTypes) || [];
        const cameraOnly = mediaTypes.length === 1 && mediaTypes[0] === 'video';
        callback(permission === 'media' && cameraOnly && url.startsWith('file://'));
    });

    try {
        await waitForLoopbackCamera();
    } catch (error) {
        cameraWarn(`preflight failed: ${error && error.message ? error.message : error}`);
    }

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
