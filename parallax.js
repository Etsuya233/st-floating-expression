// ==============================================================
// Floating Expression — Motion Parallax
//
// Turns the device's motion sensors or the mouse pointer into a
// normalised tilt in [-1, 1] per axis. The renderer decides what
// that tilt means in CSS.
//
// The accelerometer only sees two degrees of freedom: leaning the
// device left or right, and tipping it forwards or backwards.
// Rotation about the gravity axis (turning the device to face left
// or right) is invisible to it, so the gyroscope is layered on top
// as a decaying impulse.
// ==============================================================

/** Frame time the smoothing factors are calibrated against, in ms. */
const FRAME_MS = 16.7;
/** Below this the animation has settled and the loop stops. */
const EPSILON = 0.002;
/** Impulse follow speed. Snappier than the accelerometer signal. */
const IMPULSE_SMOOTHING = 0.35;
/** Rotation rate, in degrees per second, that asks for a full impulse. */
const IMPULSE_RATE_SCALE = 400;
/** Device tilt, from the neutral pose, that saturates the effect. */
const TILT_RANGE_MARGIN = 1;
/** Gravity component at which the device counts as lying flat. */
const FLAT_GRAVITY = 0.94;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Reads the tuning values, supplied by the caller on start. */
let readParams = () => ({});
/** Hands the damped tilt to the renderer, once per animation frame. */
let emitFrame = () => {};

let running = false;
/** 'motion' | 'pointer' while running, null otherwise. */
let resolvedSource = null;
/** 'unknown' | 'granted' | 'denied' */
let permission = 'unknown';

/** Device-frame gravity of the neutral pose, captured on the first reading. */
let neutral = null;
/** Device-frame gravity of the most recent reading. */
let latest = null;
/** Whether an orientation reading has arrived since the last start. */
let sawSensorData = false;

/** Target tilt in [-1, 1] per axis, before the impulse, scaled by intensity. */
const raw = { x: 0, y: 0 };
const impulse = { x: 0, y: 0 };
const impulseTarget = { x: 0, y: 0 };
/** Damped output handed to the renderer. */
const tilt = { x: 0, y: 0 };
/** Fades the effect out while the device lies nearly flat. */
let flatWeight = 1;

let rafId = null;
let lastFrameTime = 0;

const toRad = deg => deg * Math.PI / 180;
const toDeg = rad => rad * 180 / Math.PI;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// =============================================================
//  Capability
// =============================================================

function deviceOrientationAvailable() {
    return typeof window.DeviceOrientationEvent !== 'undefined';
}

function permissionRequired() {
    return deviceOrientationAvailable()
        && typeof window.DeviceOrientationEvent.requestPermission === 'function';
}

/**
 * @param {'auto'|'motion'|'pointer'} source
 * @returns {'motion'|'pointer'} The source that will actually be used
 */
export function resolveSource(source) {
    if (source === 'motion' || source === 'pointer') return source;
    return window.matchMedia('(pointer: coarse)').matches ? 'motion' : 'pointer';
}

/**
 * @returns {{running: boolean, source: string|null, permission: string,
 *   supported: boolean, secure: boolean, needsPermission: boolean,
 *   hasSensorData: boolean, flatPose: boolean, reducedMotion: boolean}}
 */
export function getParallaxStatus() {
    return {
        running,
        source: resolvedSource,
        permission,
        supported: deviceOrientationAvailable(),
        secure: window.isSecureContext,
        needsPermission: permissionRequired(),
        hasSensorData: sawSensorData,
        flatPose: flatWeight < 0.5,
        reducedMotion: reducedMotion.matches,
    };
}

/**
 * @returns {{x: number, y: number}|null} Damped tilt, null while stopped
 */
export function getParallaxTilt() {
    if (!running) return null;
    return { x: tilt.x, y: tilt.y };
}

/**
 * Asks the browser for sensor access. Must be called from a user
 * gesture on browsers that gate the sensors behind a permission
 * prompt.
 * @returns {Promise<'granted'|'denied'|'unsupported'|'insecure'>}
 */
export async function requestMotionAccess() {
    if (!deviceOrientationAvailable()) return 'unsupported';
    if (!window.isSecureContext) return 'insecure';

    if (typeof window.DeviceOrientationEvent.requestPermission !== 'function') {
        // Browsers without the permission API deliver the events straight away.
        permission = 'granted';
        return 'granted';
    }

    const requests = [window.DeviceOrientationEvent.requestPermission()];
    if (typeof window.DeviceMotionEvent !== 'undefined'
        && typeof window.DeviceMotionEvent.requestPermission === 'function') {
        // The same dialog covers both, so ask for the gyroscope upfront.
        requests.push(window.DeviceMotionEvent.requestPermission());
    }

    const [orientation] = await Promise.allSettled(requests);
    permission = orientation.status === 'fulfilled' && orientation.value === 'granted'
        ? 'granted'
        : 'denied';
    return permission;
}

