// ==============================================================
// Floating Expression — Breathing
//
// Turns a pace into an idle motion for the sprite: it swells as
// it takes a breath, lifts with the swell, and settles back. The
// renderer decides what the offset means in CSS.
//
// Two things keep it from reading as a mechanical pulse. The
// swell is not symmetric — breathing in takes less of the cycle
// than breathing out — and the curve flattens at both ends, so
// the sprite dwells at the top and the bottom of a breath instead
// of turning on the spot. On top of that the depth drifts slowly
// and each breath runs a little longer or shorter than the last,
// so the rhythm never falls into an exact loop.
// ==============================================================

/** Share of the cycle spent breathing in. Exhaling takes the rest. */
const INHALE_SHARE = 0.42;
/** Depth-drift cycles per breath. Not a whole number, so the drift
 *  never lines up with the rhythm it is varying. */
const DRIFT_RATE = 0.37;
/** How much of the Variation setting the depth drift uses. */
const DRIFT_SHARE = 0.3;
/** How far each breath may run long or short, as a share of Variation. */
const PERIOD_JITTER = 0.25;
/** Longest frame the loop will believe in, in ms. A backgrounded tab stops
 *  delivering frames, and the breath should carry on rather than jump. */
const MAX_FRAME_MS = 200;

/** Reads the tuning values, supplied by the caller on start. */
let readParams = () => ({});
/** Hands the offset to the renderer, once per animation frame. */
let emitFrame = () => {};

let running = false;
let rafId = null;
let lastFrameTime = 0;
/** Position within the current breath, 0 to 1. */
let phase = 0;
/** Breaths taken since the loop started, kept fractional. */
let cycles = 0;
/** How much longer or shorter the current breath runs than the setting says. */
let jitter = 1;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function smoothstep(x) {
    return x * x * (3 - 2 * x);
}

/**
 * Shape of one breath.
 * @param {number} phase Position within the breath, 0 to 1
 * @returns {number} 0 at rest, 1 at the top of the inhale
 */
function breathWave(phase) {
    if (phase < INHALE_SHARE) return smoothstep(phase / INHALE_SHARE);
    return 1 - smoothstep((phase - INHALE_SHARE) / (1 - INHALE_SHARE));
}

/**
 * How deep the breath is running right now, as a multiplier around 1.
 * Drifts slowly, so the breaths are not all the same size.
 * @param {number} cycles Breaths taken, kept fractional
 * @param {number} variation 0 keeps every breath equal
 * @returns {number}
 */
function depthDrift(cycles, variation) {
    return 1 + variation * DRIFT_SHARE * Math.sin(2 * Math.PI * DRIFT_RATE * cycles);
}

/**
 * The offset the sprite should carry at a point in the breath.
 *
 * The scale stays at or above 1 on purpose: shrinking below the size the
 * sprite was given would open a gap along the edge, since fullscreen scales
 * the image to cover the viewport.
 *
 * @param {number} phase Position within the breath, 0 to 1
 * @param {number} cycles Breaths taken, kept fractional
 * @param {{depth: number, rise: number, variation: number}} params
 * @returns {{scale: number, rise: number}} Scale multiplier, and the lift as a
 *   percent of the sprite for a negative CSS translate
 */
export function breathOffset(phase, cycles, params) {
    const wave = breathWave(phase) * depthDrift(cycles, clamp(params.variation, 0, 1));
    return {
        scale: 1 + (Math.max(0, params.depth) / 100) * wave,
        rise: -Math.max(0, params.rise) * wave,
    };
}

/** Length of one breath as the setting asks for it, in ms. */
function basePeriod(params) {
    return 60000 / clamp(params.rate, 1, 60);
}

/** How much longer or shorter the next breath runs than the setting says. */
function nextJitter(params) {
    return 1 + (Math.random() * 2 - 1) * clamp(params.variation, 0, 1) * PERIOD_JITTER;
}

function step(now) {
    rafId = null;

    const params = readParams();
    const delta = lastFrameTime ? Math.min(MAX_FRAME_MS, now - lastFrameTime) : 0;
    lastFrameTime = now;

    // Read the pace per frame rather than per breath, so dragging the slider
    // is felt right away instead of at the end of the breath in progress.
    const advance = delta / (basePeriod(params) * jitter);
    phase += advance;
    cycles += advance;

    if (phase >= 1) {
        phase %= 1;
        jitter = nextJitter(params);
    }

    emitFrame();
    rafId = requestAnimationFrame(step);
}

// =============================================================
//  Lifecycle
// =============================================================

/**
 * @param {object} options
 * @param {() => object} options.params Reads the current tuning values
 * @param {() => void} options.onFrame Called once per animation frame, and once
 *   more on stop so the renderer can drop the offset
 */
export function startBreathing({ params, onFrame }) {
    if (running) stopBreathing();

    readParams = params;
    emitFrame = onFrame;
    running = true;
    phase = 0;
    cycles = 0;
    jitter = nextJitter(readParams());
    lastFrameTime = 0;

    // A breath starts at rest, so the sprite does not jump when the effect is
    // switched on or when a different sprite is put in its place.
    emitFrame();
    rafId = requestAnimationFrame(step);
}

export function stopBreathing() {
    if (!running) return;

    running = false;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    lastFrameTime = 0;

    // Hand the sprite back to the other effects, without the breath.
    emitFrame();
}

/** @returns {boolean} Whether the loop is running */
export function isBreathingRunning() {
    return running;
}

/**
 * @returns {{scale: number, rise: number}|null} The offset to apply now, null
 *   while stopped
 */
export function getBreathingOffset() {
    if (!running) return null;
    return breathOffset(phase, cycles, readParams());
}
