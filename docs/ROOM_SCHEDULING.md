# Setu P2P — Room Scheduling & Calendar Integration Guide

Setu P2P includes a completely client-side, zero-cloud room scheduler and calendar synchronization engine. Users can schedule upcoming meetings, export standard RFC 5545 iCalendar (`.ics`) invitation files, import existing invitations, add events to Google Calendar and Microsoft Outlook with one click, and compose pre-formatted email invitations without requiring an account, server, or cloud calendar subscription.

---

## Architecture Overview

```text
+-----------------------------------------------------------------------------------+
|                                 Browser Sandbox                                   |
|                                                                                   |
|  [ Schedule Form / Import ]                                                       |
|             |                                                                     |
|             v                                                                     |
|    ScheduleEngine (schedule.js) <---------> IndexedDB ('schedules' Store)        |
|             |                                                                     |
|     +-------+-------------------------+----------------------+                    |
|     |                                 |                      |                    |
|     v                                 v                      v                    |
| RFC 5545 (.ics)              Web Calendar Links       Email Invitations           |
| Blob Download                - Google Calendar        (mailto: pre-filled)        |
| & Local Parser               - Outlook Web                                        |
+-----------------------------------------------------------------------------------+
```

### 1. Data Sovereignty & Zero Cloud Footprint
In proprietary platforms (Zoom, Google Meet, Microsoft Teams), scheduling requires an authenticated cloud identity, account subscription, and server-side calendar API access.

In Setu P2P:
- All scheduled meetings reside strictly inside the user's browser `IndexedDB` (`schedules` object store, database version 4) with an automated `localStorage` fallback.
- Exported files are generated dynamically on-device as RFC 5545 iCalendar binary Blobs.
- Zero meeting metadata, timestamps, or participant identifiers are sent to any external server.

---

## Supported Calendar Capabilities

### 1. Standard RFC 5545 iCalendar (.ics) Generation
The engine outputs RFC 5545-compliant iCalendar data:
- `PRODID:-//Setu P2P//Room Scheduler//EN`
- `VERSION:2.0`
- `CALSCALE:GREGORIAN`
- `METHOD:REQUEST`
- Universal UTC timestamps (`YYYYMMDDTHHMMSSZ`)
- Automatic line folding at 75-octet boundaries per RFC 5545 Section 3.1
- Special character escaping (`\`, `;`, `,`, and newlines)
- Direct Setu room hyperlink embedding (`URL;VALUE=URI:...` and `LOCATION:...`)

Compatible with:
- Apple Calendar (macOS & iOS)
- Microsoft Outlook (Desktop & Web)
- Google Calendar
- Mozilla Thunderbird
- Nextcloud Calendar

### 2. Client-Side .ics Import Parser
Users can drag and drop or browse any `.ics` file into Setu. The parser:
- Unfolds multi-line strings per RFC 5545.
- Extracts `SUMMARY`, `DTSTART`, `DTEND`, `DESCRIPTION`, `LOCATION`, and `UID`.
- Automatically extracts Setu room codes (e.g. `SETU-XXXX-XXXX`) or room URL query strings.
- Stores the meeting in local IndexedDB and updates the upcoming schedule view.

### 3. One-Click Web Calendar Deep Links
Direct template links pass pre-filled meeting parameters directly in the URL:
- **Google Calendar:** `https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=...&details=...&location=...`
- **Microsoft Outlook Web:** `https://outlook.live.com/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=...&startdt=...&enddt=...&body=...&location=...`

### 4. Direct Email Invitations (`mailto:`)
Composes a pre-populated email containing:
- Meeting title and topic
- Formatted local date and time
- Session duration
- Direct one-click Setu join link (`?room=SETU-XXXX-XXXX`)
- Clear room code
- Meeting agenda / notes
- Platform privacy assurance note

### 5. Interactive Month Calendar & Availability Inspector
- Month-by-month interactive grid with Previous/Today/Next navigation.
- Real-time event indicators (colored dots on days with scheduled meetings).
- Dynamic availability calculation ("Available / All Day Free" vs "Busy / X Events").
- Past dates are strictly view-only with scheduling buttons hidden and disabled to prevent creating meetings in the past.
- Active and future dates feature one-click "+ Schedule Room on this Day" shortcuts that pre-fill the selected date and calculate the next available future time slot.

### 6. Missed Events & Non-Overlapping Rescheduling Engine
- Segregates past/missed meetings from active upcoming meetings into a dedicated "Missed Events" tab.
- Each missed event card strictly features a prominent "Reschedule Meeting" action; export and invitation sharing buttons (Export .ics, Email, Copy) are removed for expired sessions.
- Automatically calculates a guaranteed future, non-overlapping time slot while preserving the topic, room code, duration, and agenda notes.

### 7. Overlap Conflict Detection & Availability Validation
- Comprehensive overlap validation based on standard half-open intervals `[start, start + duration)` prevents overlapping meetings.
- Live conflict banner (`#schedConflictAlert`) warns immediately if selected date/time/duration overlaps with any scheduled meeting.
- Blocks save/export on conflict with a descriptive error message indicating the conflicting meeting's title and exact time span.
- `findNextAvailableSlot()` automatically searches in 15-minute increments for the earliest available non-overlapping slot.

### 8. Clean Date & Time Controls
- Clean standard date and time input controls (`<input type="date">` and `<input type="time">`) with embedded SVG icons and native calendar/clock picker invocation (`showPicker()`).
- Responsive 3-column form layout (`.sched-form-grid-3`) that collapses on mobile viewports.

### 9. Custom Signaling API Gateway Link Attachment
- When Custom API Signaling is configured and enabled in Settings (`#settingApiSignalingEnabled` and `#settingApiEndpoint`), all generated meeting links in the scheduler automatically attach the signaling gateway URL:
  `${base}#apiRoom=${formattedCode}&api=${encodeURIComponent(endpoint)}`
- Applies transparently behind the scenes to Export `.ics`, Google Calendar, Microsoft Outlook Web, Email invitations (`mailto:`), and Copy Invitation clipboard actions.
- Zero UI additions or clutter in the scheduler dialog; the engine queries settings automatically from storage or active configuration.
- If Custom API Signaling is disabled or unconfigured, standard peer-to-peer room URLs (`#room=${cleanCode}`) are used.
- Full compatibility with external calendar providers and mail clients via simultaneous hash fragment and URL query parameter parsing in `checkUrlJoinHash()`.

---

## Storage Schema & Audit

Each schedule record in the `schedules` object store contains:
- `id`: Unique identifier (`sched_<timestamp>_<random>`)
- `title`: Meeting topic / subject string
- `roomCode`: 8-character normalized room code (`SETU-XXXX-XXXX`)
- `startTime`: ISO 8601 UTC timestamp
- `durationMinutes`: Integer duration (e.g. 15, 30, 45, 60, 90, 120)
- `location`: Full room join URL
- `notes`: Optional meeting agenda / notes
- `createdAt`: ISO 8601 creation timestamp
- `updatedAt`: ISO 8601 last modified timestamp

All scheduled meetings are included in:
1. **Privacy & Storage Console Audit:** Inspect total scheduled room count and storage footprint.
2. **Full Data Export:** Downloaded in JSON format alongside chat messages, contacts, and meeting archives.
3. **Panic Wipe:** Completely eradicated upon triggering local data purge.

