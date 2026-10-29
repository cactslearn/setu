/**
 * Setu P2P - Room Scheduling & Calendar Integration
 * Standalone, private, client-side room scheduling engine.
 * Generates and parses RFC 5545 iCalendar (.ics) files,
 * builds direct Google Calendar and Outlook Web deep links,
 * and composes pre-filled email invitations.
 * Strictly 100% client-side with zero cloud dependencies.
 * Zero emojis in code, comments, and UI.
 */

class ScheduleEngine {
  constructor() {
    this.storage = window.setuStorage;
    this.cachedApiEndpoint = '';
    this.cachedApiEnabled = false;
    this.updateSignalingSettings().catch(() => {});
  }

  /**
   * Refreshes cached API signaling gateway settings from storage or DOM
   */
  async updateSignalingSettings() {
    try {
      if (window.setuStorage && typeof window.setuStorage.getApiSignalingSettings === 'function') {
        const settings = await window.setuStorage.getApiSignalingSettings();
        if (settings && settings.enabled && settings.endpoint && settings.endpoint.trim()) {
          this.cachedApiEndpoint = settings.endpoint.trim();
          this.cachedApiEnabled = true;
          return { enabled: true, endpoint: this.cachedApiEndpoint };
        }
      }
    } catch (_) {}

    const endpoint = this._getDomApiEndpoint();
    if (endpoint) {
      this.cachedApiEndpoint = endpoint;
      this.cachedApiEnabled = true;
      return { enabled: true, endpoint };
    }

    this.cachedApiEndpoint = '';
    this.cachedApiEnabled = false;
    return { enabled: false, endpoint: '' };
  }

  /**
   * Checks DOM controls for configured API signaling endpoint
   */
  _getDomApiEndpoint() {
    const enabledEl = document.getElementById('settingApiSignalingEnabled');
    const endpointEl = document.getElementById('settingApiEndpoint');
    if (enabledEl && enabledEl.checked && endpointEl && endpointEl.value && endpointEl.value.trim()) {
      return endpointEl.value.trim();
    }
    return '';
  }

