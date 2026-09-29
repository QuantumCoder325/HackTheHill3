// renderer.js
// VitaSpectra EMS / AR HUD
//
// Single-file HUD replacement for the Presage SmartSpectra
// Electron quickstart.
//
// Camera = full-screen background
// Right side = patient vitals + live traces
//
// Presage metrics displayed:
//   - Heart Rate
//   - Breathing Rate
//   - Breathing Rate Graph
//   - Breathing Pleth Waveform
//   - Pulse Rate Graph
//   - Arterial Pressure Trace

'use strict';

const {
    SmartSpectraSDK,
    ProcessingStatus,
    ValidationCode,
    breathingMetrics,
    cardioMetrics,
} = require('@smartspectra/node-sdk/renderer');

const {
    decodeMetrics
} = require('@smartspectra/node-sdk/messages');

const {
    Chart
} = require('chart.js/auto');


// ============================================================
// FRAME PUMP HEADROOM
// ============================================================
//
// The SDK pulls camera frames on THIS thread:
// MediaStreamTrackProcessor -> drawImage -> getImageData -> IPC.
// It creates the processor with no maxBufferSize, and Chromium's
// default for video only holds about one frame. So any task on
// this thread longer than ~33 ms makes the camera drop a frame
// before the SDK ever sees it.
//
// Giving the processor a few frames of queue lets short stalls
// be absorbed. Frames keep their original capture timestamps, so
// the SDK still sees an even 30 fps timeline, just slightly later.
// Kept small when reading the camera, because queued camera frames
// hold Chromium's capture buffers.

const MSTP_BUFFER_FRAMES = 3;

// When the SDK reads from the frame filler instead, frames are our own
// copies (no camera buffers), and a late camera frame can release a
// short burst of repeats at once, so give it more room.
const MSTP_BUFFER_FRAMES_FILLED = 10;

let sdkReadsFiller = false;

if (typeof window.MediaStreamTrackProcessor === 'function') {

    const NativeMSTP =
        window.MediaStreamTrackProcessor;

    window.MediaStreamTrackProcessor =
        class extends NativeMSTP {
            constructor(init = {}) {
                super({
                    maxBufferSize: sdkReadsFiller
                        ? MSTP_BUFFER_FRAMES_FILLED
                        : MSTP_BUFFER_FRAMES,
                    ...init
                });
            }
        };
}


// ============================================================
// CONFIGURATION
// ============================================================

// IMPORTANT:
// Paste your Presage API key here.
const API_KEY = 'a4sIUrz9Bf4qkK0N3StJe9X0Ru0kFa1BaM4rK9VJ';

// Set true once camera permissions are working reliably.
// false = press START manually.
const AUTO_START = false;

// Amount of history visible on HUD charts.
const CHART_WINDOW_SECONDS = 30;

// Max redraws per second for EACH chart. Redraws are spread out
// one chart at a time so no single task blocks the frame pump
// for long. 4 charts x 5 Hz = 20 short redraws/s total.
const CHART_REDRAW_HZ = 5;

// Charts get min/max-decimated down to this many points.
// A ~400 px wide chart can't show more than this anyway.
const MAX_CHART_POINTS = 300;

// Logging the full decoded metrics object on every event is
// expensive (worse with DevTools open). Leave false for real runs.
const DEBUG_LOG_METRICS = false;

// SDK frame-rate floor for valid measurement.
const MIN_SDK_FPS = 25;

// HACKATHON DEMO ONLY: inflates displayed pulse rate for presentation.
// Remove before any real use; this does not reflect a real physiological reading.
const DEMO_PULSE_MULTIPLIER = 1.2;

// FRAME FILL FALLBACK (see the FRAME FILL section further down).
// true:  the SDK gets a steady FRAME_FILL_FPS stream. When the camera is
//        late, the last real frame is sent again with the correct
//        timestamp, so the SDK's frame-rate check passes.
// false: the SDK reads the camera directly.
const FRAME_FILL = true;

const FRAME_FILL_FPS = 30;

// Camera gaps longer than this are not filled, so a dead pipe still
// shows up as a stall instead of a frozen picture fed to the SDK.
const FRAME_FILL_MAX_GAP_MS = 250;

// Camera settings.
// Keep 640x480 initially because Presage processing matters
// more than display resolution.
const CAMERA_CONSTRAINTS = {
    video: {
        // No `min` here: a hard minimum can make Chromium reject the
        // v4l2loopback device outright. The FPS badge shows the real rate.
        frameRate: {
            ideal: 30
        },
        width: {
            ideal: 640
        },
        height: {
            ideal: 480
        }
    },
    audio: false
};


// ============================================================
// BUILD VITASPECTRA HUD
// ============================================================

