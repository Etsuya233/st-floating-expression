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
