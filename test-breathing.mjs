// Regression suite for the breathing engine. Dependency-free, like the
// detection suite. The module animates through requestAnimationFrame, which
// Node does not have, so the test lends it a queue it can step by hand and a
// run of frames plays out exactly, at 60 fps.
import {
    breathOffset,
    getBreathingOffset,
    startBreathing,
    stopBreathing,
} from './breathing.js';

let pass = 0, fail = 0;
function ok(name, condition, detail = '') {
    condition ? pass++ : fail++;
    console.log(`${condition ? '  ok  ' : ' FAIL '} ${name}${detail ? `\n         ${detail}` : ''}`);
}
function near(a, b, tolerance = 1e-9) {
    return Math.abs(a - b) <= tolerance;
}

const PARAMS = { rate: 12, depth: 2, rise: 1, variation: 0 };

console.log('── Curve ──');

const sweep = [];
for (let i = 0; i <= 1000; i++) sweep.push(breathOffset(i / 1000, 0, PARAMS));
const scales = sweep.map(s => s.scale);
const rises = sweep.map(s => s.rise);

ok('starts and ends at rest', near(scales[0], 1) && near(rises[0], 0) && near(scales[1000], 1) && near(rises[1000], 0));
ok('tops out at the depth setting', near(Math.max(...scales), 1 + PARAMS.depth / 100, 1e-6),
    `peak=${Math.max(...scales)}`);
ok('lifts by the rise setting, upwards', near(Math.min(...rises), -PARAMS.rise, 1e-6),
    `lift=${Math.min(...rises)}%`);
ok('never shrinks below the size the sprite was given', Math.min(...scales) >= 1 && Math.max(...rises) <= 0,
    `min scale=${Math.min(...scales)}`);

const flat = { ...PARAMS, depth: 0, rise: 0 };
const flatSample = breathOffset(0.42, 3.7, flat);
ok('a depth and rise of zero leave the sprite alone', flatSample.scale === 1 && flatSample.rise === 0);

// A breath has to be asymmetric, or it reads as a pulse rather than breathing.
const topAt = scales.indexOf(Math.max(...scales)) / 1000;
ok('breathes in faster than it breathes out', near(topAt, 0.42, 0.002), `top of the inhale at ${topAt}`);

console.log('\n── Continuity ──');

// Walk three breaths and watch the step between frames. The wave and the
// depth drift both have to stay continuous across the wrap out of a breath,
// which is where a jump would show as a twitch on screen.
const loose = { ...PARAMS, variation: 1 };
const period = 60000 / PARAMS.rate;
let phase = 0, cycles = 0, previous = null, largestStep = 0;
for (let frame = 0; frame < 180; frame++) {
    const advance = (1000 / 60) / period;
    phase += advance;
    cycles += advance;
    if (phase >= 1) phase %= 1;

    const { scale } = breathOffset(phase, cycles, loose);
    if (previous !== null) largestStep = Math.max(largestStep, Math.abs(scale - previous));
    previous = scale;
}
// The steepest stretch of the curve moves the swell by about 1.2% of the
// depth per frame, so anything past a twentieth of the depth is a jump.
ok('no jump between one breath and the next', largestStep < PARAMS.depth / 100 * 0.05,
    `largest frame step=${largestStep.toExponential(2)}`);

console.log('\n── Variation ──');

const equal = { ...PARAMS, variation: 0 };
const first = breathOffset(0.42, 0, equal);
const later = breathOffset(0.42, 7.3, equal);
ok('a variation of 0 keeps every breath identical', first.scale === later.scale && first.rise === later.rise);

const wanted = { ...PARAMS, variation: 1 };
const peaks = [];
for (let breath = 0; breath < 40; breath++) peaks.push(breathOffset(0.42, breath, wanted).scale);
const spread = Math.max(...peaks) - Math.min(...peaks);
ok('a variation of 1 lets deep and shallow breaths through', spread > PARAMS.depth / 100 * 0.4,
    `spread=${spread.toFixed(4)}`);

console.log('\n── Loop ──');

let pendingFrame = null;
let clock = 0;
globalThis.requestAnimationFrame = (fn) => { pendingFrame = fn; return 1; };
globalThis.cancelAnimationFrame = () => { pendingFrame = null; };

/** Plays frames at 60 fps for a stretch of wall clock. */
function stepFrames(totalMs) {
    const frame = 1000 / 60;
    for (let elapsed = 0; elapsed < totalMs; elapsed += frame) {
        clock += frame;
        const step = pendingFrame;
        pendingFrame = null;
        if (step) step(clock);
    }
}

let peaksSeen = 0;
let previousScale = 0;
let wasRising = false;

/** Counts the top of every breath the loop hands out. */
function watchPeaks() {
    const offset = getBreathingOffset();
    // The call that closes a stopped loop carries no offset by design.
    if (!offset) return;

    const { scale } = offset;
    if (scale > previousScale) {
        wasRising = true;
    } else if (wasRising && scale < previousScale) {
        peaksSeen++;
        wasRising = false;
    }
    previousScale = scale;
}

/** Runs the loop for a stretch and reports how many breaths it took. */
function breathsOver(params, totalMs) {
    peaksSeen = 0;
    previousScale = 0;
    wasRising = false;
    startBreathing({ params: () => params, onFrame: watchPeaks });
    stepFrames(totalMs);
    stopBreathing();
    return peaksSeen;
}

ok('reports no offset while stopped', getBreathingOffset() === null);
ok('takes a breath every 5s at a pace of 12', breathsOver({ ...PARAMS }, 20000) === 4);
ok('takes a breath every 2s at a pace of 30', breathsOver({ ...PARAMS, rate: 30 }, 6000) === 3);

// The tuning values are read per frame rather than kept from the start, so a
// slider drag is felt at once instead of at the end of the breath in progress.
let lastOffset = null;
const tunable = { ...PARAMS, depth: 2 };
startBreathing({ params: () => tunable, onFrame: () => { lastOffset = getBreathingOffset(); } });
stepFrames(3000);
ok('reads the tuning values every frame', lastOffset.scale > 1.0005, `scale=${lastOffset.scale}`);
tunable.depth = 0;
tunable.rise = 0;
stepFrames(1000 / 60);
ok('drops the swell when the depth and rise go back to zero',
    lastOffset.scale === 1 && lastOffset.rise === 0,
    `scale=${lastOffset.scale} lift=${lastOffset.rise}`);
stopBreathing();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