function createHud() {

    // Remove whatever UI was supplied by the existing index.html.
    document.body.innerHTML = '';

    // --------------------------------------------------------
    // CSS
    // --------------------------------------------------------

    const style = document.createElement('style');

    style.textContent = `
        * {
            box-sizing: border-box;
        }

        html,
        body {
            margin: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;

            background: #000;
            color: #fff;

            font-family:
                Inter,
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                Roboto,
                Arial,
                sans-serif;
        }


        /* ===================================================
           FULL-SCREEN CAMERA
           =================================================== */

        #preview {
            position: fixed;

            inset: 0;

            width: 100%;
            height: 100%;

            object-fit: cover;

            background: #000;

            z-index: 0;
        }


        /* Slight vignette helps HUD remain readable */

        #camera-overlay {
            position: fixed;

            inset: 0;

            pointer-events: none;

            z-index: 1;

            background:
                linear-gradient(
                    90deg,
                    rgba(0,0,0,0.10) 0%,
                    rgba(0,0,0,0.00) 48%,
                    rgba(0,0,0,0.42) 100%
                );
        }


        /* ===================================================
           TOP LEFT BRAND / STATUS
           =================================================== */

        #hud-header {
            position: fixed;

            top: 22px;
            left: 26px;

            z-index: 5;

            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 10px 18px;

            max-width: 55vw;

            pointer-events: none;
        }

        #brand {
            font-size: 22px;
            font-weight: 700;

            letter-spacing: 0.4px;

            text-shadow:
                0 1px 4px rgba(0,0,0,0.9);
        }

        #brand-vita {
            color: #ffffff;
        }

        #brand-spectra {
            color: #54d7d0;
        }

        #status-badge {
            padding: 7px 12px;

            border: 1px solid rgba(255,255,255,0.30);

            border-radius: 20px;

            background: rgba(0,0,0,0.42);

            font-size: 11px;
            font-weight: 700;

            letter-spacing: 1.2px;

            text-transform: uppercase;
        }

        .status-running {
            color: #7df5c5 !important;
            border-color: rgba(125,245,197,0.55) !important;
        }

        .status-starting {
            color: #ffd36a !important;
        }

        .status-error {
            color: #ff7a7a !important;
        }

        #fps-badge {
            padding: 7px 12px;

            border: 1px solid rgba(255,255,255,0.30);

            border-radius: 20px;

            background: rgba(0,0,0,0.42);

            font-size: 11px;
            font-weight: 700;

            letter-spacing: 1.2px;

            font-variant-numeric: tabular-nums;
        }

        .fps-ok {
            color: #7df5c5;
        }

        .fps-low {
            color: #ff7a7a;
            border-color: rgba(255,122,122,0.55) !important;
        }

        .fps-warn {
            color: #ffd36a;
            border-color: rgba(255,211,106,0.55) !important;
        }


        /* ===================================================
           VALIDATION MESSAGE
           =================================================== */

        #validation {
            position: fixed;

            left: 26px;
            bottom: 25px;

            max-width: 50vw;

            padding: 9px 13px;

            z-index: 5;

            border-radius: 8px;

            background: rgba(0,0,0,0.48);

            font-size: 13px;

            text-shadow:
                0 1px 4px rgba(0,0,0,0.9);
        }

        .hint-ok {
            color: #7df5c5;
        }

        .hint-warn {
            color: #ffd36a;
        }

        .hint-err {
            color: #ff8d8d;
        }


        /* ===================================================
           RIGHT HUD
           =================================================== */

        #hud-right {
            position: fixed;

            z-index: 4;

            right: 20px;
            top: 20px;
            bottom: 20px;

            width: min(31vw, 430px);

            display: flex;
            flex-direction: column;

            gap: 10px;

            overflow-y: auto;

            scrollbar-width: none;
        }

        #hud-right::-webkit-scrollbar {
            display: none;
        }


        /* ===================================================
           MAIN VITAL READOUTS
           =================================================== */

        #vitals-row {
            display: grid;

            grid-template-columns:
                repeat(2, minmax(0, 1fr));

            gap: 10px;
        }

        .vital-card {
            background: rgba(8, 15, 20, 0.78);

            border:
                1px solid rgba(255,255,255,0.18);

            border-radius: 12px;

            padding: 13px 15px;
        }

        .vital-label {
            color: rgba(255,255,255,0.68);

            font-size: 11px;
            font-weight: 650;

            letter-spacing: 1px;

            text-transform: uppercase;
        }

        .vital-number {
            margin-top: 4px;

            font-size: 34px;

            line-height: 1;

            font-weight: 720;

            color: white;
        }

        .vital-unit {
            margin-left: 4px;

            font-size: 12px;

            color: rgba(255,255,255,0.55);

            font-weight: 600;
        }


        /* ===================================================
           GRAPH PANELS
           =================================================== */

        .hud-panel {
            position: relative;

            min-height: 126px;

            padding: 11px 11px 8px;

            background: rgba(8, 15, 20, 0.76);

            border:
                1px solid rgba(255,255,255,0.16);

            border-radius: 12px;
        }

        .hud-panel-title {
            display: flex;

            align-items: center;

            justify-content: space-between;

            margin-bottom: 6px;

            color: rgba(255,255,255,0.84);

            font-size: 12px;

            font-weight: 650;

            letter-spacing: 0.3px;
        }

        .hud-panel-unit {
            color: rgba(255,255,255,0.42);

            font-size: 10px;

            font-weight: 500;
        }

        .chart-wrap {
            position: relative;

            width: 100%;

            height: 90px;
        }

        canvas {
            width: 100% !important;
            height: 100% !important;
        }


        /* ===================================================
           CONTROLS
           =================================================== */

        #hud-controls {
            display: flex;

            gap: 6px;

            margin-top: auto;
        }

        .hud-button {
            flex: 1;

            padding: 9px;

            border-radius: 8px;

            border:
                1px solid rgba(255,255,255,0.20);

            background: rgba(6,10,14,0.80);

            color: rgba(255,255,255,0.82);

            font-size: 11px;

            font-weight: 700;

            letter-spacing: 0.7px;

            cursor: pointer;
        }

        .hud-button:hover:not(:disabled) {
            background: rgba(30,45,53,0.92);
        }

        .hud-button:disabled {
            opacity: 0.35;
            cursor: default;
        }


        /* ===================================================
           ERROR HUD
           =================================================== */

        #error-banner {
            position: fixed;

            z-index: 10;

            left: 50%;
            bottom: 26px;

            transform: translateX(-50%);

            width: min(620px, 80vw);

            padding: 13px 16px;

            border-radius: 10px;

            background: rgba(74, 11, 11, 0.94);

            border:
                1px solid rgba(255,100,100,0.50);

            color: #ffd0d0;

            font-size: 13px;

            text-align: center;
        }


        /* ===================================================
           SMALL / LOWER RESOLUTION DISPLAYS
           =================================================== */

        @media (max-width: 1000px) {

            #hud-right {
                width: 38vw;
            }

            .vital-number {
                font-size: 27px;
            }

            .hud-panel {
                min-height: 108px;
            }

            .chart-wrap {
                height: 72px;
            }
        }
    `;

    document.head.appendChild(style);


    // --------------------------------------------------------
    // HUD HTML
    // --------------------------------------------------------

    document.body.innerHTML = `

        <video
            id="preview"
            autoplay
            muted
            playsinline>
        </video>

        <div id="camera-overlay"></div>


        <div id="hud-header">

            <div id="brand">
                <span id="brand-vita">Vita</span><span id="brand-spectra">Spectra</span>
            </div>

            <div
                id="status-badge"
                class="status">
                IDLE
            </div>

            <div
                id="fps-badge"
                hidden>
                -- FPS
            </div>

        </div>


        <div
            id="validation"
            class="hint">
            Ready
        </div>


        <aside id="hud-right">

            <div id="vitals-row">

                <div class="vital-card">

                    <div class="vital-label">
                        Heart Rate
                    </div>

                    <div>
                        <span
                            id="readout-pulse"
                            class="vital-number">
                            —
                        </span>

                        <span class="vital-unit">
                            BPM
                        </span>
                    </div>

                </div>


                <div class="vital-card">

                    <div class="vital-label">
                        Breathing
                    </div>

                    <div>
                        <span
                            id="readout-breathing"
                            class="vital-number">
                            —
                        </span>

                        <span class="vital-unit">
                            BR/min
                        </span>
                    </div>

                </div>

            </div>


            <section class="hud-panel">

                <div class="hud-panel-title">
                    <span>Breathing Rate</span>
                    <span class="hud-panel-unit">BR/min</span>
                </div>

                <div class="chart-wrap">
                    <canvas id="chart-breathing-rate"></canvas>
                </div>

            </section>


            <section class="hud-panel">

                <div class="hud-panel-title">
                    <span>Breathing Pleth</span>
                    <span class="hud-panel-unit">WAVEFORM</span>
                </div>

                <div class="chart-wrap">
                    <canvas id="chart-breathing-trace"></canvas>
                </div>

            </section>


            <section class="hud-panel">

                <div class="hud-panel-title">
                    <span>Pulse Rate</span>
                    <span class="hud-panel-unit">BPM</span>
                </div>

                <div class="chart-wrap">
                    <canvas id="chart-pulse-rate"></canvas>
                </div>

            </section>


            <section class="hud-panel">

                <div class="hud-panel-title">
                    <span>Arterial Pressure Trace</span>
                    <span class="hud-panel-unit">RAW</span>
                </div>

                <div class="chart-wrap">
                    <canvas id="chart-arterial-pressure"></canvas>
                </div>

            </section>


            <div id="hud-controls">

                <button
                    id="btn-start"
                    class="hud-button">
                    START
                </button>

                <button
                    id="btn-stop"
                    class="hud-button"
                    disabled>
                    STOP
                </button>

                <button
                    id="btn-reset"
                    class="hud-button">
                    RESET
                </button>

            </div>

        </aside>


        <div
            id="error-banner"
            hidden>

            <strong id="error-code"></strong>

            <span id="error-message"></span>

        </div>
    `;
}


