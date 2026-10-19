# Floating Expression

A [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension that detects expression labels in chat messages and renders matching sprite images in a configurable floating container.

## Features

- **Expression Detection** — Supports two detection modes:
  - **Regex Pattern** — Customizable regex with capture group (default: `[expression：label]`)
  - **HTML Tag** — Detects `<expression>label</expression>` style tags
- **Three Display Modes**
  - **Window** — Draggable floating window with adjustable size, background, opacity, and z-index
  - **Fullscreen** — Full-viewport background layer behind or above the chat
  - **Custom** — User-defined HTML template + CSS with `{{imageSrc}}` and `{{label}}` variables
- **Manual Placement** — In fullscreen mode, pick the **Manual** image fit to set the sprite's scale, offset and rotation. Adjust it with the settings sliders or drag it directly on screen
- **Motion Parallax** — In fullscreen mode, slides and tilts the sprite with the device's motion sensors, or with the mouse pointer when there is no sensor to read. Carrying the device to one side pushes the sprite the other way with the inertia of a hanging weight, and every movement glides on for a moment before it settles, before easing back to centre once the device is held still
- **Breathing** — An idle breath for the sprite, in Window and Fullscreen mode: a pace, a swell depth, a lift and how much each breath differs from the last
- **Sensor Permission Prompt** — Asks for the sensor permission through a clickable notification when a chat is opened, so the settings panel does not have to be opened first
- **Sprite Resolution** — Automatically matches expression labels to character sprite images with exact and prefix-based fuzzy matching
- **Crossfade Animation** — Smooth transitions between expression changes
- **Click-to-Toggle Opacity** — Click the window to toggle between normal and reduced opacity
- **Mobile Support** — Responsive layout with touch drag support, handles SillyTavern's mobile CSS transform quirks
- **Tag Hiding** — Copy a generated regex to use with SillyTavern's Regex extension for hiding expression tags from displayed messages
- **Fallback Expression** — Configurable fallback when detection fails

## Installation

1. Open SillyTavern and go to **Extensions** → **Install Extension**
2. Paste the repository URL:
   ```
   https://github.com/Etsuya233/st-floating-expression
   ```
3. Click **Install** and reload the page

## Usage

1. Enable the extension in **Extensions** → **Floating Expression**
2. Make sure your character has **sprite images** set up (via the Sprites / Expression Images feature)
3. Configure your AI's system prompt or jailbreak to include expression labels in its responses, for example:
   ```
   [expression：joy]
   ```
4. The matching sprite will appear in the floating container

### Manual Placement (Fullscreen)

1. Set **Display Mode** to Fullscreen and **Image Fit** to **Manual (size / position / rotation)**
2. Either drag the sliders in the settings panel, or click **Adjust on screen** and work directly on the sprite:
   - drag inside the dashed frame to move it
   - drag a corner handle to scale it
   - drag the round handle above the frame to rotate it
3. Click **Done** or press **Esc** to finish. SillyTavern's side panels are hidden while adjusting and come back afterwards.

### Motion Parallax (Fullscreen)

The sprite can slide and lean a little as you move, which reads as a shallow
3D effect on top of the flat sprite image. The slide carries the movement: the
whole image travels across the screen, and the lean rides on top of it as a
small tilt. The movement also has weight, because the sprite is dragged along
by a spring rather than pinned to the reading — it sets off a touch late,
coasts on after the device stops, and settles instead of stopping dead.

1. Set **Display Mode** to Fullscreen
2. Tick **Motion parallax**
3. Grant the sensor access when the page asks for it. The extension offers it
   as a clickable notification each time a chat is opened, and **Grant access**
   in this panel does the same thing. Then hold the device the way you normally
   would and tap **Recenter** to set that pose as the neutral one

**Input source** — `Auto` uses the sensors on touch devices and the mouse
pointer on desktop, where there is no gyroscope to read. The pointer source
follows the mouse across the viewport and ignores touch input, so scrolling
the chat does not shake the sprite.

**Requirements** — Browsers only expose the sensors in a secure context, so
the page has to be served over HTTPS (or opened on `localhost`). SillyTavern
can do this with `ssl.enabled` in `config.yaml`, or by running behind a
reverse proxy. iOS Safari also asks for permission once per page load: the
extension offers it as a clickable notification when a chat is opened, because
the click is the gesture the browser wants before it shows its dialog. The
**Grant access** button in the panel is there for a second try, and the panel
reports which of these is blocking the effect.

**Carrying the device** — The sprite hangs on the screen like a weight. Moving
the phone to one side leaves the sprite behind, and it swings back once the
phone stops. A gentle move is worth about half the slide, and a firm one
reaches the whole of it. It works with the device held at any angle, lying flat
on a table included, and it needs `Device motion`, the same permission the rest
of the effect uses. The mouse has no such dimension: the pointer source maps
its position, so the sprite simply goes where the cursor goes.

**What the effect can and cannot do** — The sprite is a single flat image, so
the effect moves and tilts that one image; it is not the part-by-part parallax
of a Live2D model. The accelerometer sees two degrees of freedom: leaning the
device left and right, and tipping it forwards and backwards. A turn about the
vertical axis is invisible to it, which is where **Gyroscope Inertia** comes
in: it adds a short kick while the device is turning fast and decays back.
Carrying the device across a plane is a third kind of motion, read from the
linear acceleration rather than from gravity.

**Recentring** — On by default. Once the posture has been steady for
`Stillness Delay`, that posture becomes the new centre and the sprite eases
back to the middle instead of staying parked where your hand stopped.
`Return Time` is the time constant of that return, and `Stillness Threshold`
is how far the device may drift before it counts as movement again, which is
also what keeps sensor noise from resetting the timer. Turn the option off if
you want to hold a lean indefinitely. Recentring only applies to the sensor
source; the pointer source maps the absolute mouse position, so it stays put.

**Tuning** — `Intensity`, `Max Drift`, `Max Rotation` and `Glide` cover most
of it. `Max Drift` is how far the image slides, as a percent of the viewport,
and `Max Rotation` is how far it leans while it slides. `Glide` is the
inertia: the sprite gathers speed behind the device, carries on after it
stops, and coasts a little past the target. The glide is a share of the slide,
so a longer `Max Drift` is what makes it read on screen; at 8 percent the
sprite is a little over halfway when the hand stops, and covers the rest in
about a tenth of a second.

The advanced block holds the saturation distance (`Full Effect At`), the
`Dead Zone` around the neutral pose, `Smoothing`, the `Perspective` distance,
`Zoom Compensation`, axis inversion and the swap. `Smoothing` sets how closely
the sprite tracks the device: lower values trail further behind and therefore
glide longer. `Zoom Compensation` is the margin that keeps the slide from
uncovering an edge, and it has to grow with `Max Drift` and `Intensity`. If
the sprite leans the wrong way for the way you hold the device, the two invert
checkboxes fix that without any other change. The tilt fades out on its own
while the device lies nearly flat, where the lean reading loses its
direction. **Reset Parallax Settings** at the top of the panel puts every
parallax value back to its default after a confirmation.

### Breathing

A slow idle motion, available in both Window and Fullscreen mode: the sprite
swells as it takes a breath, lifts a little on the way in, and settles back.
Nothing about it follows the chat, so it keeps moving while the model is quiet.

1. Tick **Breathing**
2. Set **Pace** (breaths per minute — 12 is a calm resting rate), **Depth** (how
   much the sprite swells, as a percent of its size) and **Rise** (how far it
   lifts, as a percent of its height)

**The shape of a breath** — breathing in takes less of the cycle than breathing
out, and the curve flattens as it reaches each end, so the sprite dwells at the
top and at the bottom of a breath instead of turning on the spot. The swell only
ever grows the sprite: shrinking it below the size it was given would open a gap
along the edge in fullscreen, where the image is scaled to cover the viewport.

**Variation** — at 0 every breath is identical and the rhythm is metronomic.
Raise it and each breath runs a little longer or shorter than the last while the
swell wanders slowly between deep and shallow, so the motion never falls into an
exact loop. The defaults are gentle on purpose: an idle breath reads as alive
while it is barely noticeable.

**When it runs** — only while a sprite is actually on screen, so nothing is
animated behind a hidden sprite. It pauses while the on-screen placement editor
is open, since the editor measures the sprite as you placed it, and it does not
apply in Custom HTML mode, where the sprite image is replaced by your own
template. Like the motion parallax, the system's reduce-motion preference holds
it back; the checkbox below the sliders is there if you want it anyway.

### Hiding Expression Tags

To hide expression tags from the displayed message:

1. Click **Copy Regex for Hiding Tags** button in the extension settings
2. Go to **Extensions** → **Regex** and create a new script
3. Paste the copied regex as the **Find Regex**
4. Leave **Replace With** empty
5. Enable **AI Output** placement

## Reasoning Text

Models that emit chain-of-thought often mention the tag while thinking
("按照要求生成`<expression>`标签…"). Detection collects every tag in the
message and ranks the candidates:

1. a tag whose content is single-line and markup-free beats a loose one
2. **the tag that appears later wins** — reasoning comes first, the answer last
3. **shorter content wins** — a match that spilled across lines swallowed body prose

Multi-line tags (`<expression>\nhappy\n</expression>`) still match, because
the whitespace around the label is ignored.

## Tests

Detection and the breathing engine have dependency-free regression suites:

```
node test-detection.mjs
node test-breathing.mjs
```

## Requirements

- SillyTavern 1.12.0+
- Character sprite images configured

## License

MIT
