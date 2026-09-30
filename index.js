// ==============================================================
// Floating Expression — SillyTavern Extension
//
// Detects expression labels in chat messages (via regex or HTML
// tags) and renders matching sprite images in a configurable
// floating container.
// ==============================================================

import { eventSource, event_types, getRequestHeaders, saveSettingsDebounced } from '../../../../script.js';
import { getContext, extension_settings } from '../../../extensions.js';
import { getCharaFilename } from '../../../utils.js';

// ── Constants ────────────────────────────────────────────────
const EXTENSION_NAME = 'st-floating-expression';
const FOLDER_PATH = `scripts/extensions/third-party/${EXTENSION_NAME}`;

const DEFAULT_SETTINGS = {
    // General
    enabled: true,
    detectionMode: 'regex',
    regexPattern: '\\[expression[：:](.+?)\\]',
    htmlTagName: 'expression',
    hideTag: false,
    streamDetection: true,
    streamDebounceMs: 300,
    fallbackExpression: '',

    // Display mode: 'window' | 'fullscreen' | 'custom'
    displayMode: 'window',

    // Window mode
    window: {
        sizePreset: 'small',   // 'small' | 'medium' | 'large' | 'custom'
        width: 200,
        height: 200,
        objectFit: 'contain',
        bgColor: 'rgba(30,30,30,0.6)',
        opacity: 1,
        clickToggle: true,
        clickOpacity: 0.2,
        zIndex: 9990,
    },

    // Fullscreen mode
    fullscreen: {
        objectFit: 'cover',
        opacity: 0.15,
        zIndex: 0,
        // Only applied while objectFit is 'manual'. Offsets are percentages
        // of the viewport, rendered as vw/vh units.
        transform: {
            scale: 1,
            x: 0,
            y: 0,
            rotation: 0,
        },
    },

    // Custom mode
    customHtml: '',
    customCss: '',
};

const WINDOW_PRESETS = {
    small:  { width: 150, height: 150 },
    medium: { width: 300, height: 300 },
    large:  { width: 500, height: 500 },
};

const DISPLAY_MODES = ['window', 'fullscreen', 'custom'];

// Manual transform limits — shared by the sliders and the on-screen editor.
const TRANSFORM_LIMITS = {
    scale: { min: 0.1, max: 3 },
    x: { min: -100, max: 100 },
    y: { min: -100, max: 100 },
    rotation: { min: -180, max: 180 },
};

// Z-index used while the on-screen editor is open. Must sit above the chat
// (#chat is z-index 30, and being a stacking context it caps everything inside)
// but below SillyTavern's nav panels (z-index 3000+), so the settings panel
// stays clickable underneath the sprite. The editor frame uses the next step
// up from style.css.
const ADJUST_SPRITE_Z_INDEX = 100;

const ADJUST_FRAME_ID = 'fe-adjust-frame';
const ADJUST_TOOLBAR_ID = 'fe-adjust-toolbar';
const ADJUST_HANDLES = ['nw', 'ne', 'sw', 'se'];
// ── State ────────────────────────────────────────────────────
/** @type {Map<string, {label: string, path: string}[]>} */
const spriteCache = new Map();

let currentExpression = null;
let currentImageSrc = '';
let isOpacityToggled = false;
let streamDebounceTimer = null;

/** Active pointer drag on the on-screen editor, or null when idle. */
let adjustState = null;

/** Nav drawers hidden for the duration of an adjust session. */
let hiddenNavPanels = [];

// =============================================================
//  Settings
// =============================================================

/** @returns {typeof DEFAULT_SETTINGS} */
function getSettings() {
    return extension_settings[EXTENSION_NAME];
}

/** Recursively fill in missing keys from defaults. Existing values win. */
function mergeDefaults(target, defaults) {
    for (const [key, value] of Object.entries(defaults)) {
        const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
        if (isObject) {
            if (typeof target[key] !== 'object' || target[key] === null) {
                target[key] = {};
            }
            mergeDefaults(target[key], value);
        } else if (target[key] === undefined) {
            target[key] = value;
        }
    }
}

function initSettings() {
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = {};
    }
    mergeDefaults(extension_settings[EXTENSION_NAME], DEFAULT_SETTINGS);
}

function saveSettings() {
    saveSettingsDebounced();
}