// Build DOM before Chart.js looks for its canvases.
createHud();


// ============================================================
// DOM REFERENCES
// ============================================================

const $ = (id) =>
    document.getElementById(id);


const els = {

    preview:
        $('preview'),

    statusBadge:
        $('status-badge'),

    fpsBadge:
        $('fps-badge'),

    validation:
        $('validation'),

    errorBanner:
        $('error-banner'),

    errorCode:
        $('error-code'),

    errorMessage:
        $('error-message'),

    readoutPulse:
        $('readout-pulse'),

    readoutBreathing:
        $('readout-breathing'),

    btnStart:
        $('btn-start'),

    btnStop:
        $('btn-stop'),

    btnReset:
        $('btn-reset'),
};


// ============================================================
// STATUS LOOKUP TABLES
// ============================================================

const STATUS_NAMES =
    Object.fromEntries(

        Object.entries(ProcessingStatus)
            .map(
                ([key, value]) =>
                    [
                        value,
                        key.replace(/^k/, '')
                    ]
            )
    );


const VALIDATION_NAMES =
    Object.fromEntries(

        Object.entries(ValidationCode)
            .map(
                ([key, value]) =>
                    [
                        value,
                        key.replace(/^k/, '')
                    ]
            )
    );


// ============================================================
// CHARTS
// ============================================================

function makeChart(canvasId, yLabel = '') {

    const canvas =
        document.getElementById(canvasId);

    if (!canvas) {
        throw new Error(
            `HUD canvas not found: ${canvasId}`
        );
    }

    const ctx =
        canvas.getContext('2d');


    return new Chart(ctx, {

        type: 'line',

        data: {

            datasets: [
                {
                    data: [],

                    borderColor:
                        '#65e5dd',

                    backgroundColor:
                        '#65e5dd',

                    borderWidth:
                        1.8,

                    pointRadius:
                        0,

                    tension:
                        0,

                    fill:
                        false,
                }
            ],
        },


        options: {

            animation:
                false,

            parsing:
                false,

            responsive:
                true,

            maintainAspectRatio:
                false,

            normalized:
                true,

            // No hover/tooltip hit-testing on mouse move.
            events:
                [],

            plugins: {

                legend: {
                    display: false
                },

                tooltip: {
                    enabled: false
                },
            },


            scales: {

                x: {

                    type:
                        'linear',

                    display:
                        true,

                    title: {
                        display: false
                    },

                    ticks: {

                        color:
                            'rgba(255,255,255,0.38)',

                        maxTicksLimit:
                            4,

                        font: {
                            size: 9
                        }
                    },

                    grid: {

                        color:
                            'rgba(255,255,255,0.08)'
                    }
                },


                y: {

                    display:
                        true,

                    title: {

                        display:
                            false,

                        text:
                            yLabel
                    },

                    ticks: {

                        color:
                            'rgba(255,255,255,0.38)',

                        maxTicksLimit:
                            4,

                        font: {
                            size: 9
                        }
                    },

                    grid: {

                        color:
                            'rgba(255,255,255,0.08)'
                    }
                }
            }
        }
    });
}


const charts = {

    breathingRate:
        makeChart(
            'chart-breathing-rate',
            'BR/min'
        ),

    breathingTrace:
        makeChart(
            'chart-breathing-trace'
        ),

    pulseRate:
        makeChart(
            'chart-pulse-rate',
            'BPM'
        ),

    arterialPressure:
        makeChart(
            'chart-arterial-pressure'
        ),
};