  /**
   * Helper to format Date into UTC iCalendar timestamp: YYYYMMDDTHHMMSSZ
   */
  formatIcsDate(date) {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return (
      d.getUTCFullYear() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      'T' +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) +
      'Z'
    );
  }

  /**
   * Helper to format Date into ISO 8601 string for web calendar query params
   */
  formatIsoForQuery(date) {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  /**
   * Escapes special characters per RFC 5545 Section 3.3.11
   */
  escapeIcsText(text) {
    if (!text) return '';
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\n|\r/g, '\\n');
  }

  /**
   * Unescapes RFC 5545 escaped text
   */
  unescapeIcsText(text) {
    if (!text) return '';
    return String(text)
      .replace(/\\n/gi, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\');
  }

  /**
   * Folds lines according to RFC 5545 (limit lines to 75 octets)
   */
  foldIcsLine(line) {
    if (line.length <= 75) return line;
    const chunks = [];
    chunks.push(line.slice(0, 75));
    let index = 75;
    while (index < line.length) {
      chunks.push(' ' + line.slice(index, index + 74));
      index += 74;
    }
    return chunks.join('\r\n');
  }

  /**
   * Resolves the full join URL for a room code.
   * If a custom API signaling gateway endpoint is set, attaches #apiRoom=...&api=...
   * Otherwise attaches standard #room=...
   */
  getJoinUrl(roomCode, explicitEndpoint = null) {
    if (!roomCode) return '';
    const base = `${window.location.origin}${window.location.pathname}`;
    const cleanCode = window.setuRoomSignaling ? window.setuRoomSignaling.normalizeRoomCode(roomCode) : roomCode;
    const formattedCode = window.setuRoomSignaling ? window.setuRoomSignaling.formatRoomCode(cleanCode) : cleanCode;

    const endpoint = explicitEndpoint || (this.cachedApiEnabled && this.cachedApiEndpoint ? this.cachedApiEndpoint : this._getDomApiEndpoint());

    if (endpoint) {
      return `${base}#apiRoom=${encodeURIComponent(formattedCode)}&api=${encodeURIComponent(endpoint)}`;
    }
    return `${base}#room=${encodeURIComponent(cleanCode)}`;
  }

  /**
   * Resolves the meeting join link.
   * If API signaling is active, attaches the signaling API URL.
   * If meeting already has an explicit location URL, retains it.
   */
  getMeetingJoinUrl(meeting) {
    if (!meeting) return '';
    const endpoint = (this.cachedApiEnabled && this.cachedApiEndpoint) ? this.cachedApiEndpoint : this._getDomApiEndpoint();
    if (endpoint) {
      return this.getJoinUrl(meeting.roomCode, endpoint);
    }
    if (meeting.location && typeof meeting.location === 'string' && meeting.location.trim()) {
      return meeting.location.trim();
    }
    return this.getJoinUrl(meeting.roomCode);
  }

  /**
   * Generates standard RFC 5545 iCalendar content (.ics)
   */
  generateIcs(meeting) {
    const startDate = new Date(meeting.startTime);
    const durationMin = parseInt(meeting.durationMinutes, 10) || 30;
    const endDate = new Date(startDate.getTime() + durationMin * 60 * 1000);

    const dtstamp = this.formatIcsDate(new Date());
    const dtstart = this.formatIcsDate(startDate);
    const dtend = this.formatIcsDate(endDate);

    const roomUrl = this.getMeetingJoinUrl(meeting);
    const uid = meeting.id ? `setu-${meeting.id}@setu.p2p` : `setu-${Date.now()}-${Math.random().toString(36).substr(2, 6)}@setu.p2p`;

    const description = [
      `Setu P2P Video Meeting`,
      `Topic: ${meeting.title}`,
      `Room Code: ${meeting.roomCode || 'N/A'}`,
      `Join Link: ${roomUrl}`,
      meeting.notes ? `\nAgenda / Notes:\n${meeting.notes}` : '',
      `\nStrictly serverless and peer-to-peer. No account or installation required.`
    ].filter(Boolean).join('\n');

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Setu P2P//Room Scheduler//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${dtstart}`,
      `DTEND:${dtend}`,
      this.foldIcsLine(`SUMMARY:${this.escapeIcsText(meeting.title || 'Setu P2P Meeting')}`),
      this.foldIcsLine(`DESCRIPTION:${this.escapeIcsText(description)}`),
      this.foldIcsLine(`LOCATION:${this.escapeIcsText(roomUrl)}`),
      `URL;VALUE=URI:${roomUrl}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'SEQUENCE:0',
      'END:VEVENT',
      'END:VCALENDAR'
    ];

    return lines.join('\r\n') + '\r\n';
  }

  /**
   * Downloads RFC 5545 .ics file client-side
   */
  downloadIcs(meeting) {
    const icsContent = this.generateIcs(meeting);
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeCode = (meeting.roomCode || 'meeting').replace(/[^a-zA-Z0-9_-]/g, '_');
    link.href = url;
    link.download = `setu-${safeCode}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Builds Google Calendar web compose link
   */
  buildGoogleCalendarUrl(meeting) {
    const startDate = new Date(meeting.startTime);
    const durationMin = parseInt(meeting.durationMinutes, 10) || 30;
    const endDate = new Date(startDate.getTime() + durationMin * 60 * 1000);

    const startIso = this.formatIsoForQuery(startDate);
    const endIso = this.formatIsoForQuery(endDate);
    const roomUrl = this.getMeetingJoinUrl(meeting);

    const details = [
      `Setu P2P Video Meeting`,
      `Join Link: ${roomUrl}`,
      `Room Code: ${meeting.roomCode || 'N/A'}`,
      meeting.notes ? `\nAgenda / Notes:\n${meeting.notes}` : '',
      `\nPrivate, serverless WebRTC video call with zero accounts.`
    ].filter(Boolean).join('\n');

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: meeting.title || 'Setu P2P Meeting',
      dates: `${startIso}/${endIso}`,
      details: details,
      location: roomUrl
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  /**
   * Builds Microsoft Outlook Web calendar compose link
   */
  buildOutlookCalendarUrl(meeting) {
    const startDate = new Date(meeting.startTime);
    const durationMin = parseInt(meeting.durationMinutes, 10) || 30;
    const endDate = new Date(startDate.getTime() + durationMin * 60 * 1000);

    const roomUrl = this.getMeetingJoinUrl(meeting);

    const details = [
      `Setu P2P Video Meeting`,
      `Join Link: ${roomUrl}`,
      `Room Code: ${meeting.roomCode || 'N/A'}`,
      meeting.notes ? `\nAgenda / Notes:\n${meeting.notes}` : '',
      `\nPrivate, serverless WebRTC video call with zero accounts.`
    ].filter(Boolean).join('\n');

    const params = new URLSearchParams({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: meeting.title || 'Setu P2P Meeting',
      startdt: startDate.toISOString(),
      enddt: endDate.toISOString(),
      body: details,
      location: roomUrl
    });

    return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
  }

  /**
   * Builds pre-filled mailto: invitation link
   */
  buildEmailShareUrl(meeting) {
    const startDate = new Date(meeting.startTime);
    const durationMin = parseInt(meeting.durationMinutes, 10) || 30;
    const dateFormatted = isNaN(startDate.getTime())
      ? meeting.startTime
      : startDate.toLocaleString(undefined, {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

    const roomUrl = this.getMeetingJoinUrl(meeting);

    const subject = `Invitation: ${meeting.title || 'Setu P2P Meeting'}`;
    const body = [
      `You are invited to a private Setu P2P video meeting.\n`,
      `Topic: ${meeting.title || 'Setu P2P Meeting'}`,
      `Date & Time: ${dateFormatted}`,
      `Duration: ${durationMin} minutes\n`,
      `Join Direct Link:`,
      `${roomUrl}\n`,
      `Room Code: ${meeting.roomCode || 'N/A'}\n`,
      meeting.notes ? `Agenda / Notes:\n${meeting.notes}\n` : '',
      `Setu P2P is completely private and runs directly in your browser with zero installs, zero accounts, and zero tracking.`
    ].filter(Boolean).join('\n');

    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  /**
   * Builds plain text invitation copy
   */
  buildInvitationText(meeting) {
    const startDate = new Date(meeting.startTime);
    const durationMin = parseInt(meeting.durationMinutes, 10) || 30;
    const dateFormatted = isNaN(startDate.getTime())
      ? meeting.startTime
      : startDate.toLocaleString(undefined, {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

    const roomUrl = this.getMeetingJoinUrl(meeting);

    return [
      `Setu P2P Meeting Invitation`,
      `--------------------------`,
      `Topic: ${meeting.title || 'Setu P2P Meeting'}`,
      `Date & Time: ${dateFormatted}`,
      `Duration: ${durationMin} minutes`,
      `Join URL: ${roomUrl}`,
      `Room Code: ${meeting.roomCode || 'N/A'}`,
      meeting.notes ? `\nAgenda:\n${meeting.notes}` : '',
      `\nOpen the link in any modern web browser to join.`
    ].filter(Boolean).join('\n');
  }

  /**
   * Parses an RFC 5545 iCalendar string into a meeting object
   */
  parseIcs(icsText) {
    if (!icsText || typeof icsText !== 'string') return null;

    // 1. Unfold lines per RFC 5545 Section 3.1
    const unfolded = icsText.replace(/\r\n[ \t]|\r[ \t]|\n[ \t]/g, '');
    const lines = unfolded.split(/\r\n|\r|\n/);

    let inEvent = false;
    let summary = '';
    let description = '';
    let location = '';
    let dtstartStr = '';
    let dtendStr = '';
    let uid = '';

    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (line === 'BEGIN:VEVENT') {
        inEvent = true;
        continue;
      }
      if (line === 'END:VEVENT') {
        inEvent = false;
        break;
      }
      if (!inEvent) continue;

      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const propHeader = line.substring(0, colonIdx);
      const propValue = line.substring(colonIdx + 1);
      const propName = propHeader.split(';')[0].toUpperCase().trim();

      if (propName === 'SUMMARY') {
        summary = this.unescapeIcsText(propValue);
      } else if (propName === 'DESCRIPTION') {
        description = this.unescapeIcsText(propValue);
      } else if (propName === 'LOCATION') {
        location = this.unescapeIcsText(propValue);
      } else if (propName === 'DTSTART') {
        dtstartStr = propValue;
      } else if (propName === 'DTEND') {
        dtendStr = propValue;
      } else if (propName === 'UID') {
        uid = propValue;
      }
    }

    if (!dtstartStr && !summary) return null;

    // Parse DTSTART
    const startTime = this._parseIcsTimestamp(dtstartStr);
    let durationMinutes = 30;

    if (dtendStr) {
      const endTime = this._parseIcsTimestamp(dtendStr);
      if (startTime && endTime && endTime > startTime) {
        durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / (60 * 1000));
      }
    }

    // Extract room code or link from LOCATION or DESCRIPTION
    let roomCode = '';
    const textToScan = `${location} ${description}`;

    // Match SETU-XXXX-XXXX
    const codeMatch = textToScan.match(/SETU-[A-Za-z0-9]+-[A-Za-z0-9]+/i);
    if (codeMatch) {
      roomCode = codeMatch[0].toUpperCase();
    } else {
      // Match #apiRoom=XXXX or ?apiRoom=XXXX
      const apiMatch = textToScan.match(/[#?&]apiRoom=([a-zA-Z0-9\-_]+)/i);
      if (apiMatch) {
        roomCode = apiMatch[1];
      } else {
        // Match ?room=XXXX or #room=XXXX
        const urlMatch = textToScan.match(/[#?&]room=([a-zA-Z0-9\-_]+)/i);
        if (urlMatch) {
          roomCode = urlMatch[1];
        }
      }
    }

    return {
      id: uid ? `import_${uid.replace(/[^a-zA-Z0-9_-]/g, '_')}` : undefined,
      title: summary || 'Imported Meeting',
      startTime: startTime ? startTime.toISOString() : new Date().toISOString(),
      durationMinutes: durationMinutes || 30,
      roomCode: roomCode || '',
      location: location || '',
      notes: description || ''
    };
  }

  _parseIcsTimestamp(str) {
    if (!str) return null;
    const clean = str.trim();

    // Pattern: YYYYMMDDTHHMMSSZ or YYYYMMDDTHHMMSS
    const m = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/i);
    if (m) {
      const isUtc = !!m[7];
      if (isUtc) {
        return new Date(Date.UTC(
          parseInt(m[1], 10),
          parseInt(m[2], 10) - 1,
          parseInt(m[3], 10),
          parseInt(m[4], 10),
          parseInt(m[5], 10),
          parseInt(m[6], 10)
        ));
      } else {
        return new Date(
          parseInt(m[1], 10),
          parseInt(m[2], 10) - 1,
          parseInt(m[3], 10),
          parseInt(m[4], 10),
          parseInt(m[5], 10),
          parseInt(m[6], 10)
        );
      }
    }

    // Pattern: YYYYMMDD (all day)
    const mDate = clean.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (mDate) {
      return new Date(
        parseInt(mDate[1], 10),
        parseInt(mDate[2], 10) - 1,
        parseInt(mDate[3], 10),
        9, 0, 0
      );
    }

    // Fallback standard parse
    const fallback = new Date(clean);
    return isNaN(fallback.getTime()) ? null : fallback;
  }
}

/**
 * Schedule UI Controller
 */
class ScheduleUI {
  constructor(engine) {
    this.engine = engine;
    this.activeTab = 'create';
    const now = new Date();
    this.calYear = now.getFullYear();
    this.calMonth = now.getMonth();
    this.calSelectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  init() {
    this._bindElements();
    this._setDefaultDateTime();
    this.refreshScheduleList();
  }

  _bindElements() {
    // Header & shortcut buttons to open Schedule Modal
    const openBtn = document.getElementById('openScheduleBtn');
    const welcomeBtn = document.getElementById('welcomeScheduleBtn');
    const modal = document.getElementById('scheduleModal');
    const closeBtn = document.getElementById('closeScheduleModalBtn');

    if (openBtn && modal) {
      openBtn.addEventListener('click', () => this.openModal());
    }
    if (welcomeBtn && modal) {
      welcomeBtn.addEventListener('click', () => this.openModal());
    }
    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) {
          this.closeModal();
        }
      });
    }

    // Modal navigation tabs
    const tabCreateBtn = document.getElementById('schedTabCreateBtn');
    const tabCalendarBtn = document.getElementById('schedTabCalendarBtn');
    const tabUpcomingBtn = document.getElementById('schedTabUpcomingBtn');
    const tabMissedBtn = document.getElementById('schedTabMissedBtn');
    const tabImportBtn = document.getElementById('schedTabImportBtn');

    if (tabCreateBtn) {
      tabCreateBtn.addEventListener('click', () => this.switchTab('create'));
    }
    if (tabCalendarBtn) {
      tabCalendarBtn.addEventListener('click', () => this.switchTab('calendar'));
    }
    if (tabUpcomingBtn) {
      tabUpcomingBtn.addEventListener('click', () => this.switchTab('upcoming'));
    }
    if (tabMissedBtn) {
      tabMissedBtn.addEventListener('click', () => this.switchTab('missed'));
    }
    if (tabImportBtn) {
      tabImportBtn.addEventListener('click', () => this.switchTab('import'));
    }

    // Calendar navigation buttons
    const calPrevBtn = document.getElementById('schedCalPrevBtn');
    const calNextBtn = document.getElementById('schedCalNextBtn');
    const calTodayBtn = document.getElementById('schedCalTodayBtn');

    if (calPrevBtn) {
      calPrevBtn.addEventListener('click', () => {
        this.calMonth--;
        if (this.calMonth < 0) {
          this.calMonth = 11;
          this.calYear--;
        }
        this.renderCalendarView();
      });
    }

    if (calNextBtn) {
      calNextBtn.addEventListener('click', () => {
        this.calMonth++;
        if (this.calMonth > 11) {
          this.calMonth = 0;
          this.calYear++;
        }
        this.renderCalendarView();
      });
    }

    if (calTodayBtn) {
      calTodayBtn.addEventListener('click', () => {
        const now = new Date();
        this.calYear = now.getFullYear();
        this.calMonth = now.getMonth();
        this.calSelectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        this.renderCalendarView();
      });
    }

    // Form inputs and buttons
    const genCodeBtn = document.getElementById('schedGenerateCodeBtn');
    const useMyRoomBtn = document.getElementById('schedUseMyRoomBtn');
    const roomCodeInput = document.getElementById('schedRoomCode');

    if (genCodeBtn && roomCodeInput) {
      genCodeBtn.addEventListener('click', () => {
        if (window.setuRoomSignaling && typeof window.setuRoomSignaling.generateRoomCode === 'function') {
          roomCodeInput.value = window.setuRoomSignaling.generateRoomCode();
        } else {
          roomCodeInput.value = 'SETU-' + Math.random().toString(36).substr(2, 4).toUpperCase() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
        }
        roomCodeInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    if (useMyRoomBtn && roomCodeInput) {
      useMyRoomBtn.addEventListener('click', async () => {
        let code = '';
        if (window.setuRoomSignaling && typeof window.setuRoomSignaling.getPersonalRoomCode === 'function') {
          code = await window.setuRoomSignaling.getPersonalRoomCode();
        } else if (window.setuStorage && typeof window.setuStorage.getOrCreatePersonalRoomCode === 'function') {
          const raw = await window.setuStorage.getOrCreatePersonalRoomCode();
          code = (window.setuRoomSignaling && typeof window.setuRoomSignaling.formatRoomCode === 'function')
            ? window.setuRoomSignaling.formatRoomCode(raw)
            : raw;
        } else {
          const badge = document.getElementById('welcomePersonalCodeBadge');
          if (badge && badge.textContent && badge.textContent !== '...') {
            code = badge.textContent.trim();
          } else {
            const input = document.getElementById('settingPersonalRoomCode');
            if (input && input.value) code = input.value.trim();
          }
        }

        if (code) {
          roomCodeInput.value = code;
          roomCodeInput.dispatchEvent(new Event('input', { bubbles: true }));
          if (window.showToast) {
            window.showToast('Using personal room code: ' + code);
          }
        } else {
          if (window.showToast) {
            window.showToast('Could not find personal room code');
          }
        }
      });
    }

    // Save and export buttons
    const saveAndIcsBtn = document.getElementById('schedSaveAndIcsBtn');
    const googleCalBtn = document.getElementById('schedGoogleCalBtn');
    const outlookCalBtn = document.getElementById('schedOutlookCalBtn');
    const emailInviteBtn = document.getElementById('schedEmailInviteBtn');
    const copyInviteBtn = document.getElementById('schedCopyInviteBtn');

    if (saveAndIcsBtn) {
      saveAndIcsBtn.addEventListener('click', () => this.handleSaveAndExportIcs());
    }
    if (googleCalBtn) {
      googleCalBtn.addEventListener('click', () => this.handleOpenGoogleCalendar());
    }
    if (outlookCalBtn) {
      outlookCalBtn.addEventListener('click', () => this.handleOpenOutlook());
    }
    if (emailInviteBtn) {
      emailInviteBtn.addEventListener('click', () => this.handleEmailInvite());
    }
    if (copyInviteBtn) {
      copyInviteBtn.addEventListener('click', () => this.handleCopyInvite());
    }

    // Import file drag-and-drop & picker
    const dropzone = document.getElementById('schedIcsDropzone');
    const fileInput = document.getElementById('schedIcsFileInput');

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());

      fileInput.addEventListener('change', (e) => {
        if (fileInput.files.length > 0) {
          this.handleImportFile(fileInput.files[0]);
        }
      });

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
          this.handleImportFile(e.dataTransfer.files[0]);
        }
      });
    }

    // Date, Time, and Duration inputs with live validation & picker triggers
    const dateInput = document.getElementById('schedDate');
    const timeInput = document.getElementById('schedTime');
    const durationInput = document.getElementById('schedDuration');

    if (dateInput) {
      dateInput.addEventListener('click', () => {
        if (typeof dateInput.showPicker === 'function') {
          try { dateInput.showPicker(); } catch (e) {}
        }
      });

      dateInput.addEventListener('change', () => {
        const todayYmd = this._formatYmd(new Date());
        if (dateInput.value < todayYmd) {
          dateInput.value = todayYmd;
          if (window.showToast) window.showToast('Past dates cannot be selected. Reset to today.');
        }
        this._enforceFutureTime();
        this.checkLiveOverlap();
      });
    }

    if (timeInput) {
      timeInput.addEventListener('click', () => {
        if (typeof timeInput.showPicker === 'function') {
          try { timeInput.showPicker(); } catch (e) {}
        }
      });

      timeInput.addEventListener('change', () => {
        this._enforceFutureTime();
        this.checkLiveOverlap();
      });
    }

    if (durationInput) {
      durationInput.addEventListener('change', () => {
        this.checkLiveOverlap();
      });
    }
  }

  // Check if a candidate meeting overlaps with any scheduled meeting
  async checkOverlap(candidateMeeting, excludeId = null) {
    if (!candidateMeeting || !candidateMeeting.startTime) return { conflict: false };

    const candStart = new Date(candidateMeeting.startTime).getTime();
    const candDuration = parseInt(candidateMeeting.durationMinutes, 10) || 30;
    const candEnd = candStart + (candDuration * 60 * 1000);

    if (isNaN(candStart)) return { conflict: false };

    const allSchedules = await this.engine.storage.getAllSchedules();

    for (const m of allSchedules) {
      if (excludeId && m.id === excludeId) continue;

      const mStart = new Date(m.startTime).getTime();
      const mDuration = parseInt(m.durationMinutes, 10) || 30;
      const mEnd = mStart + (mDuration * 60 * 1000);

      if (isNaN(mStart)) continue;

      // Standard half-open interval overlap check: candStart < mEnd && candEnd > mStart
      if (candStart < mEnd && candEnd > mStart) {
        return {
          conflict: true,
          conflictingMeeting: m
        };
      }
    }

    return { conflict: false };
  }

  // Real-time visual overlap check that updates the alert banner on the form
  async checkLiveOverlap() {
    const alertEl = document.getElementById('schedConflictAlert');
    const alertText = document.getElementById('schedConflictAlertText');
    const dateInput = document.getElementById('schedDate');
    const timeInput = document.getElementById('schedTime');
    const durationInput = document.getElementById('schedDuration');

    if (!alertEl || !dateInput?.value || !timeInput?.value) {
      if (alertEl) alertEl.style.display = 'none';
      return { conflict: false };
    }

    const startDateTime = new Date(`${dateInput.value}T${timeInput.value}`);
    if (isNaN(startDateTime.getTime())) {
      alertEl.style.display = 'none';
      return { conflict: false };
    }

    const duration = parseInt(durationInput?.value, 10) || 30;
    const candidate = {
      startTime: startDateTime.toISOString(),
      durationMinutes: duration
    };

    const result = await this.checkOverlap(candidate);
    if (result.conflict) {
      const m = result.conflictingMeeting;
      const mStart = new Date(m.startTime);
      const mEnd = new Date(mStart.getTime() + ((m.durationMinutes || 30) * 60000));
      const startStr = mStart.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const endStr = mEnd.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

      alertEl.style.display = 'flex';
      if (alertText) {
        alertText.textContent = `Time conflict: overlaps with "${m.title}" (${startStr} - ${endStr}). Please choose another time.`;
      }
    } else {
      alertEl.style.display = 'none';
    }

    return result;
  }

  // Find the earliest non-overlapping future time slot on or after dateYmd
  async findNextAvailableSlot(dateYmd, desiredDuration = 30, excludeId = null) {
    const now = new Date();
    const todayYmd = this._formatYmd(now);
    const pad = (n) => String(n).padStart(2, '0');

    const allSchedules = await this.engine.storage.getAllSchedules();
    const existingSpans = [];

    allSchedules.forEach((m) => {
      if (excludeId && m.id === excludeId) return;
      const s = new Date(m.startTime).getTime();
      const dur = parseInt(m.durationMinutes, 10) || 30;
      if (!isNaN(s)) {
        existingSpans.push({ start: s, end: s + dur * 60 * 1000, title: m.title });
      }
    });

    let searchStartHour = 9;
    let searchStartMin = 0;

    if (dateYmd === todayYmd) {
      const minFutureTime = new Date(now.getTime() + 15 * 60 * 1000);
      const roundedMinutes = Math.ceil(minFutureTime.getMinutes() / 15) * 15;
      minFutureTime.setMinutes(roundedMinutes);
      minFutureTime.setSeconds(0);
      minFutureTime.setMilliseconds(0);

      searchStartHour = minFutureTime.getHours();
      searchStartMin = minFutureTime.getMinutes();
    }

    // Search between searchStart and 22:00 in 15-minute increments
    for (let h = searchStartHour; h < 22; h++) {
      const startM = (h === searchStartHour) ? searchStartMin : 0;
      for (let m = startM; m < 60; m += 15) {
        const candDate = new Date(`${dateYmd}T${pad(h)}:${pad(m)}:00`);
        const candStart = candDate.getTime();
        const candEnd = candStart + (desiredDuration * 60 * 1000);

        if (candStart <= now.getTime()) continue;

        const hasOverlap = existingSpans.some((span) => candStart < span.end && candEnd > span.start);
        if (!hasOverlap) {
          return {
            dateStr: dateYmd,
            timeStr: `${pad(h)}:${pad(m)}`,
            candDate
          };
        }
      }
    }

    // If day is full or past 22:00, advance to next day at 09:00 AM
    const parts = dateYmd.split('-');
    const nextDay = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10) + 1);
    const nextYmd = this._formatYmd(nextDay);
    return this.findNextAvailableSlot(nextYmd, desiredDuration, excludeId);
  }

  _enforceFutureTime() {
    const dateInput = document.getElementById('schedDate');
    const timeInput = document.getElementById('schedTime');
    if (!dateInput || !timeInput || !dateInput.value || !timeInput.value) return;

    const now = new Date();
    const todayYmd = this._formatYmd(now);

    if (dateInput.value === todayYmd) {
      const parts = timeInput.value.split(':');
      if (parts.length === 2) {
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const chosen = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
        if (chosen.getTime() <= now.getTime()) {
          const roundedMinutes = Math.ceil((now.getMinutes() + 10) / 15) * 15;
          const target = new Date(now.getTime());
          target.setMinutes(roundedMinutes);
          target.setSeconds(0);
          const pad = (n) => String(n).padStart(2, '0');
          if (target.getDate() !== now.getDate()) {
            dateInput.value = this._formatYmd(target);
            timeInput.value = '09:00';
          } else {
            timeInput.value = `${pad(target.getHours())}:${pad(target.getMinutes())}`;
          }
          if (window.showToast) {
            window.showToast('Adjusted to upcoming future time slot.');
          }
        }
      }
    }
  }

  _formatYmd(d) {
    if (!d || isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  async _setDefaultDateTime() {
    const dateInput = document.getElementById('schedDate');
    const timeInput = document.getElementById('schedTime');
    const durationInput = document.getElementById('schedDuration');
    const roomCodeInput = document.getElementById('schedRoomCode');

    const now = new Date();
    const todayYmd = this._formatYmd(now);

    if (dateInput) {
      dateInput.min = todayYmd;
    }

    const duration = parseInt(durationInput?.value, 10) || 30;
    const slot = await this.findNextAvailableSlot(todayYmd, duration);

    if (dateInput && !dateInput.value) dateInput.value = slot.dateStr;
    if (timeInput && !timeInput.value) timeInput.value = slot.timeStr;

    if (roomCodeInput && !roomCodeInput.value) {
      if (window.setuRoomSignaling && typeof window.setuRoomSignaling.generateRoomCode === 'function') {
        roomCodeInput.value = window.setuRoomSignaling.generateRoomCode();
      } else {
        roomCodeInput.value = 'SETU-' + Math.random().toString(36).substr(2, 4).toUpperCase() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
      }
    }

    this.checkLiveOverlap();
  }

  async openModal() {
    const modal = document.getElementById('scheduleModal');
    if (!modal) return;
    await this.engine.updateSignalingSettings();
    await this._setDefaultDateTime();
    this.refreshScheduleList();
    this.switchTab(this.activeTab || 'create');
    this.checkLiveOverlap();
    modal.classList.add('open');
  }

  closeModal() {
    const modal = document.getElementById('scheduleModal');
    if (modal) modal.classList.remove('open');
  }

  switchTab(tabName) {
    this.activeTab = tabName;
    const tabCreateBtn = document.getElementById('schedTabCreateBtn');
    const tabCalBtn = document.getElementById('schedTabCalendarBtn');
    const tabUpcomingBtn = document.getElementById('schedTabUpcomingBtn');
    const tabMissedBtn = document.getElementById('schedTabMissedBtn');
    const tabImportBtn = document.getElementById('schedTabImportBtn');

    const viewCreate = document.getElementById('schedViewCreate');
    const viewCal = document.getElementById('schedViewCalendar');
    const viewUpcoming = document.getElementById('schedViewUpcoming');
    const viewMissed = document.getElementById('schedViewMissed');
    const viewImport = document.getElementById('schedViewImport');

    if (tabCreateBtn) {
      tabCreateBtn.classList.toggle('active', tabName === 'create');
      tabCreateBtn.setAttribute('aria-selected', tabName === 'create' ? 'true' : 'false');
    }
    if (tabCalBtn) {
      tabCalBtn.classList.toggle('active', tabName === 'calendar');
      tabCalBtn.setAttribute('aria-selected', tabName === 'calendar' ? 'true' : 'false');
    }
    if (tabUpcomingBtn) {
      tabUpcomingBtn.classList.toggle('active', tabName === 'upcoming');
      tabUpcomingBtn.setAttribute('aria-selected', tabName === 'upcoming' ? 'true' : 'false');
    }
    if (tabMissedBtn) {
      tabMissedBtn.classList.toggle('active', tabName === 'missed');
      tabMissedBtn.setAttribute('aria-selected', tabName === 'missed' ? 'true' : 'false');
    }
    if (tabImportBtn) {
      tabImportBtn.classList.toggle('active', tabName === 'import');
      tabImportBtn.setAttribute('aria-selected', tabName === 'import' ? 'true' : 'false');
    }

    if (viewCreate) viewCreate.style.display = tabName === 'create' ? 'block' : 'none';
    if (viewCal) viewCal.style.display = tabName === 'calendar' ? 'block' : 'none';
    if (viewUpcoming) viewUpcoming.style.display = tabName === 'upcoming' ? 'block' : 'none';
    if (viewMissed) viewMissed.style.display = tabName === 'missed' ? 'block' : 'none';
    if (viewImport) viewImport.style.display = tabName === 'import' ? 'block' : 'none';

    const dialogBody = document.querySelector('#scheduleModal .dialog-body');
    if (dialogBody) dialogBody.scrollTop = 0;

    if (tabName === 'calendar') {
      this.renderCalendarView();
    } else if (tabName === 'upcoming' || tabName === 'missed') {
      this.refreshScheduleList();
    }
  }

  async renderCalendarView() {
    const titleEl = document.getElementById('schedCalMonthTitle');
    const gridEl = document.getElementById('schedCalDaysGrid');
    if (!titleEl || !gridEl) return;

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    titleEl.textContent = `${monthNames[this.calMonth]} ${this.calYear}`;

    // Index all scheduled meetings by YYYY-MM-DD
    const allMeetings = await this.engine.storage.getAllSchedules();
    const eventsByDate = new Map();
    allMeetings.forEach((m) => {
      const d = new Date(m.startTime);
      if (!isNaN(d.getTime())) {
        const key = this._formatYmd(d);
        if (!eventsByDate.has(key)) eventsByDate.set(key, []);
        eventsByDate.get(key).push(m);
      }
    });

    gridEl.innerHTML = '';

    const firstDayIndex = new Date(this.calYear, this.calMonth, 1).getDay();
    const daysInCurrentMonth = new Date(this.calYear, this.calMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(this.calYear, this.calMonth, 0).getDate();

    const totalCells = (firstDayIndex + daysInCurrentMonth > 35) ? 42 : 35;
    const todayYmd = this._formatYmd(new Date());
    const selectedYmd = this._formatYmd(this.calSelectedDate);

    for (let i = 0; i < totalCells; i++) {
      let cellDate;
      let isOtherMonth = false;

      if (i < firstDayIndex) {
        const prevDay = daysInPrevMonth - firstDayIndex + i + 1;
        cellDate = new Date(this.calYear, this.calMonth - 1, prevDay);
        isOtherMonth = true;
      } else if (i < firstDayIndex + daysInCurrentMonth) {
        const day = i - firstDayIndex + 1;
        cellDate = new Date(this.calYear, this.calMonth, day);
      } else {
        const nextDay = i - (firstDayIndex + daysInCurrentMonth) + 1;
        cellDate = new Date(this.calYear, this.calMonth + 1, nextDay);
        isOtherMonth = true;
      }

      const cellYmd = this._formatYmd(cellDate);
      const isToday = cellYmd === todayYmd;
      const isSelected = cellYmd === selectedYmd;
      const dayEvents = eventsByDate.get(cellYmd) || [];
      const hasEvents = dayEvents.length > 0;
      const isPastDay = cellDate.getTime() < (new Date()).setHours(0, 0, 0, 0);

      const cell = document.createElement('div');
      cell.className = 'sched-cal-day';
      if (isOtherMonth) cell.classList.add('other-month');
      if (isToday) cell.classList.add('today');
      if (isSelected) cell.classList.add('selected');
      if (hasEvents) {
        cell.classList.add('has-events');
        if (!isPastDay) cell.classList.add('busy-day');
      }

      cell.innerHTML = `
        <span>${cellDate.getDate()}</span>
        ${hasEvents ? '<span class="sched-day-dot"></span>' : ''}
      `;

      cell.addEventListener('click', () => {
        this.calSelectedDate = cellDate;
        this.renderCalendarView();
      });

      gridEl.appendChild(cell);
    }

    // Render detailed timeline & availability for selected day
    const selectedEvents = eventsByDate.get(selectedYmd) || [];
    this.renderCalendarDayDetail(this.calSelectedDate, selectedEvents);
  }

  renderCalendarDayDetail(date, dayEvents) {
    const detailEl = document.getElementById('schedCalDayDetail');
    if (!detailEl) return;

    const dateFormatted = date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    const now = new Date();
    const todayYmd = this._formatYmd(now);
    const selectedYmd = this._formatYmd(date);
    const isToday = selectedYmd === todayYmd;
    const isPastDate = selectedYmd < todayYmd;

    const hasEvents = dayEvents && dayEvents.length > 0;

    let availBadge = '';
    if (isPastDate) {
      availBadge = `<span class="sched-avail-badge" style="background: rgba(255, 255, 255, 0.08); color: var(--text-muted); border: 1px solid var(--border-subtle);">Past Date (Scheduling Closed)</span>`;
    } else if (hasEvents) {
      availBadge = `<span class="sched-avail-badge busy">Busy (${dayEvents.length} Event${dayEvents.length > 1 ? 's' : ''})</span>`;
    } else {
      availBadge = `<span class="sched-avail-badge free">Available (All Day Free)</span>`;
    }

    let contentHtml = '';

    if (isPastDate) {
      // Past dates: "+ Schedule Room on this Day" is completely disabled / removed
      if (!hasEvents) {
        contentHtml = `
          <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 1.5rem 0.5rem;">
            <p>This date is in the past. Scheduling is closed for past dates.</p>
          </div>
        `;
      } else {
        const cardsHtml = dayEvents
          .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
          .map((item) => {
            const start = new Date(item.startTime);
            const timeStr = !isNaN(start.getTime())
              ? start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
              : '';

            return `
              <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 0.65rem 0.85rem; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <div>
                  <div style="font-weight: 600; font-size: 0.875rem; color: var(--text-primary);">${this.escapeHtml(item.title)}</div>
                  <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.5rem; margin-top: 0.2rem;">
                    <span>${timeStr} (${item.durationMinutes || 30}m)</span>
                    <code style="font-family: var(--font-mono); color: var(--text-muted); background: var(--bg-app); padding: 1px 4px; border-radius: 3px;">${this.escapeHtml(item.roomCode || '')}</code>
                    <span class="badge badge-secondary" style="font-size: 0.65rem;">Ended</span>
                  </div>
                </div>
                <div style="display: flex; gap: 0.35rem; align-items: center; margin-left: auto;">
                  <button class="sched-cal-resched-btn sched-reschedule-btn" data-id="${item.id}" title="Reschedule to a future time">Reschedule</button>
                </div>
              </div>
            `;
          })
          .join('');

        contentHtml = `
          <div style="display: flex; flex-direction: column; gap: 0.55rem; margin-bottom: 0.5rem;">
            ${cardsHtml}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted); text-align: center; padding-top: 0.35rem;">
            Past date. Use Reschedule to move meetings to upcoming dates.
          </div>
        `;
      }
    } else {
      // Current or future dates: scheduling is active
      if (!hasEvents) {
        contentHtml = `
          <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 1.25rem 0.5rem;">
            <p style="margin-bottom: 0.75rem;">No meetings scheduled on this date. You have full availability.</p>
            <button id="schedCalBookDayBtn" class="btn btn-primary btn-sm" type="button">
              + Schedule Room on this Day
            </button>
          </div>
        `;
      } else {
        const cardsHtml = dayEvents
          .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
          .map((item) => {
            const start = new Date(item.startTime);
            const timeStr = !isNaN(start.getTime())
              ? start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
              : '';
            const isPast = !isNaN(start.getTime()) && start.getTime() < now.getTime();

            return `
              <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 0.65rem 0.85rem; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <div>
                  <div style="font-weight: 600; font-size: 0.875rem; color: var(--text-primary);">${this.escapeHtml(item.title)}</div>
                  <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.5rem; margin-top: 0.2rem;">
                    <span>${timeStr} (${item.durationMinutes || 30}m)</span>
                    <code style="font-family: var(--font-mono); color: var(--accent-blue); background: var(--bg-app); padding: 1px 4px; border-radius: 3px;">${this.escapeHtml(item.roomCode || '')}</code>
                    ${isPast ? '<span class="badge badge-secondary" style="font-size: 0.65rem;">Missed</span>' : ''}
                  </div>
                </div>
                <div style="display: flex; gap: 0.35rem; align-items: center; margin-left: auto;">
                  ${!isPast ? `<button class="sched-cal-join-btn btn btn-primary btn-sm" data-code="${this.escapeHtml(item.roomCode || '')}">Join</button>` : ''}
                  ${isPast ? `<button class="sched-cal-resched-btn sched-reschedule-btn" data-id="${item.id}">Reschedule</button>` : ''}
                  ${!isPast ? `<button class="sched-cal-ics-btn btn btn-secondary btn-sm" data-id="${item.id}">.ics</button>` : ''}
                </div>
              </div>
            `;
          })
          .join('');

        contentHtml = `
          <div style="display: flex; flex-direction: column; gap: 0.55rem; margin-bottom: 0.85rem;">
            ${cardsHtml}
          </div>
          <div style="display: flex; justify-content: flex-end;">
            <button id="schedCalBookDayBtn" class="btn btn-secondary btn-sm" type="button">
              + Schedule Another Room on this Day
            </button>
          </div>
        `;
      }
    }

    detailEl.innerHTML = `
      <div class="sched-cal-detail-header">
        <div>
          <strong style="font-size: 0.95rem; color: var(--text-primary); display: block;">${dateFormatted}</strong>
          <span style="font-size: 0.75rem; color: var(--text-muted);">Availability Status</span>
        </div>
        ${availBadge}
      </div>
      ${contentHtml}
    `;

    // Bind "+ Schedule Room on this Day" only if rendered (future dates only)
    const bookBtn = detailEl.querySelector('#schedCalBookDayBtn');
    if (bookBtn) {
      bookBtn.addEventListener('click', async () => {
        const dateInput = document.getElementById('schedDate');
        const timeInput = document.getElementById('schedTime');
        const durationInput = document.getElementById('schedDuration');
        const desiredDuration = parseInt(durationInput?.value, 10) || 30;

        // Automatically find earliest non-overlapping slot on this date
        const slot = await this.findNextAvailableSlot(selectedYmd, desiredDuration);

        if (dateInput) {
          dateInput.min = todayYmd;
          dateInput.value = slot.dateStr;
        }

        if (timeInput) {
          timeInput.value = slot.timeStr;
        }

        this.switchTab('create');
        this.checkLiveOverlap();
        document.getElementById('schedTime')?.focus();
      });
    }

    // Bind Join buttons
    detailEl.querySelectorAll('.sched-cal-join-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const code = btn.getAttribute('data-code');
        if (code) {
          const item = dayEvents.find((e) => e.roomCode === code);
          let apiEndpoint = null;
          if (item && item.location) {
            const hashIdx = item.location.indexOf('#');
            if (hashIdx !== -1) {
              const hashParams = new URLSearchParams(item.location.substring(hashIdx + 1));
              apiEndpoint = hashParams.get('api');
            }
          }
          if (!apiEndpoint) {
            await this.engine.updateSignalingSettings();
            if (this.engine.cachedApiEnabled && this.engine.cachedApiEndpoint) {
              apiEndpoint = this.engine.cachedApiEndpoint;
            }
          }

          this.closeModal();

          if (apiEndpoint && window.setuWizard && window.setuWizard.joinApiMeeting) {
            await window.setuWizard.joinApiMeeting(code, apiEndpoint);
          } else {
            const input = document.getElementById('welcomeRoomCodeInput');
            if (input) input.value = code;
            const joinBtn = document.getElementById('welcomeJoinRoomBtn');
            if (joinBtn) joinBtn.click();
          }
        }
      });
    });

    // Bind Reschedule buttons
    detailEl.querySelectorAll('.sched-cal-resched-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const item = dayEvents.find((e) => e.id === id);
        if (item) this.rescheduleMeeting(item);
      });
    });

    // Bind Export .ics buttons
    detailEl.querySelectorAll('.sched-cal-ics-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const item = dayEvents.find((e) => e.id === id);
        if (item) {
          await this.engine.updateSignalingSettings();
          this.engine.downloadIcs(item);
        }
      });
    });
  }

  getFormData() {
    const titleInput = document.getElementById('schedTitle');
    const dateInput = document.getElementById('schedDate');
    const timeInput = document.getElementById('schedTime');
    const durationInput = document.getElementById('schedDuration');
    const roomCodeInput = document.getElementById('schedRoomCode');
    const notesInput = document.getElementById('schedNotes');

    const title = titleInput?.value.trim() || 'Setu P2P Meeting';
    const dateStr = dateInput?.value;
    const timeStr = timeInput?.value;
    const duration = parseInt(durationInput?.value, 10) || 30;
    const roomCode = roomCodeInput?.value.trim().toUpperCase() || '';
    const notes = notesInput?.value.trim() || '';

    if (!dateStr || !timeStr) {
      if (window.showToast) window.showToast('Please specify meeting date and start time');
      return null;
    }

    if (!roomCode) {
      if (window.showToast) window.showToast('Please provide or generate a room code');
      return null;
    }

    const startDateTime = new Date(`${dateStr}T${timeStr}`);
    if (isNaN(startDateTime.getTime())) {
      if (window.showToast) window.showToast('Invalid meeting date or time format');
      return null;
    }

    const now = new Date();
    if (startDateTime.getTime() <= now.getTime()) {
      if (window.showToast) window.showToast('Scheduled meeting must be set to a future date & time');
      return null;
    }

    return {
      title,
      startTime: startDateTime.toISOString(),
      durationMinutes: duration,
      roomCode,
      notes,
      location: this.engine.getMeetingJoinUrl({ roomCode })
    };
  }

  async handleSaveAndExportIcs() {
    await this.engine.updateSignalingSettings();
    const meeting = this.getFormData();
    if (!meeting) return;

    const conflict = await this.checkOverlap(meeting);
    if (conflict.conflict) {
      const m = conflict.conflictingMeeting;
      const mStart = new Date(m.startTime);
      const mEnd = new Date(mStart.getTime() + ((m.durationMinutes || 30) * 60000));
      const startStr = mStart.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const endStr = mEnd.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      if (window.showToast) {
        window.showToast(`Cannot schedule: overlaps with "${m.title}" (${startStr} - ${endStr})`);
      }
      this.checkLiveOverlap();
      return;
    }

    await this.engine.storage.saveSchedule(meeting);
    this.engine.downloadIcs(meeting);

    if (window.showToast) window.showToast('Meeting saved & .ics calendar invitation downloaded');
    this.refreshScheduleList();
    if (this.activeTab === 'calendar') this.renderCalendarView();
  }

  async handleOpenGoogleCalendar() {
    await this.engine.updateSignalingSettings();
    const meeting = this.getFormData();
    if (!meeting) return;

    const conflict = await this.checkOverlap(meeting);
    if (conflict.conflict) {
      const m = conflict.conflictingMeeting;
      const mStart = new Date(m.startTime);
      const mEnd = new Date(mStart.getTime() + ((m.durationMinutes || 30) * 60000));
      const startStr = mStart.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const endStr = mEnd.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      if (window.showToast) {
        window.showToast(`Cannot schedule: overlaps with "${m.title}" (${startStr} - ${endStr})`);
      }
      this.checkLiveOverlap();
      return;
    }

    await this.engine.storage.saveSchedule(meeting);
    const url = this.engine.buildGoogleCalendarUrl(meeting);
    window.open(url, '_blank', 'noopener,noreferrer');

    if (window.showToast) window.showToast('Opening Google Calendar...');
    this.refreshScheduleList();
    if (this.activeTab === 'calendar') this.renderCalendarView();
  }

  async handleOpenOutlook() {
    await this.engine.updateSignalingSettings();
    const meeting = this.getFormData();
    if (!meeting) return;

    const conflict = await this.checkOverlap(meeting);
    if (conflict.conflict) {
      const m = conflict.conflictingMeeting;
      const mStart = new Date(m.startTime);
      const mEnd = new Date(mStart.getTime() + ((m.durationMinutes || 30) * 60000));
      const startStr = mStart.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const endStr = mEnd.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      if (window.showToast) {
        window.showToast(`Cannot schedule: overlaps with "${m.title}" (${startStr} - ${endStr})`);
      }
      this.checkLiveOverlap();
      return;
    }

    await this.engine.storage.saveSchedule(meeting);
    const url = this.engine.buildOutlookCalendarUrl(meeting);
    window.open(url, '_blank', 'noopener,noreferrer');

    if (window.showToast) window.showToast('Opening Outlook Calendar...');
    this.refreshScheduleList();
    if (this.activeTab === 'calendar') this.renderCalendarView();
  }

  async handleEmailInvite() {
    await this.engine.updateSignalingSettings();
    const meeting = this.getFormData();
    if (!meeting) return;

    const conflict = await this.checkOverlap(meeting);
    if (conflict.conflict) {
      const m = conflict.conflictingMeeting;
      const mStart = new Date(m.startTime);
      const mEnd = new Date(mStart.getTime() + ((m.durationMinutes || 30) * 60000));
      const startStr = mStart.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const endStr = mEnd.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      if (window.showToast) {
        window.showToast(`Cannot schedule: overlaps with "${m.title}" (${startStr} - ${endStr})`);
      }
      this.checkLiveOverlap();
      return;
    }

    await this.engine.storage.saveSchedule(meeting);
    const mailto = this.engine.buildEmailShareUrl(meeting);
    window.location.href = mailto;

    if (window.showToast) window.showToast('Opening default email client...');
    this.refreshScheduleList();
    if (this.activeTab === 'calendar') this.renderCalendarView();
  }

  async handleCopyInvite() {
    await this.engine.updateSignalingSettings();
    const meeting = this.getFormData();
    if (!meeting) return;

    const conflict = await this.checkOverlap(meeting);
    if (conflict.conflict) {
      const m = conflict.conflictingMeeting;
      const mStart = new Date(m.startTime);
      const mEnd = new Date(mStart.getTime() + ((m.durationMinutes || 30) * 60000));
      const startStr = mStart.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const endStr = mEnd.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      if (window.showToast) {
        window.showToast(`Cannot schedule: overlaps with "${m.title}" (${startStr} - ${endStr})`);
      }
      this.checkLiveOverlap();
      return;
    }

    await this.engine.storage.saveSchedule(meeting);
    const text = this.engine.buildInvitationText(meeting);

    try {
      await navigator.clipboard.writeText(text);
      if (window.showToast) window.showToast('Full invitation copied to clipboard');
    } catch (err) {
      if (window.showToast) window.showToast('Failed to copy. Please copy manually.');
    }
    this.refreshScheduleList();
    if (this.activeTab === 'calendar') this.renderCalendarView();
  }

  async handleImportFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = this.engine.parseIcs(text);

      if (!parsed) {
        if (window.showToast) window.showToast('Could not find valid iCalendar events in file');
        return;
      }

      const conflict = await this.checkOverlap(parsed);
      if (conflict.conflict) {
        const m = conflict.conflictingMeeting;
        const mStart = new Date(m.startTime);
        const mEnd = new Date(mStart.getTime() + ((m.durationMinutes || 30) * 60000));
        const startStr = mStart.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const endStr = mEnd.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        if (window.showToast) {
          window.showToast(`Cannot import: overlaps with existing meeting "${m.title}" (${startStr} - ${endStr})`);
        }
        return;
      }

      await this.engine.storage.saveSchedule(parsed);
      if (window.showToast) window.showToast(`Imported: "${parsed.title}" successfully`);

      this.switchTab('upcoming');
    } catch (err) {
      console.error('[Schedule] Import error:', err);
      if (window.showToast) window.showToast('Error importing .ics calendar file');
    }
  }

  async refreshScheduleList() {
    const upcomingContainer = document.getElementById('schedUpcomingList');
    const missedContainer = document.getElementById('schedMissedList');
    const upcomingCountBadge = document.getElementById('schedUpcomingCountBadge');
    const missedCountBadge = document.getElementById('schedMissedCountBadge');

    const list = await this.engine.storage.getAllSchedules();
    const now = Date.now();

    const upcomingList = [];
    const missedList = [];

    list.forEach((item) => {
      const start = new Date(item.startTime).getTime();
      if (!isNaN(start) && start < now) {
        missedList.push(item);
      } else {
        upcomingList.push(item);
      }
    });

    upcomingList.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    missedList.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    if (upcomingCountBadge) upcomingCountBadge.textContent = upcomingList.length;
    if (missedCountBadge) missedCountBadge.textContent = missedList.length;

    if (upcomingContainer) {
      this._renderUpcomingCards(upcomingContainer, upcomingList);
    }
    if (missedContainer) {
      this._renderMissedCards(missedContainer, missedList);
    }
  }

  _renderUpcomingCards(container, list) {
    if (!list || list.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 2.5rem 1rem;">
          No upcoming scheduled meetings. Use the Schedule Room tab to create one.
        </div>
      `;
      return;
    }

    container.innerHTML = '';

    list.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'schedule-card';

      const startDate = new Date(item.startTime);
      const dateFormatted = isNaN(startDate.getTime())
        ? item.startTime
        : startDate.toLocaleDateString(undefined, {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          });
      const timeFormatted = isNaN(startDate.getTime())
        ? ''
        : startDate.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit'
          });

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.4rem;">
          <div>
            <strong style="font-size: 0.95rem; color: var(--text-primary); display: block;">${this.escapeHtml(item.title)}</strong>
            <span style="font-size: 0.775rem; color: var(--text-muted);">
              ${dateFormatted} at ${timeFormatted} (${item.durationMinutes || 30} mins)
            </span>
          </div>
          <button class="sched-del-btn tool-icon-btn" title="Delete meeting" style="width: 26px; height: 26px; color: var(--accent-rose);">✕</button>
        </div>

        <div style="font-size: 0.8rem; margin-bottom: 0.6rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <span style="color: var(--text-secondary);">Room:</span>
          <code style="font-family: var(--font-mono); color: var(--accent-blue); background: var(--bg-surface); padding: 2px 6px; border-radius: var(--radius-sm); font-size: 0.775rem;">${this.escapeHtml(item.roomCode || 'N/A')}</code>
          ${item.notes ? `<span style="font-size: 0.75rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px;" title="${this.escapeHtml(item.notes)}">— ${this.escapeHtml(item.notes)}</span>` : ''}
        </div>

        <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: auto; padding-top: 0.4rem; border-top: 1px solid var(--border-subtle);">
          <button class="sched-join-btn btn btn-primary btn-sm" style="flex: 1; min-width: 90px;">Join Room</button>
          <button class="sched-ics-btn btn btn-secondary btn-sm" title="Download .ics calendar file">Export .ics</button>
          <button class="sched-gcal-btn btn btn-secondary btn-sm" title="Add to Google Calendar">Google</button>
          <button class="sched-outlook-btn btn btn-secondary btn-sm" title="Add to Outlook Calendar">Outlook</button>
          <button class="sched-email-btn btn btn-secondary btn-sm" title="Send email invitation">Email</button>
          <button class="sched-copy-btn btn btn-secondary btn-sm" title="Copy invitation details">Copy</button>
        </div>
      `;

      card.querySelector('.sched-join-btn')?.addEventListener('click', async () => {
        if (item.roomCode) {
          let apiEndpoint = null;
          if (item.location) {
            const hashIdx = item.location.indexOf('#');
            if (hashIdx !== -1) {
              const hashParams = new URLSearchParams(item.location.substring(hashIdx + 1));
              apiEndpoint = hashParams.get('api');
            }
          }
          if (!apiEndpoint) {
            await this.engine.updateSignalingSettings();
            if (this.engine.cachedApiEnabled && this.engine.cachedApiEndpoint) {
              apiEndpoint = this.engine.cachedApiEndpoint;
            }
          }

          this.closeModal();

          if (apiEndpoint && window.setuWizard && window.setuWizard.joinApiMeeting) {
            await window.setuWizard.joinApiMeeting(item.roomCode, apiEndpoint);
          } else {
            const input = document.getElementById('welcomeRoomCodeInput');
            if (input) input.value = item.roomCode;
            const joinBtn = document.getElementById('welcomeJoinRoomBtn');
            if (joinBtn) joinBtn.click();
          }
        }
      });

      card.querySelector('.sched-ics-btn')?.addEventListener('click', async () => {
        await this.engine.updateSignalingSettings();
        this.engine.downloadIcs(item);
      });

      card.querySelector('.sched-gcal-btn')?.addEventListener('click', async () => {
        await this.engine.updateSignalingSettings();
        const url = this.engine.buildGoogleCalendarUrl(item);
        window.open(url, '_blank', 'noopener,noreferrer');
      });

      card.querySelector('.sched-outlook-btn')?.addEventListener('click', async () => {
        await this.engine.updateSignalingSettings();
        const url = this.engine.buildOutlookCalendarUrl(item);
        window.open(url, '_blank', 'noopener,noreferrer');
      });

      card.querySelector('.sched-email-btn')?.addEventListener('click', async () => {
        await this.engine.updateSignalingSettings();
        const mailto = this.engine.buildEmailShareUrl(item);
        window.location.href = mailto;
      });

      card.querySelector('.sched-copy-btn')?.addEventListener('click', async () => {
        await this.engine.updateSignalingSettings();
        const text = this.engine.buildInvitationText(item);
        try {
          await navigator.clipboard.writeText(text);
          if (window.showToast) window.showToast('Invitation copied to clipboard');
        } catch (e) {
          if (window.showToast) window.showToast('Failed to copy invitation');
        }
      });

      card.querySelector('.sched-del-btn')?.addEventListener('click', async () => {
        await this.engine.storage.deleteSchedule(item.id);
        this.refreshScheduleList();
        if (window.showToast) window.showToast('Meeting removed from schedule');
      });

      container.appendChild(card);
    });
  }

  _renderMissedCards(container, list) {
    if (!list || list.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 2.5rem 1rem;">
          No missed or past events. All scheduled meetings are current.
        </div>
      `;
      return;
    }

    container.innerHTML = '';

    list.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'schedule-card';

      const startDate = new Date(item.startTime);
      const dateFormatted = isNaN(startDate.getTime())
        ? item.startTime
        : startDate.toLocaleDateString(undefined, {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          });
      const timeFormatted = isNaN(startDate.getTime())
        ? ''
        : startDate.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit'
          });

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.4rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
              <strong style="font-size: 0.95rem; color: var(--text-primary);">${this.escapeHtml(item.title)}</strong>
              <span class="badge badge-secondary" style="font-size: 0.65rem; color: var(--accent-rose);">Missed</span>
            </div>
            <span style="font-size: 0.775rem; color: var(--text-muted);">
              Was scheduled for ${dateFormatted} at ${timeFormatted} (${item.durationMinutes || 30} mins)
            </span>
          </div>
          <button class="sched-del-btn tool-icon-btn" title="Delete meeting" style="width: 26px; height: 26px; color: var(--accent-rose);">✕</button>
        </div>

        <div style="font-size: 0.8rem; margin-bottom: 0.6rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <span style="color: var(--text-secondary);">Room:</span>
          <code style="font-family: var(--font-mono); color: var(--text-muted); background: var(--bg-surface); padding: 2px 6px; border-radius: var(--radius-sm); font-size: 0.775rem;">${this.escapeHtml(item.roomCode || 'N/A')}</code>
          ${item.notes ? `<span style="font-size: 0.75rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px;" title="${this.escapeHtml(item.notes)}">— ${this.escapeHtml(item.notes)}</span>` : ''}
        </div>

        <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: auto; padding-top: 0.4rem; border-top: 1px solid var(--border-subtle);">
          <button class="sched-resched-action-btn sched-reschedule-btn" style="flex: 1; min-width: 100px;">
            Reschedule Meeting
          </button>
        </div>
      `;

      card.querySelector('.sched-resched-action-btn')?.addEventListener('click', () => {
        this.rescheduleMeeting(item);
      });

      card.querySelector('.sched-del-btn')?.addEventListener('click', async () => {
        await this.engine.storage.deleteSchedule(item.id);
        this.refreshScheduleList();
        if (window.showToast) window.showToast('Meeting removed from schedule');
      });

      container.appendChild(card);
    });
  }

  async rescheduleMeeting(item) {
    if (!item) return;

    const titleInput = document.getElementById('schedTitle');
    const dateInput = document.getElementById('schedDate');
    const timeInput = document.getElementById('schedTime');
    const durationInput = document.getElementById('schedDuration');
    const roomCodeInput = document.getElementById('schedRoomCode');
    const notesInput = document.getElementById('schedNotes');

    const cleanTitle = (item.title || 'Meeting').replace(/^Rescheduled:\s*/i, '');
    if (titleInput) titleInput.value = `Rescheduled: ${cleanTitle}`;
    if (durationInput) durationInput.value = item.durationMinutes || 30;
    if (roomCodeInput) roomCodeInput.value = item.roomCode || '';
    if (notesInput) notesInput.value = item.notes || '';

    const now = new Date();
    const todayYmd = this._formatYmd(now);

    if (dateInput) {
      dateInput.min = todayYmd;
    }

    const duration = item.durationMinutes || 30;
    // Guaranteed non-overlapping future time slot (excluding current meeting id):
    const slot = await this.findNextAvailableSlot(todayYmd, duration, item.id);

    if (dateInput) dateInput.value = slot.dateStr;
    if (timeInput) timeInput.value = slot.timeStr;

    this.switchTab('create');
    this.checkLiveOverlap();
    dateInput?.focus();

    if (window.showToast) {
      const formattedSlot = slot.candDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' at ' + slot.candDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      window.showToast(`Rescheduled to available slot: ${formattedSlot}`);
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Global initialization
window.setuScheduleEngine = new ScheduleEngine();
window.setuSchedule = new ScheduleUI(window.setuScheduleEngine);