/** Populate UI controls from saved settings */
function loadSettingsUI() {
    const s = getSettings();

    // General
    $('#fe_enabled').prop('checked', s.enabled);
    $('#fe_hide_tag').prop('checked', s.hideTag);
    $('#fe_detection_mode').val(s.detectionMode);
    $('#fe_regex_pattern').val(s.regexPattern);
    $('#fe_html_tag_name').val(s.htmlTagName);
    $('#fe_fallback_expression').val(s.fallbackExpression);
    $('#fe_stream_detection').prop('checked', s.streamDetection);
    $('#fe_stream_debounce_ms').val(s.streamDebounceMs);

    // Display mode
    $('#fe_display_mode').val(s.displayMode);

    // Window
    $('#fe_window_size_preset').val(s.window.sizePreset);
    $('#fe_window_width').val(s.window.width);
    $('#fe_window_height').val(s.window.height);
    $('#fe_window_object_fit').val(s.window.objectFit);
    $('#fe_window_bg_color').val(s.window.bgColor);
    $('#fe_window_opacity').val(s.window.opacity);
    $('#fe_window_click_toggle').prop('checked', s.window.clickToggle);
    $('#fe_window_click_opacity').val(s.window.clickOpacity);
    $('#fe_window_z_index').val(s.window.zIndex);

    // Fullscreen
    $('#fe_fs_object_fit').val(s.fullscreen.objectFit);
    $('#fe_fs_opacity').val(s.fullscreen.opacity);
    $('#fe_fs_z_index').val(s.fullscreen.zIndex);
    syncTransformControls();

    // Custom
    $('#fe_custom_html').val(s.customHtml);
    $('#fe_custom_css').val(s.customCss);

    // Toggle visibility of sections
    toggleDetectionModeUI(s.detectionMode);
    toggleDisplayModeUI(s.displayMode);
    toggleWindowCustomSize(s.window.sizePreset);
    toggleFsManualUI(s.fullscreen.objectFit);
}

function toggleDetectionModeUI(mode) {
    $('#fe_regex_settings').toggle(mode === 'regex');
    $('#fe_html_tag_settings').toggle(mode === 'html_tag');
}

function toggleDisplayModeUI(mode) {
    $('#fe_window_settings').toggle(mode === 'window');
    $('#fe_fullscreen_settings').toggle(mode === 'fullscreen');
    $('#fe_custom_settings').toggle(mode === 'custom');
}

function toggleWindowCustomSize(preset) {
    $('#fe_window_custom_size').toggle(preset === 'custom');
}

function toggleFsManualUI(fit) {
    $('#fe_fs_manual_settings').toggle(fit === 'manual');
}

function bindSettingsListeners() {
    // ── General ──
    $('#fe_enabled').on('change', function () {
        getSettings().enabled = !!$(this).prop('checked');
        saveSettings();
        if (getSettings().enabled) {
            detectAndRenderFromLastMessage();
        } else {
            hideHolder();
        }
    });

    $('#fe_hide_tag').on('change', function () {
        getSettings().hideTag = !!$(this).prop('checked');
        saveSettings();
    });

    $('#fe_detection_mode').on('change', function () {
        const mode = String($(this).val());
        getSettings().detectionMode = mode;
        toggleDetectionModeUI(mode);
        saveSettings();
        detectAndRenderFromLastMessage();
    });

    $('#fe_regex_pattern').on('input', function () {
        getSettings().regexPattern = String($(this).val());
        saveSettings();
    });

    $('#fe_html_tag_name').on('input', function () {
        getSettings().htmlTagName = String($(this).val());
        saveSettings();
    });

    $('#fe_copy_regex').on('click', function () {
        const regex = buildHideTagRegex();
        navigator.clipboard.writeText(regex).then(() => {
            toastr.success('Regex copied to clipboard! Create a new Regex script and paste it.');
        }).catch(() => {
            // Fallback: show in a prompt
            window.prompt('Copy this regex:', regex);
        });
    });

    $('#fe_fallback_expression').on('input', function () {
        getSettings().fallbackExpression = String($(this).val()).trim();
        saveSettings();
    });

    $('#fe_stream_detection').on('change', function () {
        getSettings().streamDetection = !!$(this).prop('checked');
        saveSettings();
    });

    $('#fe_stream_debounce_ms').on('input', function () {
        getSettings().streamDebounceMs = parseInt($(this).val()) || 300;
        saveSettings();
    });

    $('#fe_force_refresh').on('click', function () {
        spriteCache.clear();
        currentExpression = null;
        currentImageSrc = '';
        detectAndRenderFromLastMessage();
    });

    // ── Display mode ──
    $('#fe_display_mode').on('change', function () {
        const mode = String($(this).val());
        getSettings().displayMode = mode;
        toggleDisplayModeUI(mode);
        applyDisplayMode();
        saveSettings();
    });

    // ── Window settings ──
    $('#fe_window_size_preset').on('change', function () {
        const preset = String($(this).val());
        getSettings().window.sizePreset = preset;
        toggleWindowCustomSize(preset);
        applyWindowStyles();
        saveSettings();
    });

    $('#fe_window_width').on('input', function () {
        getSettings().window.width = parseInt($(this).val()) || 200;
        applyWindowStyles();
        saveSettings();
    });

    $('#fe_window_height').on('input', function () {
        getSettings().window.height = parseInt($(this).val()) || 200;
        applyWindowStyles();
        saveSettings();
    });

    $('#fe_window_object_fit').on('change', function () {
        getSettings().window.objectFit = String($(this).val());
        applyWindowStyles();
        saveSettings();
    });

    $('#fe_window_bg_color').on('input', function () {
        getSettings().window.bgColor = String($(this).val());
        applyWindowStyles();
        saveSettings();
    });

    $('#fe_window_opacity').on('input', function () {
        getSettings().window.opacity = parseFloat($(this).val()) || 1;
        isOpacityToggled = false;
        applyWindowStyles();
        saveSettings();
    });

    $('#fe_window_click_toggle').on('change', function () {
        getSettings().window.clickToggle = !!$(this).prop('checked');
        saveSettings();
    });

    $('#fe_window_click_opacity').on('input', function () {
        getSettings().window.clickOpacity = parseFloat($(this).val()) || 0.2;
        saveSettings();
    });

    $('#fe_window_z_index').on('input', function () {
        getSettings().window.zIndex = parseInt($(this).val()) || 9990;
        applyWindowStyles();
        saveSettings();
    });

    // ── Fullscreen settings ──
    $('#fe_fs_object_fit').on('change', function () {
        const fit = String($(this).val());
        getSettings().fullscreen.objectFit = fit;
        toggleFsManualUI(fit);
        if (fit !== 'manual') {
            stopAdjusting();
        }
        applyFullscreenStyles();
        saveSettings();
    });

    $('#fe_fs_opacity').on('input', function () {
        getSettings().fullscreen.opacity = parseFloat($(this).val()) || 0.15;
        applyFullscreenStyles();
        saveSettings();
    });

    $('#fe_fs_z_index').on('input', function () {
        getSettings().fullscreen.zIndex = parseInt($(this).val(), 10) || 0;
        applyFullscreenStyles();
        saveSettings();
    });

    // ── Manual transform (fullscreen) ──
    for (const [selector, key] of [
        ['#fe_fs_scale', 'scale'],
        ['#fe_fs_offset_x', 'x'],
        ['#fe_fs_offset_y', 'y'],
        ['#fe_fs_rotation', 'rotation'],
    ]) {
        $(selector).on('input', function () {
            getSettings().fullscreen.transform[key] = parseFloat($(this).val());
            applyFullscreenStyles();
            updateAdjustFrame();
            updateTransformLabels();
            saveSettings();
        });
    }

    $('#fe_fs_transform_reset').on('click', resetTransform);

    $('#fe_fs_adjust_toggle').on('click', function () {
        if ($(`#${ADJUST_FRAME_ID}`).length) {
            stopAdjusting();
        } else {
            startAdjusting();
        }
    });

    // ── Custom settings ──
    $('#fe_custom_html').on('input', function () {
        getSettings().customHtml = String($(this).val());
        saveSettings();
        renderCurrentExpression();
    });

    $('#fe_custom_css').on('input', function () {
        getSettings().customCss = String($(this).val());
        applyCustomCSS();
        saveSettings();
    });
}