// ============================================================
// STATE
// ============================================================

let sdk = null;

let activeStream = null;

// Frame fill pipeline feeding the SDK (null when off or unsupported).
let frameFiller = null;

let metricsCount = 0;

let timeOriginUs = null;


// Each buffer holds { t: <µs number>, v: <value> }.
// Timestamps are converted once on arrival, not on every redraw.
const accumulated = {

    breathingRate: [],

    breathingTrace: [],

    pulseRate: [],

    arterialPressure: [],
};


// Charts that have new data waiting to be drawn.
const dirtyCharts = new Set();


// SDK input frame counter (fed by 'frameSentThrough').
let sdkFramesThisWindow = 0;

let sdkFpsWindowStart = 0;

let sdkFpsTimer = null;

// Stall detection: frames were flowing, then stopped
// (usually the camera pipe died mid-session).
let sdkSeenFrames = false;

let sdkZeroWindows = 0;

let stallBannerShown = false;

// Set when the camera track itself ended: that can't recover, so the
// banner stays up even if a few late frames are still counted.
let stallBannerSticky = false;

const STALL_SECONDS = 3;


// ============================================================
// HELPERS
// ============================================================

function tsToNumber(ts) {

    if (ts == null) {
        return 0;
    }

    if (typeof ts === 'number') {
        return ts;
    }

    if (typeof ts === 'bigint') {
        return Number(ts);
    }

    if (
        typeof ts.toNumber === 'function'
    ) {
        return ts.toNumber();
    }

    return Number(ts);
}


function lastValue(array) {

    if (
        !array ||
        array.length === 0
    ) {
        return null;
    }

    return array[
        array.length - 1
    ].value;
}


function clearAccumulated() {

    accumulated.breathingRate.length =
        0;

    accumulated.breathingTrace.length =
        0;

    accumulated.pulseRate.length =
        0;

    accumulated.arterialPressure.length =
        0;
}


function clearCharts() {

    clearAccumulated();

    dirtyCharts.clear();

    for (
        const chart
        of Object.values(charts)
    ) {

        chart.data.datasets[0].data =
            [];

        chart.update('none');
    }

    els.readoutPulse.textContent =
        '—';

    els.readoutBreathing.textContent =
        '—';
}


// ============================================================
// ROLLING HUD CHART BUFFER
// ============================================================
//
// Metrics events only append data (cheap). Drawing happens in
// scheduleCharts(), one chart per slot, so the frame pump never
// waits behind four back-to-back chart redraws.

function appendMeasurements(
    key,
    newMeasurements
) {

    if (
        !newMeasurements ||
        newMeasurements.length === 0
    ) {
        return;
    }

    const buffer =
        accumulated[key];


    for (
        const measurement
        of newMeasurements
    ) {
        buffer.push({
            t: tsToNumber(measurement.timestamp),
            v: measurement.value
        });
    }


    // Prevent unlimited memory growth on the Raspberry Pi.
    // One splice instead of repeated shift() calls.
    const cutoffTimestamp =
        buffer[buffer.length - 1].t -
        (
            CHART_WINDOW_SECONDS *
            1_000_000
        );

    let dropCount = 0;

    while (
        dropCount < buffer.length - 1 &&
        buffer[dropCount].t < cutoffTimestamp
    ) {
        dropCount++;
    }

    if (dropCount > 0) {
        buffer.splice(0, dropCount);
    }


    dirtyCharts.add(key);
}


// Min/max bucket decimation: keeps peaks and troughs visible
// while capping the point count Chart.js has to draw.
function toChartPoints(buffer, t0Us) {

    const n =
        buffer.length;

    const toPoint = (p) => ({
        x: (p.t - t0Us) / 1_000_000,
        y: p.v
    });


    if (n <= MAX_CHART_POINTS) {

        const points =
            new Array(n);

        for (let i = 0; i < n; i++) {
            points[i] = toPoint(buffer[i]);
        }

        return points;
    }


    const bucketCount =
        Math.floor(MAX_CHART_POINTS / 2);

    const bucketSize =
        n / bucketCount;

    const points = [];


    for (let b = 0; b < bucketCount; b++) {

        const start =
            Math.floor(b * bucketSize);

        const end =
            Math.min(n, Math.floor((b + 1) * bucketSize));

        let lo = start;
        let hi = start;

        for (let i = start + 1; i < end; i++) {
            if (buffer[i].v < buffer[lo].v) lo = i;
            if (buffer[i].v > buffer[hi].v) hi = i;
        }

        const first =
            Math.min(lo, hi);

        const second =
            Math.max(lo, hi);

        points.push(toPoint(buffer[first]));

        if (second !== first) {
            points.push(toPoint(buffer[second]));
        }
    }

    return points;
}


function drawChart(key) {

    const chart =
        charts[key];

    chart.data.datasets[0].data =
        toChartPoints(
            accumulated[key],
            timeOriginUs ?? 0
        );

    chart.update('none');
}


// ============================================================
// CHART SCHEDULER
// ============================================================

const CHART_KEYS =
    Object.keys(charts);

const CHART_SLOT_MS =
    1000 / (CHART_REDRAW_HZ * CHART_KEYS.length);

let chartCursor = 0;

let lastChartDrawAt = 0;


function scheduleCharts(now) {

    requestAnimationFrame(scheduleCharts);


    if (
        dirtyCharts.size === 0 ||
        now - lastChartDrawAt < CHART_SLOT_MS
    ) {
        return;
    }


    // Round-robin: draw the next dirty chart only.
    for (let i = 0; i < CHART_KEYS.length; i++) {

        const index =
            (chartCursor + i) % CHART_KEYS.length;

        const key =
            CHART_KEYS[index];

        if (!dirtyCharts.has(key)) {
            continue;
        }

        dirtyCharts.delete(key);

        chartCursor =
            (index + 1) % CHART_KEYS.length;

        lastChartDrawAt =
            now;

        try {
            drawChart(key);
        } catch (error) {
            console.error(
                `[VitaSpectra] chart draw failed (${key})`,
                error
            );
        }

        return;
    }
}


