/**
 * G-Sim Events JavaScript SDK — single-file ES module.
 *
 * Wrapper um die /wp-json/gsim-events/v1/-REST-API. Keine Dependencies.
 *
 * @example
 *   import { GsimEvents } from './gsim-events.js';
 *   const api = new GsimEvents({ base: 'https://www.gsimulations.de' });
 *   const upcoming = await api.listEvents({ upcoming: true });
 *
 * @example authenticated (Veranstalter erstellt Event)
 *   const api = new GsimEvents({
 *     base: 'https://www.gsimulations.de',
 *     auth: { user: 'paddy211185', appPassword: 'XXXX XXXX XXXX' }
 *   });
 *   const ev = await api.createEvent({
 *     title: 'Salzburg Rundflug',
 *     description: 'Rundflug um LOWS',
 *     start: '2026-05-20T18:00:00+02:00',
 *     end:   '2026-05-20T20:00:00+02:00',
 *     status: 'publish',
 *   });
 *   await api.createTicket(ev.id, { name: 'Standard', price: 0 });
 */

const API_VERSION = 'v1';

export class GsimEventsError extends Error {
  constructor(code, message, status) {
    super(`[gsim-events:${code}] ${message}`);
    this.name = 'GsimEventsError';
    this.code = code;
    this.status = status;
  }
}

export class GsimEvents {
  /**
   * @param {object} opts
   * @param {string} opts.base         Basis-URL des WordPress-Servers (ohne trailing /).
   * @param {object} [opts.auth]       Auth-Credentials für schreibende Requests.
   * @param {string} opts.auth.user    WP-Username (z. B. "paddy211185").
   * @param {string} opts.auth.appPassword WP-Anwendungspasswort (mit oder ohne Spaces).
   * @param {function} [opts.fetch]    Custom fetch-Implementation (fuer Node <18).
   */
  constructor({ base, auth, fetch: customFetch } = {}) {
    if (!base) throw new Error('GsimEvents: "base" URL is required');
    this.base = base.replace(/\/+$/, '');
    this.apiBase = `${this.base}/wp-json/gsim-events/${API_VERSION}`;
    this.auth = auth || null;
    this._fetch = customFetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    if (!this._fetch) throw new Error('GsimEvents: no fetch available; pass opts.fetch');
  }

  _authHeader() {
    if (!this.auth) return null;
    const pass = (this.auth.appPassword || '').replace(/\s+/g, '');
    const token = btoa(`${this.auth.user}:${pass}`);
    return `Basic ${token}`;
  }

  async _request(method, path, { params, body } = {}) {
    let url = `${this.apiBase}${path}`;
    if (params) {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined));
      const q = qs.toString();
      if (q) url += (url.includes('?') ? '&' : '?') + q;
    }
    const headers = { 'Accept': 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const authHeader = this._authHeader();
    if (authHeader) headers['Authorization'] = authHeader;
    const res = await this._fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const code = (data && data.code) || 'http_error';
      const msg  = (data && data.message) || res.statusText;
      throw new GsimEventsError(code, msg, res.status);
    }
    return data;
  }

  // ----- Read ------------------------------------------------------------

  /** List events. @param {{per_page?:number, offset?:number, upcoming?:boolean}} [opts] */
  listEvents(opts = {}) {
    return this._request('GET', '/events', { params: opts });
  }

  /** Single event by numeric ID. */
  getEvent(id) {
    return this._request('GET', `/events/${id}`);
  }

  // ----- Write (require organizer auth) ----------------------------------

  /**
   * Create event.
   * @param {object} data
   * @param {string} data.title
   * @param {string} [data.description]
   * @param {string} [data.start]     ISO-8601
   * @param {string} [data.end]       ISO-8601
   * @param {('draft'|'publish')} [data.status='draft']
   */
  createEvent(data) {
    return this._request('POST', '/events', { body: data });
  }

  updateEvent(id, data) {
    return this._request('PUT', `/events/${id}`, { body: data });
  }

  deleteEvent(id) {
    return this._request('DELETE', `/events/${id}`);
  }

  listAttendees(eventId) {
    return this._request('GET', `/events/${eventId}/attendees`);
  }

  /**
   * Create a ticket (WC product) for an event.
   * @param {number} eventId
   * @param {object} data
   * @param {string} [data.name]
   * @param {number} data.price
   * @param {number} [data.capacity]
   * @param {string} [data.description]
   */
  createTicket(eventId, data) {
    return this._request('POST', `/events/${eventId}/tickets`, { body: data });
  }

  // ----- Helpers ---------------------------------------------------------

  /** Build an app join URL from a passphrase (local-app schema). */
  static joinUrl(passphrase, { appBase = 'http://127.0.0.1:7801' } = {}) {
    return `${appBase}/?join=${encodeURIComponent(passphrase)}`;
  }
}

export default GsimEvents;