// =============================================================
//  Detection
// =============================================================

/**
 * Detect expression label from message text.
 * @param {string} text  Raw message text (may contain HTML)
 * @returns {string|null} The extracted expression label, or null
 */
function detectExpression(text) {
    if (!text) return null;
    const s = getSettings();

    if (s.detectionMode === 'regex') {
        return detectByRegex(text, s.regexPattern);
    } else {
        return detectByHtmlTag(text, s.htmlTagName);
    }
}

/**
 * @param {string} text
 * @param {string} pattern
 * @returns {string|null}
 */
function detectByRegex(text, pattern) {
    try {
        const regex = new RegExp(pattern, 'is');
        const match = regex.exec(text);
        if (match && match[1]) {
            return match[1].trim().toLowerCase();
        }
    } catch (e) {
        console.warn(`[${EXTENSION_NAME}] Invalid regex pattern:`, pattern, e);
    }
    return null;
}

/**
 * @param {string} text
 * @param {string} tagName
 * @returns {string|null}
 */
function detectByHtmlTag(text, tagName) {
    try {
        const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`<${escapedTag}[^>]*>\\s*(.+?)\\s*</${escapedTag}>`, 'is');
        const match = regex.exec(text);
        if (match && match[1]) {
            return match[1].trim().toLowerCase();
        }
    } catch (e) {
        console.warn(`[${EXTENSION_NAME}] HTML tag detection error:`, e);
    }
    return null;
}

// =============================================================
//  Hide Tag — Regex Helper
// =============================================================

/**
 * Build a regex string for hiding expression tags, based on
 * the current detection mode settings. Users can copy this
 * and create a Regex script manually.
 * @returns {string}
 */
function buildHideTagRegex() {
    const s = getSettings();
    if (s.detectionMode === 'regex') {
        return s.regexPattern;
    } else {
        const escaped = s.htmlTagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return `<${escaped}[^>]*>[\\s\\S]+?<\\/${escaped}>`;
    }
}

// =============================================================
//  Sprite Resolution
// =============================================================

/**
 * Fetch the sprites list for a character folder from the server.
 * @param {string} folderName
 * @returns {Promise<{label: string, path: string}[]>}
 */