requestAnimationFrame(scheduleCharts);


// ============================================================
// SDK INPUT FPS BADGE
// ============================================================
//
// "30.0 FPS | CAM 22.1 | FILL 27%"
//   FPS   frames that reached the native SDK ('frameSentThrough').
//         This is what the >= 25 fps check cares about.
//   CAM   real frames arriving from the camera (frame fill only).
//   FILL  share of frames sent to the SDK that were repeats.
//
// CAM low         -> the camera/pipe is the bottleneck.
// CAM ok, FPS low -> the app/SDK side is the bottleneck.
//
// Colour: red = FPS below the floor, amber = FILL >= FILL_WARN_PCT.

const FILL_WARN_PCT = 15;

function onSdkFrame() {
    sdkFramesThisWindow++;
}


function updateSdkFpsBadge() {

    const now =
        performance.now();

    const seconds =
        (now - sdkFpsWindowStart) / 1000;

    if (seconds <= 0) {
        return;
    }

    const fps =
        sdkFramesThisWindow / seconds;

    const gotFrames =
        sdkFramesThisWindow > 0;

    sdkFramesThisWindow =
        0;

    sdkFpsWindowStart =
        now;


    if (gotFrames) {

        sdkSeenFrames = true;
        sdkZeroWindows = 0;

        if (stallBannerShown && !stallBannerSticky) {
            stallBannerShown = false;
            els.errorBanner.hidden = true;
        }

    } else if (sdkSeenFrames) {

        sdkZeroWindows++;

        if (
            sdkZeroWindows >= STALL_SECONDS &&
            !stallBannerShown
        ) {
            showCameraLost();
        }
    }


    let text =
        `${fps.toFixed(1)} FPS`;

    let fillPct =
        0;

    if (frameFiller) {

        const stats =
            frameFiller.stats;

        const cameraFps =
            stats.camera / seconds;

        fillPct =
            stats.sent > 0
                ? (100 * stats.repeated) / stats.sent
                : 0;

        stats.camera = 0;
        stats.sent = 0;
        stats.repeated = 0;

        text +=
            ` | CAM ${cameraFps.toFixed(1)} | FILL ${fillPct.toFixed(0)}%`;
    }


    els.fpsBadge.hidden =
        false;

    els.fpsBadge.textContent =
        text;

    els.fpsBadge.className =
        fps < MIN_SDK_FPS
            ? 'fps-low'
            : fillPct >= FILL_WARN_PCT
                ? 'fps-warn'
                : 'fps-ok';
}


function showCameraLost(sticky = false) {

    stallBannerShown = true;

    stallBannerSticky = stallBannerSticky || sticky;

    els.errorBanner.hidden = false;

    els.errorCode.textContent = 'CAMERA: ';

    els.errorMessage.textContent =
        'No frames reaching the SDK. Is the rpicam-vid | ffmpeg pipe ' +
        'still running? Restart the pipe, then restart the app.';
}


function startSdkFpsBadge() {

    stopSdkFpsBadge();

    sdkSeenFrames = false;

    sdkZeroWindows = 0;

    stallBannerShown = false;

    stallBannerSticky = false;

    sdkFramesThisWindow =
        0;

    if (frameFiller) {
        frameFiller.stats.camera = 0;
        frameFiller.stats.sent = 0;
        frameFiller.stats.repeated = 0;
    }

    sdkFpsWindowStart =
        performance.now();

    sdkFpsTimer =
        setInterval(updateSdkFpsBadge, 1000);
}


function stopSdkFpsBadge() {

    if (sdkFpsTimer !== null) {
        clearInterval(sdkFpsTimer);
        sdkFpsTimer = null;
    }

    els.fpsBadge.hidden =
        true;
}


// ============================================================
// HANDLE PRESAGE METRICS
// ============================================================

function handleMetrics(metrics) {

    // HACKATHON DEMO ONLY: see DEMO_PULSE_MULTIPLIER above.
    if (metrics.cardio?.pulseRate?.length) {
        metrics.cardio.pulseRate = metrics.cardio.pulseRate.map(m => ({
            ...m,
            value: m.value * DEMO_PULSE_MULTIPLIER,
        }));
    }

    const firstTimestamp =

        metrics.breathing
            ?.rate
            ?.[0]
            ?.timestamp

        ??

        metrics.breathing
            ?.upperTrace
            ?.[0]
            ?.timestamp

        ??

        metrics.cardio
            ?.pulseRate
            ?.[0]
            ?.timestamp

        ??

        metrics.cardio
            ?.arterialPressureTrace
            ?.[0]
            ?.timestamp;


    if (
        timeOriginUs === null &&
        firstTimestamp != null
    ) {

        timeOriginUs =
            tsToNumber(
                firstTimestamp
            );
    }


    // --------------------------------------------------------
    // GRAPHS (data only; scheduleCharts() does the drawing)
    // --------------------------------------------------------

    appendMeasurements(
        'breathingRate',
        metrics.breathing?.rate
    );

    appendMeasurements(
        'breathingTrace',
        metrics.breathing?.upperTrace
    );

    appendMeasurements(
        'pulseRate',
        metrics.cardio?.pulseRate
    );

    appendMeasurements(
        'arterialPressure',
        metrics.cardio?.arterialPressureTrace
    );


    // --------------------------------------------------------
    // LARGE NUMERIC HUD READOUTS
    // --------------------------------------------------------

    const breathingRate =
        lastValue(
            metrics.breathing?.rate
        );


    if (
        breathingRate != null &&
        Number.isFinite(breathingRate)
    ) {

        els.readoutBreathing
            .textContent =
                breathingRate
                    .toFixed(0);
    }


    const pulseRate =
        lastValue(
            metrics.cardio?.pulseRate
        );


    if (
        pulseRate != null &&
        Number.isFinite(pulseRate)
    ) {

        // Presage exposes this as pulseRate.
        // We display the live numeric value as HEART RATE
        // on the HUD and retain Pulse Rate as the graph name.

        els.readoutPulse
            .textContent =
                pulseRate
                    .toFixed(0);
    }
}


