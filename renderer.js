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
// CONFIGURATION
// ============================================================

// IMPORTANT:
// Paste your Presage API key here.
const API_KEY = 'u0QefZqGuP4Si0eC9SPth6vbO8RWEvJj33mgqQ3m';

// Set true once camera permissions are working reliably.
// false = press START manually.
const AUTO_START = false;

// Amount of history visible on HUD charts.
const CHART_WINDOW_SECONDS = 30;

// Camera settings.
// Keep 640x480 initially because Presage processing matters
// more than display resolution.
const CAMERA_CONSTRAINTS = {
    video: {
        frameRate: {
            ideal: 30,
            min: 25
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
            align-items: center;
            gap: 18px;

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

let metricsCount = 0;

let timeOriginUs = null;


const accumulated = {

    breathingRate: [],

    breathingTrace: [],

    pulseRate: [],

    arterialPressure: [],
};


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

function appendAndRedraw(
    buffer,
    chart,
    newMeasurements,
    t0Us
) {

    if (
        !newMeasurements ||
        newMeasurements.length === 0
    ) {
        return;
    }


    for (
        const measurement
        of newMeasurements
    ) {
        buffer.push(measurement);
    }


    // Latest timestamp received.
    const latestTimestamp =
        tsToNumber(
            buffer[
                buffer.length - 1
            ].timestamp
        );


    // Prevent unlimited memory growth on the Raspberry Pi.
    const cutoffTimestamp =
        latestTimestamp -
        (
            CHART_WINDOW_SECONDS *
            1_000_000
        );


    while (
        buffer.length > 1 &&
        tsToNumber(
            buffer[0].timestamp
        ) < cutoffTimestamp
    ) {

        buffer.shift();
    }


    const points =
        new Array(
            buffer.length
        );


    for (
        let i = 0;
        i < buffer.length;
        i++
    ) {

        const measurement =
            buffer[i];


        points[i] = {

            x:
                (
                    tsToNumber(
                        measurement.timestamp
                    ) -
                    t0Us
                ) /
                1_000_000,

            y:
                measurement.value
        };
    }


    chart.data.datasets[0].data =
        points;

    chart.update('none');
}


// ============================================================
// HANDLE PRESAGE METRICS
// ============================================================

function handleMetrics(metrics) {

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


    const t0 =
        timeOriginUs ?? 0;


    // --------------------------------------------------------
    // GRAPHS
    // --------------------------------------------------------

    appendAndRedraw(

        accumulated.breathingRate,

        charts.breathingRate,

        metrics.breathing?.rate,

        t0
    );


    appendAndRedraw(

        accumulated.breathingTrace,

        charts.breathingTrace,

        metrics.breathing?.upperTrace,

        t0
    );


    appendAndRedraw(

        accumulated.pulseRate,

        charts.pulseRate,

        metrics.cardio?.pulseRate,

        t0
    );


    appendAndRedraw(

        accumulated.arterialPressure,

        charts.arterialPressure,

        metrics.cardio
            ?.arterialPressureTrace,

        t0
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


                // Keep this log while developing.
                // Remove it later on the Raspberry Pi if desired.
                console.log(
                    'Metrics:',
                    decoded
                );


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

            await navigator.mediaDevices
                .getUserMedia(
                    CAMERA_CONSTRAINTS
                );


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


        // Feed the same stream to Presage.

        sdk.useMediaStream(
            stream
        );


        // Begin Presage processing.

        await sdk.start();

    }

    catch (error) {

        console.error(
            '[VitaSpectra] start failed:',
            error
        );


        els.errorBanner.hidden =
            false;


        els.errorCode.textContent =

            `${error.code ?? 'JS'}: `;


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


    try {

        if (sdk) {

            try {

                await sdk.reset();

            }

            catch {

                // reset may not be valid in every state.
            }
        }


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