async function fetchSpritesList(folderName) {
    if (spriteCache.has(folderName)) {
        return spriteCache.get(folderName);
    }

    try {
        const resp = await fetch(`/api/sprites/get?name=${encodeURIComponent(folderName)}`, {
            headers: getRequestHeaders(),
        });
        if (!resp.ok) {
            console.warn(`[${EXTENSION_NAME}] Sprites fetch failed for "${folderName}":`, resp.status);
            return [];
        }
        const sprites = await resp.json();
        spriteCache.set(folderName, sprites);
        return sprites;
    } catch (e) {
        console.error(`[${EXTENSION_NAME}] Error fetching sprites:`, e);
        return [];
    }
}

/**
 * Resolve the sprite folder name, honoring Character Expressions overrides.
 * @param {object|null} message
 * @returns {string|null}
 */
function resolveSpriteFolderName(message = null) {
    const context = getContext();

    let avatarPath = '';
    if (context.groupId && message) {
        avatarPath = message.original_avatar
            || context.characters.find(c => message.force_avatar && message.force_avatar.includes(encodeURIComponent(c.avatar)))?.avatar
            || '';
    } else {
        avatarPath = getCharaFilename() || '';
    }

    const avatarFileName = avatarPath.replace(/\.[^/.]+$/, '');
    if (!avatarFileName) return null;

    const expressionOverride = extension_settings.expressionOverrides?.find(e => e.name === avatarFileName);
    return expressionOverride?.path || avatarFileName;
}

/**
 * Resolve a sprite image path for the given expression label.
 * @param {string} label
 * @param {object|null} message
 * @returns {Promise<string|null>}
 */
async function resolveSprite(label, message = null) {
    const context = getContext();
    if (context.characterId === undefined && !context.groupId) return null;

    const folderName = resolveSpriteFolderName(message);
    if (!folderName) return null;

    const sprites = await fetchSpritesList(folderName);
    if (!sprites.length) return null;

    // Exact match
    const match = sprites.find(s => s.label === label);
    if (match) return match.path;

    // Prefix match
    const fuzzy = sprites.find(s => s.label.startsWith(label) || label.startsWith(s.label));
    if (fuzzy) return fuzzy.path;

    return null;
}

// =============================================================
//  Rendering
// =============================================================

/** Ensure the floating holder element exists in the DOM */
function ensureHolder() {
    if ($('#floating-expression-holder').length) return;

    const holder = $(`
        <div id="floating-expression-holder" class="fe-hidden">
            <div class="fe-drag-grabber" id="floating-expression-holderheader"></div>
            <img class="fe-sprite" src="" alt="" />
        </div>
    `);

    $('body').append(holder);
    holder.find('img.fe-sprite').on('load', updateAdjustFrame);
    initDrag(holder);
    initClickToggle(holder);
    applyDisplayMode();
    applyDefaultPosition();
}

/** Inject user custom CSS via <style> tag */
function applyCustomCSS() {
    let styleTag = $('#fe-custom-css-tag');
    if (!styleTag.length) {
        styleTag = $('<style id="fe-custom-css-tag"></style>');
        $('head').append(styleTag);
    }
    styleTag.text(getSettings().customCss);
}

/** Apply the correct display mode class + styles */
function applyDisplayMode() {
    const holder = $('#floating-expression-holder');
    if (!holder.length) return;

    const s = getSettings();

    // Remove all mode classes
    for (const m of DISPLAY_MODES) {
        holder.removeClass(`fe-${m}`);
    }
    holder.addClass(`fe-${s.displayMode}`);

    // Reset inline styles that were set by previous mode
    holder.css({
        width: '',
        height: '',
        opacity: '',
        zIndex: '',
        background: '',
    });
    holder.find('img.fe-sprite').css({ 'object-fit': '', transform: '' });

    // Apply mode-specific styles
    switch (s.displayMode) {
        case 'window':
            applyWindowStyles();
            break;
        case 'fullscreen':
            applyFullscreenStyles();
            break;
        case 'custom':
            applyCustomCSS();
            break;
    }

    if (s.displayMode !== 'fullscreen') {
        stopAdjusting();
    }

    isOpacityToggled = false;

    // Reset position for non-fullscreen
    if (s.displayMode !== 'fullscreen') {
        // Clear dragged state so default position kicks in
        holder.removeAttr('data-dragged');
        holder.removeClass('dragged');
        applyDefaultPosition();
    }
}

/** Apply window mode inline styles from settings */
function applyWindowStyles() {
    const holder = $('#floating-expression-holder');
    if (!holder.length) return;

    const w = getSettings().window;

    // Size
    let width, height;
    if (w.sizePreset === 'custom') {
        width = w.width;
        height = w.height;
    } else {
        const preset = WINDOW_PRESETS[w.sizePreset] || WINDOW_PRESETS.small;
        width = preset.width;
        height = preset.height;
    }

    const opacity = isOpacityToggled ? w.clickOpacity : w.opacity;

    holder.css({
        width: width + 'px',
        height: height + 'px',
        background: w.bgColor || 'rgba(30,30,30,0.6)',
        opacity: opacity,
        zIndex: w.zIndex,
    });

    holder.find('img.fe-sprite').css('object-fit', w.objectFit);
}