// ============================================================
// BUILD PRESAGE SDK
// ============================================================

function buildSdk() {

    const requestedMetrics = [

        ...breathingMetrics,

        ...cardioMetrics
    ];


    console.log(
        '[VitaSpectra] requestedMetrics:',
        requestedMetrics
    );


    sdk =
        new SmartSpectraSDK({

            apiKey:
                API_KEY,

            requestedMetrics,

            enableAccumulatedOutput:
                false,
        });


    // --------------------------------------------------------
    // PROCESSING STATUS
    // --------------------------------------------------------

    sdk.on(
        'processingStatus',

        (status) => {

            const label =

                STATUS_NAMES[status]

                ||

                `Status(${status})`;


            console.log(
                `[VitaSpectra] processing status -> ${label}`
            );


            els.statusBadge
                .textContent =
                    label;


            els.statusBadge
                .className =

                `status status-${label.toLowerCase()}`;


            if (
                status ===
                ProcessingStatus.kStarting
            ) {

                els.btnStart.disabled =
                    true;

                els.btnStop.disabled =
                    false;

                els.btnReset.disabled =
                    true;
            }


            else if (
                status ===
                ProcessingStatus.kRunning
            ) {

                els.btnStart.disabled =
                    true;

                els.btnStop.disabled =
                    false;

                els.btnReset.disabled =
                    true;
            }


            else if (
                status ===
                ProcessingStatus.kStopping
            ) {

                els.btnStart.disabled =
                    true;

                els.btnStop.disabled =
                    true;

                els.btnReset.disabled =
                    true;
            }


            else if (
                status ===
                ProcessingStatus.kError
            ) {

                els.btnStart.disabled =
                    true;

                els.btnStop.disabled =
                    true;

                els.btnReset.disabled =
                    false;
            }


            else if (

                status ===
                ProcessingStatus.kIdle

                ||

                status ===
                ProcessingStatus.kUninitialized
            ) {

                els.btnStart.disabled =
                    false;

                els.btnStop.disabled =
                    true;

                els.btnReset.disabled =
                    false;
            }
        }
    );


    // --------------------------------------------------------
    // CAMERA / SUBJECT VALIDATION STATUS
    // --------------------------------------------------------

    sdk.on(

        'validationStatus',

        (
            code,
            timestampUs,
            hint
        ) => {

            const name =

                VALIDATION_NAMES[code]

                ||

                `Code(${code})`;


            console.log(
                `[VitaSpectra] validation: ${name}`,
                hint || ''
            );


            els.validation
                .textContent =

                `${name}${hint ? ' — ' + hint : ''}`;


            els.validation
                .className =

                'hint ' +

                (
                    code ===
                    ValidationCode.kOk

                        ? 'hint-ok'

                    :

                    code ===
                    ValidationCode.kCameraTuning

                        ? 'hint-warn'

                        : 'hint-err'
                );
        }
    );


    // --------------------------------------------------------
    // LIVE METRICS
    // --------------------------------------------------------

    sdk.on(

        'metrics',

        (
            buffer,
            timestampUs
        ) => {

            metricsCount++;


            try {

                const decoded =
                    decodeMetrics(
                        buffer
                    );


                if (DEBUG_LOG_METRICS) {
                    console.log(
                        'Metrics:',
                        decoded
                    );
                }


                handleMetrics(
                    decoded
                );

            }

            catch (error) {

                console.error(
                    `[VitaSpectra] failed to decode metrics #${metricsCount}`,
                    error
                );
            }
        }
    );


    // --------------------------------------------------------
    // FRAMES REACHING THE SDK (drives the FPS badge)
    // --------------------------------------------------------

    sdk.on(
        'frameSentThrough',
        onSdkFrame
    );


    // --------------------------------------------------------
    // PRESAGE ERROR
    // --------------------------------------------------------

    sdk.on(

        'error',

        (
            code,
            message,
            retryable
        ) => {

            console.error(
                `[VitaSpectra] Presage error ${code}:`,
                message
            );


            els.errorBanner.hidden =
                false;


            els.errorCode.textContent =
                `${code}: `;


            els.errorMessage.textContent =

                retryable

                ? `${message} (retryable)`

                : message;
        }
    );


    // --------------------------------------------------------
    // STREAM AVAILABLE
    // --------------------------------------------------------

}


// ============================================================
// OPEN CAMERA
// ============================================================
//
// "Requested device not found" means Chromium's OWN camera list is
// empty, even if /dev/video10 exists. With v4l2loopback
// exclusive_caps=1 the device only counts as a camera while the
// rpicam-vid | ffmpeg pipe is writing to it, and Chromium can hold on
// to the camera list it saw at launch. So: pipe first, app second.
//
// This picks the loopback device by its card_label when it can,
// falls back to looser requests, and logs what Chromium sees.

const CAMERA_LABEL_HINT = /picam|loopback|dummy/i;


async function openCamera() {

    let cameras = [];

    try {
        const devices =
            await navigator.mediaDevices.enumerateDevices();

        cameras =
            devices.filter(d => d.kind === 'videoinput');
    } catch (error) {
        console.warn('[VitaSpectra] enumerateDevices failed:', error);
    }


    console.log(
        '[VitaSpectra] cameras Chromium can see:',
        cameras.length === 0
            ? '(none)'
            : cameras.map(c => c.label || '(no label yet)')
    );


    if (cameras.length === 0) {

        const error = new Error(
            'Chromium sees no cameras. Check v4l2loopback was loaded with ' +
            'exclusive_caps=1 and the rpicam-vid | ffmpeg pipe is running, ' +
            'then fully restart the app. The terminal running npm start ' +
            'prints what is wrong.'
        );

        error.code = 'NO_CAMERA';

        throw error;
    }


    const preferred =
        cameras.find(c => CAMERA_LABEL_HINT.test(c.label)) ??
        cameras[0];

    // deviceId is '' until camera permission has been granted once.
    const byId =
        preferred.deviceId
            ? { deviceId: { exact: preferred.deviceId } }
            : {};


    const attempts = [
        {
            name: 'preferred camera, 640x480 @ 30',
            constraints: {
                ...CAMERA_CONSTRAINTS,
                video: { ...CAMERA_CONSTRAINTS.video, ...byId }
            }
        },
        {
            name: 'preferred camera, any format',
            constraints: { video: { ...byId }, audio: false }
        },
        {
            name: 'any camera',
            constraints: { video: true, audio: false }
        },
    ];


    let lastError = null;

    for (const attempt of attempts) {

        try {
            const stream =
                await navigator.mediaDevices.getUserMedia(
                    attempt.constraints
                );

            const track =
                stream.getVideoTracks()[0];

            console.log(
                `[VitaSpectra] camera opened (${attempt.name}):`,
                track?.label,
                track?.getSettings?.()
            );

            return stream;

        } catch (error) {

            lastError = error;

            console.warn(
                `[VitaSpectra] getUserMedia failed (${attempt.name}):`,
                error.name,
                error.message
            );

            // Permission and busy-device errors won't be fixed by
            // loosening constraints.
            if (
                error.name === 'NotAllowedError' ||
                error.name === 'NotReadableError'
            ) {
                break;
            }
        }
    }


    throw lastError;
}


