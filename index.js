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

// ── State ────────────────────────────────────────────────────
/** @type {Map<string, {label: string, path: string}[]>} */
const spriteCache = new Map();

let currentExpression = null;
let currentImageSrc = '';
let isOpacityToggled = false;

// =============================================================
//  Settings
// =============================================================

/** @returns {typeof DEFAULT_SETTINGS} */
function getSettings() {
    return extension_settings[EXTENSION_NAME];
}

function initSettings() {
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = {};
    }
    const s = extension_settings[EXTENSION_NAME];

    // Deep merge defaults
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (s[key] === undefined) {
            s[key] = typeof value === 'object' && value !== null && !Array.isArray(value)
                ? { ...value }
                : value;
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            // Merge nested objects (window, fullscreen)
            for (const [k2, v2] of Object.entries(value)) {
                if (s[key][k2] === undefined) {
                    s[key][k2] = v2;
                }
            }
        }
    }
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

    // Custom
    $('#fe_custom_html').val(s.customHtml);
    $('#fe_custom_css').val(s.customCss);

    // Toggle visibility of sections
    toggleDetectionModeUI(s.detectionMode);
    toggleDisplayModeUI(s.displayMode);
    toggleWindowCustomSize(s.window.sizePreset);
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
        getSettings().fullscreen.objectFit = String($(this).val());
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
        const regex = new RegExp(pattern, 'i');
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
        const regex = new RegExp(`<${escapedTag}[^>]*>(.+?)</${escapedTag}>`, 'i');
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
        return `<${escaped}[^>]*>.+?<\\/${escaped}>`;
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
 * Resolve a sprite image path for the given expression label.
 * @param {string} label
 * @returns {Promise<string|null>}
 */
async function resolveSprite(label) {
    const context = getContext();
    if (context.characterId === undefined && !context.groupId) return null;

    const folderName = getCharaFilename();
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
    holder.find('img.fe-sprite').css('object-fit', '');

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

    holder.css({
        opacity: fs.opacity,
        zIndex: fs.zIndex,
    });

    holder.find('img.fe-sprite').css('object-fit', fs.objectFit);
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
//  Message Processing
// =============================================================

/**
 * Core pipeline: detect expression → resolve sprite → render.
 * @param {string} text Message text
 */
async function processMessage(text) {
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

    const imageSrc = await resolveSprite(label);
    if (!imageSrc) {
        // Try fallback if detected label didn't match
        if (label !== s.fallbackExpression && s.fallbackExpression) {
            const fallbackSrc = await resolveSprite(s.fallbackExpression.trim().toLowerCase());
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

    processMessage(lastMsg.mes || '');
}



// =============================================================
//  Event Handlers
// =============================================================

function onMessageReceived(messageId) {
    if (!getSettings().enabled) return;

    const context = getContext();
    const message = context.chat[messageId];

    if (!message || message.is_user || message.is_system) return;

    processMessage(message.mes || '');
}

function onMessageUpdated(messageId) {
    onMessageReceived(messageId);
}

function onMessageSwiped() {
    if (!getSettings().enabled) return;
    detectAndRenderFromLastMessage();
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
    eventSource.on(event_types.CHARACTER_EDITED, () => {
        spriteCache.clear();
        detectAndRenderFromLastMessage();
    });

    // 6. Resize handler
    window.addEventListener('resize', () => { applyDefaultPosition(); });

    // 8. Process existing chat
    detectAndRenderFromLastMessage();

    console.log(`[${EXTENSION_NAME}] Extension loaded.`);
});