/** Apply fullscreen mode inline styles from settings */
function applyFullscreenStyles() {
    const holder = $('#floating-expression-holder');
    if (!holder.length) return;

    const fs = getSettings().fullscreen;
    const manual = fs.objectFit === 'manual';
    const adjusting = $(`#${ADJUST_FRAME_ID}`).length > 0;

    holder.css({
        opacity: fs.opacity,
        zIndex: adjusting ? ADJUST_SPRITE_Z_INDEX : fs.zIndex,
    });

    // Manual fit starts from a full-image (contain) base and then applies the
    // user transform on top, so the editor can compute the frame from that box.
    holder.find('img.fe-sprite')
        .css('object-fit', manual ? 'contain' : fs.objectFit)
        .css('transform', manual ? buildTransform(fs.transform) : '');
}

/** @param {{scale: number, x: number, y: number, rotation: number}} t */
function buildTransform(t) {
    return `translate(${t.x}vw, ${t.y}vh) rotate(${t.rotation}deg) scale(${t.scale})`;
}

/** Set a sensible default position for windowed modes */
function applyDefaultPosition() {
    const holder = $('#floating-expression-holder');
    if (!holder.length || holder.hasClass('fe-fullscreen')) return;

    // Only set default position if not already dragged
    if (holder.attr('data-dragged') === 'true') return;

    const margin = 20;
    const w = holder.outerWidth() || 150;
    const left = window.innerWidth - w - margin;
    const top = margin;
    holder.css({ left: left + 'px', top: top + 'px' });
}

/**
 * Custom unified drag handler for both mouse and touch.
 * @param {JQuery} $holder
 */
function initDrag($holder) {
    const el = $holder[0];
    if (!el) return;

    let isDragging = false;
    let startX = 0, startY = 0, origLeft = 0, origTop = 0;

    function startDrag(clientX, clientY) {
        if ($holder.hasClass('fe-fullscreen')) return false;

        isDragging = true;
        startX = clientX;
        startY = clientY;
        origLeft = parseInt($holder.css('left')) || 0;
        origTop = parseInt($holder.css('top')) || 0;
        return true;
    }

    function moveDrag(clientX, clientY) {
        if (!isDragging) return;

        const dx = clientX - startX;
        const dy = clientY - startY;

        let newLeft = origLeft + dx;
        let newTop = origTop + dy;

        const w = $holder.outerWidth() || 0;
        const h = $holder.outerHeight() || 0;
        newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - w));
        newTop = Math.max(0, Math.min(newTop, window.innerHeight - h));

        $holder.css({ left: newLeft + 'px', top: newTop + 'px' });
        $holder.attr('data-dragged', 'true');
        $holder.addClass('dragged');
    }

    function endDrag() {
        isDragging = false;
    }

    // Mouse
    el.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        if (startDrag(e.clientX, e.clientY)) {
            e.preventDefault();
        }
    });
    document.addEventListener('mousemove', function (e) {
        if (!isDragging) return;
        e.preventDefault();
        moveDrag(e.clientX, e.clientY);
    });
    document.addEventListener('mouseup', function () { endDrag(); });

    // Touch
    el.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        if (startDrag(t.clientX, t.clientY)) e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchmove', function (e) {
        if (!isDragging || e.touches.length !== 1) return;
        const t = e.touches[0];
        moveDrag(t.clientX, t.clientY);
        e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchend', function () { endDrag(); });
}

/**
 * Click-to-toggle opacity handler for window mode.
 * @param {JQuery} $holder
 */
function initClickToggle($holder) {
    let dragMoved = false;
    let startPos = { x: 0, y: 0 };
    const DRAG_THRESHOLD = 5; // px — movement below this is a click

    $holder.on('mousedown touchstart', function (e) {
        const pos = e.touches ? e.touches[0] : e;
        startPos = { x: pos.clientX, y: pos.clientY };
        dragMoved = false;
    });

    $holder.on('mousemove touchmove', function (e) {
        if (dragMoved) return;
        const pos = e.touches ? e.touches[0] : e;
        const dist = Math.abs(pos.clientX - startPos.x) + Math.abs(pos.clientY - startPos.y);
        if (dist > DRAG_THRESHOLD) dragMoved = true;
    });

    $holder.on('mouseup touchend', function () {
        if (dragMoved) return; // was a drag, not a click

        const s = getSettings();
        if (s.displayMode !== 'window' || !s.window.clickToggle) return;

        isOpacityToggled = !isOpacityToggled;
        const opacity = isOpacityToggled ? s.window.clickOpacity : s.window.opacity;
        $holder.css('opacity', opacity);
    });
}

function showHolder() {
    $('#floating-expression-holder').removeClass('fe-hidden');
}

function hideHolder() {
    $('#floating-expression-holder').addClass('fe-hidden');
}

/**
 * Set the sprite image with crossfade.
 * @param {string} imageSrc
 */