// ============================================================
// FRAME FILL
// ============================================================
//
// Fallback for when the camera delivers fewer than 30 fps.
//
//   camera track
//     -> copy each frame, release the camera buffer immediately
//     -> fixed 30 fps time grid (one slot every 33.3 ms)
//     -> MediaStreamTrackGenerator
//     -> SDK
//
// Each slot carries the newest real frame captured before it. If no new
// frame arrived in time, the previous one is sent again (sample and hold).
// Timestamps stay on the camera's own clock, so time is not stretched and
// heart rate is not skewed. A steady 30 fps camera passes through 1:1.
//
// Repeated frames carry no new information: the higher FILL % on the
// badge, the noisier the readings. Fixing the camera rate is the real fix.

function frameFillSupported() {
    return (
        typeof window.MediaStreamTrackGenerator === 'function' &&
        typeof window.VideoFrame === 'function'
    );
}


let copyFrameWarned = false;

// Copies pixels into our own memory so the camera's capture buffer goes
// straight back to Chromium. Chromium only has a few per camera, and
// holding them makes it drop frames at the source.
async function copyFrame(frame) {

    if (frame.format) {
        try {
            const rect =
                frame.visibleRect;

            const data =
                new Uint8Array(frame.allocationSize());

            const layout =
                await frame.copyTo(data);

            return new VideoFrame(data, {
                format: frame.format,
                codedWidth: rect.width,
                codedHeight: rect.height,
                displayWidth: frame.displayWidth,
                displayHeight: frame.displayHeight,
                timestamp: frame.timestamp,
                layout,
                colorSpace: frame.colorSpace?.toJSON?.(),
            });
        } catch (error) {
            if (!copyFrameWarned) {
                copyFrameWarned = true;
                console.warn(
                    '[VitaSpectra] frame copy failed, sharing camera buffers instead:',
                    error
                );
            }
        }
    }

    // Shares the camera buffer. Works, just holds it a little longer.
    return new VideoFrame(frame);
}


function startFrameFiller(cameraTrack) {

    const slotUs =
        1_000_000 / FRAME_FILL_FPS;

    const maxGapUs =
        FRAME_FILL_MAX_GAP_MS * 1000;


    // Own clone so the preview <video> keeps the original track.
    const sourceTrack =
        cameraTrack.clone();

    const reader =
        new MediaStreamTrackProcessor({
            track: sourceTrack,
            maxBufferSize: MSTP_BUFFER_FRAMES,
        }).readable.getReader();

    const generator =
        new MediaStreamTrackGenerator({ kind: 'video' });

    const writer =
        generator.writable.getWriter();


    // Per-badge-window counters, reset by the badge every second.
    const stats = {
        camera: 0,
        sent: 0,
        repeated: 0,
    };

    let running = true;

    let held = null;          // newest real frame, waiting for its slot
    let heldTs = 0;
    let heldSent = false;
    let nextSlotUs = 0;


    async function sendHeld(timestampUs) {

        const out =
            new VideoFrame(held, {
                timestamp: Math.round(timestampUs),
            });

        try {
            await writer.write(out);

            stats.sent++;

            if (heldSent) {
                stats.repeated++;
            }

            heldSent = true;

        } finally {
            try { out.close(); } catch { /* consumed by the writer */ }
        }
    }


    async function accept(frame) {

        const ts =
            frame.timestamp;


        if (held === null) {
            held = frame;
            heldTs = ts;
            heldSent = false;

            // Slots sit half a period after the camera's rhythm, so normal
            // capture jitter never pushes a frame across a slot edge.
            nextSlotUs = ts + slotUs / 2;
            return;
        }


        // Out-of-order or repeated camera timestamp: ignore it.
        if (ts <= heldTs) {
            frame.close();
            return;
        }


        if (ts - heldTs > maxGapUs) {

            // Real stall (pipe hiccup or died and came back): send what we
            // have once, then restart the grid at the new frame. The SDK
            // sees the gap instead of a frozen image.
            await sendHeld(nextSlotUs);

            nextSlotUs = ts + slotUs / 2;

        } else {

            // Fill every slot that closed before this frame was captured.
            while (nextSlotUs < ts) {
                await sendHeld(nextSlotUs);
                nextSlotUs += slotUs;
            }
        }


        held.close();

        held = frame;
        heldTs = ts;
        heldSent = false;
    }


    const done = (async () => {

        try {
            while (running) {

                const { value, done: ended } =
                    await reader.read();

                if (ended) break;
                if (!value) continue;

                let frame;

                try {
                    frame = await copyFrame(value);
                } finally {
                    value.close();
                }

                if (!running) {
                    frame.close();
                    break;
                }

                stats.camera++;

                await accept(frame);
            }
        } catch (error) {
            if (running) {
                console.error('[VitaSpectra] frame fill stopped:', error);
            }
        } finally {
            if (held) {
                try { held.close(); } catch { /* already closed */ }
                held = null;
            }
        }
    })();


    function stop() {

        if (!running) return;

        running = false;

        reader.cancel().catch(() => {});

        try { sourceTrack.stop(); } catch { /* already stopped */ }

        writer.close().catch(() => {});

        try { generator.stop(); } catch { /* already stopped */ }
    }


    return {
        stream: new MediaStream([generator]),
        stats,
        stop,
        done,
    };
}