// =============================================================
//  Sensor Sampling
// =============================================================

function screenOrientationAngle() {
    if (typeof screen !== 'undefined' && screen.orientation
        && typeof screen.orientation.angle === 'number') {
        return screen.orientation.angle;
    }
    return window.orientation || 0;
}

/**
 * Rotates a vector from the device frame into the screen frame, so
 * the readings follow the displayed UI instead of the hardware.
 * @param {{x: number, y: number}} vector
 * @param {number} angle Screen orientation angle, in degrees
 */
function toScreenAxis(vector, angle) {
    const cos = Math.cos(toRad(angle));
    const sin = Math.sin(toRad(angle));
    return {
        x: vector.x * cos - vector.y * sin,
        y: vector.x * sin + vector.y * cos,
    };
}

/**
 * Direction of gravity in the device frame. The device reaches the
 * world through Rz(alpha) Rx(beta) Ry(gamma), and world gravity is
 * (0, 0, -1) with Z pointing up, so the device-frame vector is that
 * rotation transposed.
 * @param {DeviceOrientationEvent} event
 * @returns {{x: number, y: number, z: number}}
 */
function gravityInDevice(event) {
    const beta = toRad(event.beta || 0);
    const gamma = toRad(event.gamma || 0);
    return {
        x: Math.cos(beta) * Math.sin(gamma),
        y: -Math.sin(beta),
        z: -Math.cos(beta) * Math.cos(gamma),
    };
}

/**
 * Maps a device tilt, in degrees, onto [-1, 1] with a dead zone
 * around the neutral pose and a saturation distance.
 * @param {number} degrees
 * @param {object} params
 * @returns {number}
 */
function normalizeTilt(degrees, params) {
    const magnitude = Math.max(0, Math.abs(degrees) - params.deadzone);
    const range = Math.max(TILT_RANGE_MARGIN, params.inputRange - params.deadzone);
    return Math.sign(degrees) * Math.min(1, magnitude / range);
}

function onDeviceOrientation(event) {
    if (event.beta === null || event.gamma === null) return;
    applyGravity(gravityInDevice(event));
    requestTick();
}

/**
 * Turns a device-frame gravity reading into the normalised target tilt.
 * @param {{x: number, y: number, z: number}} gravity
 */
function applyGravity(gravity) {
    if (!neutral) neutral = gravity;
    latest = gravity;
    sawSensorData = true;

    const angle = screenOrientationAngle();
    const lean = toScreenAxis(gravity, angle);
    const neutralLean = toScreenAxis(neutral, angle);

    // asin() converts a change in the gravity direction into an angle,
    // which keeps the settings expressed in plain degrees of tilt.
    const leanDegrees = toDeg(Math.asin(clamp(lean.x - neutralLean.x, -1, 1)));
    const pitchDegrees = toDeg(Math.asin(clamp(gravity.z - neutral.z, -1, 1)));

    const params = readParams();
    raw.x = normalizeTilt(leanDegrees, params) * params.intensity;
    raw.y = normalizeTilt(pitchDegrees, params) * params.intensity;

    // Close to horizontal the lean reading loses its direction, so the
    // whole effect fades out over the last stretch before flat.
    flatWeight = clamp((1 - Math.abs(gravity.z)) / (1 - FLAT_GRAVITY), 0, 1);
}

function onDeviceMotion(event) {
    const params = readParams();
    const rate = event.rotationRate;

    if (!params.inertia || !rate
        || rate.alpha === null || rate.beta === null || rate.gamma === null) {
        impulseTarget.x = 0;
        impulseTarget.y = 0;
        requestTick();
        return;
    }

    // rotationRate is in the device frame: beta about X, gamma about Y,
    // alpha about Z. The rates about the screen's own axes are what the
    // renderer can use.
    const screen = toScreenAxis({ x: rate.beta || 0, y: rate.gamma || 0 }, screenOrientationAngle());

    impulseTarget.x = clamp(screen.y / IMPULSE_RATE_SCALE, -1, 1) * params.inertia * params.intensity;
    impulseTarget.y = clamp(screen.x / IMPULSE_RATE_SCALE, -1, 1) * params.inertia * params.intensity;
    requestTick();
}

