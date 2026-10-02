'use strict';

/**
 * Geração inline de evento iCalendar (.ics) para anexar no email de agendamento.
 * Sem dependências.
 */

function pad(n) { return String(n).padStart(2, '0'); }

function toICSDate(d) {
  // Formato UTC: 20260523T143000Z
  const dt = new Date(d);
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T` +
         `${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}${pad(dt.getUTCSeconds())}Z`;
}

function escapeICS(text) {
  // RFC 5545: \, ;, \n precisam de escape
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * @param {object} ev
 * @param {string} ev.uid             — identificador único do evento
 * @param {Date|string} ev.startsAt
 * @param {number} ev.durationMinutes
 * @param {string} ev.title
 * @param {string} [ev.description]
 * @param {string} [ev.location]
 * @returns {string} conteúdo do .ics
 */
function buildICS(ev) {
  const start = new Date(ev.startsAt);
  const end   = new Date(start.getTime() + (ev.durationMinutes || 30) * 60 * 1000);
  const now   = new Date();

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RIS-PACS//Appointment//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.uid}@ris-pacs`,
    `DTSTAMP:${toICSDate(now)}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${escapeICS(ev.title)}`,
    ev.description ? `DESCRIPTION:${escapeICS(ev.description)}` : '',
    ev.location    ? `LOCATION:${escapeICS(ev.location)}`       : '',
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n') + '\r\n';
}

module.exports = { buildICS };
