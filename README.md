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
- **Motion Parallax** — In fullscreen mode, tilts the sprite with the device's motion sensors, or with the mouse pointer when there is no sensor to read
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

The sprite can lean and drift a little as you move, which reads as a shallow
3D effect on top of the flat sprite image.

1. Set **Display Mode** to Fullscreen
2. Tick **Motion parallax**
3. On a phone, tap **Grant access** if the panel asks for it, then hold the
   device the way you normally would and tap **Recenter** to set that pose as
   the neutral one

**Input source** — `Auto` uses the sensors on touch devices and the mouse
pointer on desktop, where there is no gyroscope to read. The pointer source
follows the mouse across the viewport and ignores touch input, so scrolling
the chat does not shake the sprite.

**Requirements** — Browsers only expose the sensors in a secure context, so
the page has to be served over HTTPS (or opened on `localhost`). SillyTavern
can do this with `ssl.enabled` in `config.yaml`, or by running behind a
reverse proxy. iOS Safari also asks for permission once per page load, which
is what the **Grant access** button is for. The panel reports which of these
is blocking the effect.

**What the effect can and cannot do** — The sprite is a single flat image, so
the effect is a perspective tilt of that image, not the part-by-part parallax
of a Live2D model. The accelerometer sees two degrees of freedom: leaning the
device left and right, and tipping it forwards and backwards. A turn about the
vertical axis is invisible to it, which is where **Gyroscope Inertia** comes
in: it adds a short kick while the device is turning fast and decays back.

**Tuning** — `Intensity`, `Max Rotation` and `Max Drift` cover most of it.
The advanced block holds the saturation distance (`Full Effect At`), the
`Dead Zone` around the neutral pose, `Smoothing`, the `Perspective` distance,
`Zoom Compensation` (which hides the edges the tilt would otherwise open),
axis inversion and the swap. If the sprite leans the wrong way for the way you
hold the device, the two invert checkboxes fix that without any other change.
The tilt fades out on its own while the device lies nearly flat, where the
lean reading loses its direction. **Reset Parallax Settings** at the top of the
panel puts every parallax value back to its default after a confirmation.

### Hiding Expression Tags

To hide expression tags from the displayed message:

1. Click **Copy Regex for Hiding Tags** button in the extension settings
2. Go to **Extensions** → **Regex** and create a new script
3. Paste the copied regex as the **Find Regex**
4. Leave **Replace With** empty
5. Enable **AI Output** placement

## Requirements

- SillyTavern 1.12.0+
- Character sprite images configured

## License

MIT