function setSprite(imageSrc) {
    const holder = $('#floating-expression-holder');
    if (!holder.length) return;

    if (currentImageSrc === imageSrc) return;

    if (getSettings().displayMode === 'custom') {
        renderCustomTemplate(imageSrc, currentExpression);
        currentImageSrc = imageSrc;
        return;
    }

    const img = holder.find('img.fe-sprite').not('.fe-sprite-leaving');

    // Crossfade
    const prevSrc = img.attr('src');
    if (prevSrc && prevSrc !== imageSrc) {
        const clone = img.clone();
        clone.addClass('fe-sprite-leaving').css('opacity', 1);
        holder.append(clone);
        clone.animate({ opacity: 0 }, 250, function () {
            $(this).remove();
        });
    }

    img.attr('src', imageSrc);
    img.attr('alt', currentExpression || '');
    currentImageSrc = imageSrc;
}

/**
 * Render the custom HTML template with variable substitution.
 * @param {string} imageSrc
 * @param {string|null} label
 */
function renderCustomTemplate(imageSrc, label) {
    const holder = $('#floating-expression-holder');
    if (!holder.length) return;

    const template = getSettings().customHtml || '';
    const html = template
        .replace(/\{\{imageSrc\}\}/g, imageSrc)
        .replace(/\{\{label\}\}/g, label || '');

    // Preserve drag grabber, replace custom content
    holder.find('.fe-custom-content').remove();
    holder.find('img.fe-sprite').hide();
    holder.append(`<div class="fe-custom-content">${html}</div>`);

    applyCustomCSS();
}

/** Re-render current expression (used when custom HTML changes) */
function renderCurrentExpression() {
    if (!currentExpression || !currentImageSrc) return;
    if (getSettings().displayMode === 'custom') {
        renderCustomTemplate(currentImageSrc, currentExpression);
    }
}

// =============================================================
//  Fullscreen Manual Transform — On-Screen Editor
// =============================================================

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/** Wrap a rotation into (-180, 180]. */
function normalizeAngle(deg) {
    let a = deg % 360;
    if (a > 180) a -= 360;
    if (a <= -180) a += 360;
    return a;
}

/**
 * The box the sprite occupies before the transform, i.e. the "contain" box of
 * the viewport-sized <img>.
 * @param {HTMLImageElement} img
 * @returns {{width: number, height: number}|null}
 */
function getContainBox(img) {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return null;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (nw / nh > vw / vh) {
        return { width: vw, height: vw * nh / nw };
    }
    return { width: vh * nw / nh, height: vh };
}

/** Center of the transformed sprite, in viewport pixels. */
function getTransformCenter(t) {
    return {
        x: window.innerWidth * (0.5 + t.x / 100),
        y: window.innerHeight * (0.5 + t.y / 100),
    };
}

/** Push the saved transform values into the panel controls. */
function syncTransformControls() {
    const t = getSettings().fullscreen.transform;
    $('#fe_fs_scale').val(t.scale);
    $('#fe_fs_offset_x').val(t.x);
    $('#fe_fs_offset_y').val(t.y);
    $('#fe_fs_rotation').val(t.rotation);
    updateTransformLabels();
}

function updateTransformLabels() {
    const t = getSettings().fullscreen.transform;
    $('#fe_fs_scale_value').text(`${t.scale.toFixed(2)}×`);
    $('#fe_fs_offset_x_value').text(`${Math.round(t.x)}vw`);
    $('#fe_fs_offset_y_value').text(`${Math.round(t.y)}vh`);
    $('#fe_fs_rotation_value').text(`${Math.round(t.rotation)}°`);
}

function startAdjusting() {
    if ($(`#${ADJUST_FRAME_ID}`).length) return;

    const img = $('#floating-expression-holder img.fe-sprite')[0];
    if (!img || !getContainBox(img)) {
        toastr.warning('No sprite loaded yet. Send a message containing an expression first.');
        return;
    }

    const frame = $(`<div id="${ADJUST_FRAME_ID}"></div>`);
    for (const corner of ADJUST_HANDLES) {
        frame.append(`<span class="fe-adjust-handle" data-handle="${corner}"></span>`);
    }
    frame.append('<span class="fe-adjust-handle fe-adjust-rotate" data-handle="rotate"></span>');
    $('body').append(frame);
    bindAdjustFrame(frame);

    // Own toolbar, pinned above everything: the settings panel can end up
    // underneath the sprite while adjusting, which would hide its buttons.
    const toolbar = $(`
        <div id="${ADJUST_TOOLBAR_ID}">
            <div class="fe-adjust-action fe-adjust-done"><i class="fa-solid fa-check"></i><span>Done</span></div>
            <div class="fe-adjust-action fe-adjust-reset"><i class="fa-solid fa-rotate-left"></i><span>Reset</span></div>
            <span class="fe-adjust-hint">Esc to finish</span>
        </div>
    `);
    toolbar.find('.fe-adjust-done').on('click', stopAdjusting);
    toolbar.find('.fe-adjust-reset').on('click', resetTransform);
    $('body').append(toolbar);

    applyFullscreenStyles();   // raise the sprite above the chat while adjusting
    updateAdjustFrame();
    hideNavPanels();

    $('#fe_fs_adjust_toggle').addClass('fe-active');
    $('#fe_fs_adjust_toggle span').text('Done');
}

