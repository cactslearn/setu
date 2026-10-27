# Accessibility Statement for Setu P2P

Setu P2P is committed to ensuring digital accessibility for all users, including individuals with disabilities. We continually improve the user experience and apply relevant accessibility standards to deliver an inclusive, barrier-free communication and collaboration platform.

---

## Standards and Conformance

Setu P2P aims to conform to the **Web Content Accessibility Guidelines (WCAG) 2.1 Level AA** standards.

### Core Accessibility Features Implemented

1. **Semantic HTML5 Structure and ARIA Landmarks:**
   - Pages utilize standard semantic landmarks (`<header role="banner">`, `<main role="main">`, `<section>`, `<article>`, `<nav>`) to enable effortless screen reader landmark navigation.
   - All interactive controls use native button, link, and input elements with distinct labels (`aria-label`, `aria-labelledby`, `aria-describedby`).
   - Dynamic UI state changes (such as connection stages, incoming chat messages, and SAS verification tokens) leverage ARIA live regions (`aria-live="polite"`).

2. **Full Keyboard Accessibility:**
   - Every primary action—including starting meetings, joining via room codes, muting/unmuting audio and video, opening side panels, and toggling presentation views—is fully operable via keyboard navigation without requiring mouse interaction.
   - Modals and popups implement focus trapping, visible focus rings, and universal dismissal via the `Escape` key.
   - Remote desktop control overlays allow instant escape and release through the `Escape` key.

3. **Color Contrast and Visual Aesthetics:**
   - Both Dark and Light themes are engineered to meet or exceed WCAG AA contrast ratios (minimum 4.5:1 for body text, 3:1 for large headers and interactive components).
   - Information is never conveyed through color alone; status badges, microphone states, and network indicators combine distinct textual labels, shape differences, and icon cues.

4. **Multi-Modal Feedback:**
   - Built-in audio chimes synthesized via the native Web Audio API notify users of peer join, leave, chat message, and hand-raise events.
   - Visual Short Authentication String (SAS) tokens are accompanied by 6-digit numeric codes to allow verbal verification over voice channels.

---

## Supported Environments and Assistive Technologies

Setu P2P is tested and designed to be compatible with:
- **Operating Systems:** Windows 10/11, macOS, Linux, Android, and iOS.
- **Web Browsers:** Modern evergreen browsers supporting WebRTC (Google Chrome, Microsoft Edge, Mozilla Firefox, Apple Safari).
- **Screen Readers:**
  - NVDA and JAWS on Windows.
  - VoiceOver on macOS and iOS.
  - TalkBack on Android.

---

## Known Limitations and Alternatives

While we strive for comprehensive accessibility across all features, some constraints currently exist:

1. **Collaborative Whiteboard:**
   - Freehand drawing on the collaborative canvas requires continuous pointer or touch gestures.
   - *Alternative:* Participants can use the built-in collaborative Notepad and DataChannel text chat, which are fully accessible via keyboard and screen reader.

2. **Screen Sharing Presentation Content:**
   - Content broadcasted inside a shared screen stream is rendered as a video feed (`<video>`) and cannot be parsed directly by client-side screen readers.
   - *Alternative:* Meeting participants are encouraged to describe presented visual materials verbally and share text summaries or files via the accessible P2P file transfer tool.

---

## Reporting Accessibility Barriers

We welcome feedback on the accessibility of Setu P2P. If you encounter accessibility barriers, difficulty using assistive technologies, or have recommendations for improvement:

1. **GitHub Issues:** Open an issue on GitHub with the label `accessibility` describing the obstacle, the assistive technology used, and the browser version.
2. **Security & Confidential Inquiries:** Refer to our [Security Policy](SECURITY.md) if reporting an issue touching confidential user workflows.

We aim to review and respond to accessibility issues within 3 business days.