function onPointerMove(event) {
    if (event.pointerType !== 'mouse') return;

    const params = readParams();
    raw.x = clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1) * params.intensity;
    raw.y = clamp((event.clientY / window.innerHeight) * 2 - 1, -1, 1) * params.intensity;
    requestTick();
}

function onPointerLeave() {
    raw.x = 0;
    raw.y = 0;
    requestTick();
}

// =============================================================
//  Animation Loop
// =============================================================

/** The tilt the sampler is steering towards right now. */
function desired() {
    return {
        x: clamp(raw.x + impulse.x, -2, 2) * flatWeight,
        y: clamp(raw.y + impulse.y, -2, 2) * flatWeight,
    };
}

function requestTick() {
    if (rafId !== null || !running) return;

    // A device that is resting still keeps emitting readings. Leave the
    // loop parked while the output already matches them.
    const want = desired();
    if (Math.abs(want.x - tilt.x) < EPSILON && Math.abs(want.y - tilt.y) < EPSILON
        && Math.abs(impulseTarget.x - impulse.x) < EPSILON
        && Math.abs(impulseTarget.y - impulse.y) < EPSILON) {
        return;
    }

    lastFrameTime = 0;
    rafId = requestAnimationFrame(step);
}

function step(now) {
    rafId = null;

    const delta = lastFrameTime ? Math.min(64, now - lastFrameTime) : FRAME_MS;
    lastFrameTime = now;
    const params = readParams();

    // Both factors are expressed per 16.7 ms, then scaled to the real
    // frame time so the feel does not change with the refresh rate.
    const follow = 1 - Math.pow(1 - clamp(params.smoothing, 0.01, 0.9), delta / FRAME_MS);
    const impulseFollow = 1 - Math.pow(1 - IMPULSE_SMOOTHING, delta / FRAME_MS);

    impulse.x += (impulseTarget.x - impulse.x) * impulseFollow;
    impulse.y += (impulseTarget.y - impulse.y) * impulseFollow;

    const want = desired();
    tilt.x += (want.x - tilt.x) * follow;
    tilt.y += (want.y - tilt.y) * follow;

    emitFrame(tilt);

    const settled = Math.abs(want.x - tilt.x) < EPSILON
        && Math.abs(want.y - tilt.y) < EPSILON
        && Math.abs(impulseTarget.x - impulse.x) < EPSILON
        && Math.abs(impulseTarget.y - impulse.y) < EPSILON;

    if (!settled) {
        rafId = requestAnimationFrame(step);
    }
}

// =============================================================
//  Lifecycle
// =============================================================

/**
 * @param {object} options
 * @param {() => object} options.params Reads the current tuning values
 * @param {'auto'|'motion'|'pointer'} options.source
 * @param {(tilt: {x: number, y: number}) => void} options.onFrame
 * @returns {boolean} Whether the sampler started
 */
export function startParallax({ params, source, onFrame }) {
    stopParallax();

    readParams = params;
    emitFrame = onFrame;

    const wanted = resolveSource(source);
    if (wanted === 'motion') {
        if (!deviceOrientationAvailable() || !window.isSecureContext) return false;
        if (permissionRequired() && permission !== 'granted') return false;
        window.addEventListener('deviceorientation', onDeviceOrientation);
        window.addEventListener('devicemotion', onDeviceMotion);
    } else {
        document.addEventListener('pointermove', onPointerMove);
        document.documentElement.addEventListener('pointerleave', onPointerLeave);
    }

    resolvedSource = wanted;
    running = true;
    neutral = null;
    latest = null;
    sawSensorData = false;
    raw.x = raw.y = 0;
    impulse.x = impulse.y = impulseTarget.x = impulseTarget.y = 0;
    tilt.x = tilt.y = 0;
    flatWeight = 1;

    emitFrame(tilt);
    return true;
}

/** Re-reads the neutral pose from the current orientation. */
export function recenterParallax() {
    if (!running || !latest) return;
    neutral = latest;
    applyGravity(latest);
    requestTick();
}

export function stopParallax() {
    if (!running) return;

    running = false;
    window.removeEventListener('deviceorientation', onDeviceOrientation);
    window.removeEventListener('devicemotion', onDeviceMotion);
    document.removeEventListener('pointermove', onPointerMove);
    document.documentElement.removeEventListener('pointerleave', onPointerLeave);

    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    lastFrameTime = 0;

    resolvedSource = null;
    neutral = null;
    latest = null;
    sawSensorData = false;
    raw.x = raw.y = 0;
    impulse.x = impulse.y = impulseTarget.x = impulseTarget.y = 0;
    tilt.x = tilt.y = 0;
    flatWeight = 1;

    emitFrame(tilt);
}