function stopAdjusting() {
    const frame = $(`#${ADJUST_FRAME_ID}`);
    if (!frame.length) return;

    frame.remove();
    $(`#${ADJUST_TOOLBAR_ID}`).remove();
    adjustState = null;
    restoreNavPanels();

    // Restore the configured z-index. Other display modes style themselves in
    // applyDisplayMode(), which is where this gets called from on a mode switch.
    if (getSettings().displayMode === 'fullscreen') {
        applyFullscreenStyles();
    }

    $('#fe_fs_adjust_toggle').removeClass('fe-active');
    $('#fe_fs_adjust_toggle span').text('Adjust on screen');
}

/** Put the transform back to its identity values. */
function resetTransform() {
    Object.assign(getSettings().fullscreen.transform, { scale: 1, x: 0, y: 0, rotation: 0 });
    applyFullscreenStyles();
    updateAdjustFrame();
    syncTransformControls();
    saveSettings();
}

/**
 * SillyTavern's nav panels are stacked above the sprite, so an open Extensions
 * panel covers the very thing being aligned. Hide whatever is open for the
 * duration of the session.
 *
 * The panels also get marked as pinned while hidden: SillyTavern autocloses
 * non-pinned drawers on any click that lands outside them, which would let the
 * canvas clicks drop the panel for good instead of restoring it on exit.
 */
function hideNavPanels() {
    hiddenNavPanels = $('.drawer-content.openDrawer').toArray().map(panel => ({
        panel,
        display: panel.style.display,
        pinned: panel.classList.contains('pinnedOpen'),
    }));

    for (const { panel } of hiddenNavPanels) {
        panel.classList.add('pinnedOpen');
        panel.style.display = 'none';
    }
}

function restoreNavPanels() {
    for (const { panel, display, pinned } of hiddenNavPanels) {
        panel.style.display = display;
        if (!pinned) {
            panel.classList.remove('pinnedOpen');
        }
    }
    hiddenNavPanels = [];
}

/**
 * Keep the editor frame in sync with the rendered sprite. The frame bakes the
 * scale into its own size, so its children (the handles) keep a constant
 * on-screen size.
 */
function updateAdjustFrame() {
    const frame = document.getElementById(ADJUST_FRAME_ID);
    if (!frame) return;

    const img = document.querySelector('#floating-expression-holder img.fe-sprite');
    const box = img && getContainBox(img);
    if (!box) {
        stopAdjusting();
        return;
    }

    const t = getSettings().fullscreen.transform;
    const width = box.width * t.scale;
    const height = box.height * t.scale;

    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    frame.style.left = `${(window.innerWidth - width) / 2}px`;
    frame.style.top = `${(window.innerHeight - height) / 2}px`;
    frame.style.transform = `translate(${t.x}vw, ${t.y}vh) rotate(${t.rotation}deg)`;
}

function bindAdjustFrame(frame) {
    frame.on('pointerdown', function (e) {
        const handle = $(e.target).data('handle');
        const mode = handle === 'rotate' ? 'rotate' : handle ? 'scale' : 'move';

        const t = getSettings().fullscreen.transform;
        const center = getTransformCenter(t);
        const dist = Math.hypot(e.clientX - center.x, e.clientY - center.y);
        if (mode === 'scale' && dist < 1) return;

        adjustState = {
            mode,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startDist: dist,
            startAngle: Math.atan2(e.clientY - center.y, e.clientX - center.x) * 180 / Math.PI,
            startTransform: { ...t },
            center,
        };

        e.target.setPointerCapture?.(e.pointerId);
        e.preventDefault();
    });

    frame.on('pointermove', function (e) {
        if (!adjustState || e.pointerId !== adjustState.pointerId) return;
        applyAdjustDrag(e);
        e.preventDefault();
    });

    frame.on('pointerup pointercancel', function (e) {
        if (!adjustState || e.pointerId !== adjustState.pointerId) return;
        adjustState = null;
        e.target.releasePointerCapture?.(e.pointerId);
    });
}

/**
 * Translate a pointer position into scale / offset / rotation. Scale and
 * rotation only depend on the distance and angle from the frame center, which
 * the rotation itself does not move.
 */