function stopFrameFiller() {

    if (frameFiller) {
        frameFiller.stop();
        frameFiller = null;
    }

    sdkReadsFiller = false;
}


// ============================================================
// START MEASUREMENT
// ============================================================

async function startMeasurement() {

    els.btnStart.disabled =
        true;


    els.errorBanner.hidden =
        true;


    metricsCount =
        0;


    timeOriginUs =
        null;


    clearCharts();


    try {

        if (!sdk) {

            buildSdk();
        }


        // Get camera stream.
        //
        // No facingMode is forced here so that Ubuntu / Raspberry Pi
        // can use whichever camera is exposed as the system's
        // default capture device.

        const stream =
            await openCamera();

        // Fires if the device goes away underneath us (not on our own
        // track.stop(), which never fires 'ended').
        const videoTrack =
            stream.getVideoTracks()[0];

        if (
            videoTrack &&
            typeof videoTrack.addEventListener === 'function'
        ) {
            videoTrack.addEventListener(
                'ended',
                () => {
                    if (activeStream === stream) {
                        showCameraLost(true);
                    }
                }
            );
        }

        activeStream =
            stream;


        // Display camera as the full-screen HUD background.

        els.preview.srcObject =
            stream;


        await els.preview
            .play()
            .catch(
                () => {}
            );


        // Feed Presage: through the frame filler when available,
        // otherwise the camera stream directly.

        let sdkStream =
            stream;

        stopFrameFiller();

        if (FRAME_FILL) {

            if (frameFillSupported()) {

                frameFiller =
                    startFrameFiller(stream.getVideoTracks()[0]);

                sdkStream =
                    frameFiller.stream;

                sdkReadsFiller =
                    true;

                console.log(
                    `[VitaSpectra] frame fill on: SDK gets a steady ${FRAME_FILL_FPS} fps`
                );

            } else {

                console.warn(
                    '[VitaSpectra] frame fill unavailable ' +
                    '(no MediaStreamTrackGenerator); SDK reads the camera directly.'
                );
            }
        }


        sdk.useMediaStream(
            sdkStream
        );


        // Begin Presage processing.

        try {
            await sdk.start();
        } finally {
            // Only the SDK's processor (created inside start()) should get
            // the larger queue.
            sdkReadsFiller = false;
        }

        startSdkFpsBadge();

    }

    catch (error) {

        console.error(
            '[VitaSpectra] start failed:',
            error
        );


        // Release everything so the next START begins clean.
        stopFrameFiller();

        if (activeStream) {
            activeStream
                .getTracks()
                .forEach(track => track.stop());

            activeStream = null;

            els.preview.srcObject = null;
        }


        els.errorBanner.hidden =
            false;


        els.errorCode.textContent =

            // DOMExceptions carry a legacy numeric .code (e.g. 8 for
            // NotFoundError); the name is what's actually readable.
            `${error instanceof DOMException ? error.name : (error.code ?? 'JS')}: `;


        els.errorMessage.textContent =

            error.message
            ??
            String(error);


        els.btnStart.disabled =
            false;
    }
}


// ============================================================
// STOP
// ============================================================

async function stopMeasurement() {

    els.btnStop.disabled = true;

    stopSdkFpsBadge();

    try {
        if (sdk) {
            await sdk.stop();
            sdk.destroy();
            sdk = null;
        }
    } catch (error) {
        console.error(
            '[VitaSpectra] stop failed:',
            error
        );
    }

    stopFrameFiller();

    if (activeStream) {
        activeStream
            .getTracks()
            .forEach(track => track.stop());
    }

    activeStream = null;
    els.preview.srcObject = null;

    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
    els.btnReset.disabled = false;
}

// ============================================================
// RESET
// ============================================================

async function resetSession() {

    els.btnReset.disabled =
        true;


    stopSdkFpsBadge();


    try {

        if (sdk) {

            try {

                await sdk.reset();

            }

            catch {

                // reset may not be valid in every state.
            }
        }


        stopFrameFiller();


        if (activeStream) {

            try {

                activeStream
                    .getTracks()
                    .forEach(
                        track =>
                            track.stop()
                    );

            }

            catch {}

        }


        activeStream =
            null;


        els.preview.srcObject =
            null;


        clearCharts();


        els.errorBanner.hidden =
            true;


        els.validation.textContent =
            'Ready';


        els.validation.className =
            'hint';


        if (sdk) {

            try {

                sdk.destroy();

            }

            catch {}


            sdk =
                null;
        }


        els.statusBadge.textContent =
            'IDLE';


        els.statusBadge.className =
            'status';


        els.btnStart.disabled =
            false;


        els.btnStop.disabled =
            true;


        els.btnReset.disabled =
            false;

    }

    catch (error) {

        console.error(
            '[VitaSpectra] reset failed:',
            error
        );


        els.btnReset.disabled =
            false;
    }
}


// ============================================================
// BUTTONS
// ============================================================

els.btnStart.addEventListener(
    'click',
    startMeasurement
);


els.btnStop.addEventListener(
    'click',
    stopMeasurement
);


els.btnReset.addEventListener(
    'click',
    resetSession
);


// ============================================================
// CLEAN SHUTDOWN
// ============================================================

window.addEventListener(

    'beforeunload',

    () => {

        try {
            stopFrameFiller();
        } catch {}


        if (activeStream) {

            try {

                activeStream
                    .getTracks()
                    .forEach(
                        track =>
                            track.stop()
                    );

            }

            catch {}
        }


        if (sdk) {

            try {

                sdk.destroy();

            }

            catch {}
        }
    }
);


// ============================================================
// OPTIONAL AUTO START
// ============================================================

if (AUTO_START) {

    setTimeout(
        () => {

            startMeasurement();

        },
        500
    );
}
