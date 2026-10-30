---
name: voice-ui
description: Design or change Voice frontend screens, components, copy, and user-facing features with consistent minimalist styling and English, Chinese, and Japanese localization.
---

# Voice UI guide

The app is named **Voice**. Follow the restrained, modern product UI direction of Vercel and Cloudflare. Use this repository's diagnostics and audio settings as concrete visual references, rather than introducing a new visual language for each screen.

## Visual consistency

Inspect the relevant existing components and these references before designing:

- `frontend/src/diagnostics/diagnostics.css` and `DiagnosticsPage.tsx`.
- `frontend/src/audio/AudioSettings.tsx` and `audio-settings.css`.
- `frontend/src/workspace.css`, `components/AppHeader.tsx`, and shared UI components.
- `frontend/src/index.css` for theme tokens and typography.

Use compact sans-serif typography, neutral surfaces, thin borders, restrained colors, modest corner radii, and clear spacing. Reuse theme tokens and shared controls. Avoid ornamental gradients, oversized branding, decorative footers, and unnecessary animation. Audio settings must open and close without animation, including the overlay.

Every label or control should serve a purpose; omit redundant category labels and filler. Place controls where they are discoverable and useful, keeping equivalent actions consistent across screens. Preserve existing functionality when reorganizing layouts, including account actions, room creation/joining and codes, chat/unread state, call controls, diagnostics, themes, languages, and microphone testing. In-call microphone testing must mute the call and restore its prior mute state afterward.

## Internationalization

Every new user-facing feature must support all three locales: English (`en`), Chinese (`zh`), and Japanese (`ja`). Add corresponding keys to all three dictionaries in `frontend/src/i18n/messages.ts` and render them through `useT`/`useI18n`.

Localize labels, descriptions, errors, loading/empty states, tooltips, and accessible names—not only headings. Avoid hardcoded English in new UI. Keep proper names such as Voice and RNNoise consistent. Use interpolation for variable text; allow translated text to wrap and use locale-aware number/date formatting when applicable. Do not reset saved language or theme preferences during a visual rework.

## Review

Check small and large layouts, light/dark themes, long names, and translated text. Preserve keyboard access, visible focus, semantic form labels, and dialog/menu accessibility. Run the frontend build/typecheck and relevant behavioral tests. Use browser inspection when available; explicitly distinguish actual visual or live-audio verification from automated checks. Do not claim a browser or real microphone test was performed if it was not.