function applyAdjustDrag(e) {
    const t = getSettings().fullscreen.transform;
    const start = adjustState.startTransform;

    if (adjustState.mode === 'move') {
        t.x = clamp(start.x + (e.clientX - adjustState.startX) / window.innerWidth * 100,
            TRANSFORM_LIMITS.x.min, TRANSFORM_LIMITS.x.max);
        t.y = clamp(start.y + (e.clientY - adjustState.startY) / window.innerHeight * 100,
            TRANSFORM_LIMITS.y.min, TRANSFORM_LIMITS.y.max);
    } else if (adjustState.mode === 'scale') {
        const dist = Math.hypot(e.clientX - adjustState.center.x, e.clientY - adjustState.center.y);
        t.scale = clamp(start.scale * dist / adjustState.startDist,
            TRANSFORM_LIMITS.scale.min, TRANSFORM_LIMITS.scale.max);
    } else {
        const angle = Math.atan2(e.clientY - adjustState.center.y, e.clientX - adjustState.center.x) * 180 / Math.PI;
        t.rotation = normalizeAngle(start.rotation + angle - adjustState.startAngle);
    }

    applyFullscreenStyles();
    updateAdjustFrame();
    syncTransformControls();
    saveSettings();
}

// =============================================================
//  Message Processing
// =============================================================

/**
 * Core pipeline: detect expression → resolve sprite → render.
 * @param {string} text Message text
 * @param {object|null} message
 */
async function processMessage(text, message = null) {
    const s = getSettings();
    if (!s.enabled) return;

    let label = detectExpression(text);

    // Fallback
    if (!label && s.fallbackExpression) {
        label = s.fallbackExpression.trim().toLowerCase();
    }

    if (!label) {
        hideHolder();
        currentExpression = null;
        currentImageSrc = '';
        return;
    }

    const imageSrc = await resolveSprite(label, message);
    if (!imageSrc) {
        // Try fallback if detected label didn't match
        if (label !== s.fallbackExpression && s.fallbackExpression) {
            const fallbackSrc = await resolveSprite(s.fallbackExpression.trim().toLowerCase(), message);
            if (fallbackSrc) {
                currentExpression = s.fallbackExpression;
                ensureHolder();
                setSprite(fallbackSrc);
                showHolder();
                return;
            }
        }
        hideHolder();
        return;
    }

    currentExpression = label;
    ensureHolder();
    setSprite(imageSrc);
    showHolder();
}

/** Get the last non-user message text and process it */
function detectAndRenderFromLastMessage() {
    const context = getContext();
    if (!context.chat || !context.chat.length) {
        hideHolder();
        return;
    }

    const lastMsg = context.chat.slice().reverse().find(m =>
        !m.is_user && !m.is_system
    );

    if (!lastMsg) {
        hideHolder();
        return;
    }

    processMessage(lastMsg.mes || '', lastMsg);
}



// =============================================================
//  Event Handlers
// =============================================================

function onMessageReceived(messageId) {
    if (!getSettings().enabled) return;

    const context = getContext();
    const message = context.chat[messageId];

    if (!message || message.is_user || message.is_system) return;

    processMessage(message.mes || '', message);
}

function onMessageUpdated(messageId) {
    onMessageReceived(messageId);
}

function onMessageSwiped() {
    if (!getSettings().enabled) return;
    detectAndRenderFromLastMessage();
}

/**
 * Debounced handler for streaming tokens.
 * Reads the latest assistant message and processes it.
 */
function onStreamTokenReceived() {
    if (!getSettings().enabled) return;

    if (!getSettings().streamDetection) return;

    clearTimeout(streamDebounceTimer);
    streamDebounceTimer = setTimeout(() => {
        const context = getContext();
        if (!context.chat || !context.chat.length) return;

        // During streaming, the last message is the one being generated
        const lastMsg = context.chat[context.chat.length - 1];
        if (!lastMsg || lastMsg.is_user || lastMsg.is_system) return;

        processMessage(lastMsg.mes || '', lastMsg);
    }, getSettings().streamDebounceMs);
}

function onChatChanged() {
    spriteCache.clear();
    currentExpression = null;
    currentImageSrc = '';
    isOpacityToggled = false;

    if (!getSettings().enabled) {
        hideHolder();
        return;
    }

    detectAndRenderFromLastMessage();
}

// =============================================================
//  Initialization
// =============================================================

jQuery(async () => {
    // 1. Settings
    initSettings();

    // 2. Load settings HTML
    const settingsHtml = await $.get(`${FOLDER_PATH}/settings.html`);
    $('#extensions_settings2').append(settingsHtml);

    // 3. Populate UI
    loadSettingsUI();
    bindSettingsListeners();

    // 4. Create holder
    ensureHolder();

    // 5. Bind events
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.MESSAGE_UPDATED, onMessageUpdated);
    eventSource.on(event_types.MESSAGE_SWIPED, onMessageSwiped);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.STREAM_TOKEN_RECEIVED, onStreamTokenReceived);
    eventSource.on(event_types.CHARACTER_EDITED, () => {
        spriteCache.clear();
        detectAndRenderFromLastMessage();
    });

    // 6. Resize handler
    window.addEventListener('resize', () => {
        applyDefaultPosition();
        updateAdjustFrame();
    });

    // 7. Leave the on-screen editor with Escape
    $(document).on('keydown', function (e) {
        if (e.key === 'Escape') {
            stopAdjusting();
        }
    });

    // 8. Process existing chat
    detectAndRenderFromLastMessage();

    console.log(`[${EXTENSION_NAME}] Extension loaded.`);
});
