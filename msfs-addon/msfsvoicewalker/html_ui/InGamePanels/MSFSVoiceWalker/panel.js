// MSFSVoiceWalker — In-Sim-Toolbar-Panel
//
// MSFS scannt html_ui/InGamePanels/<Name>/panel.html beim Start, wenn das
// Community-Paket eine gueltige layout.json hat. Damit das Panel von MSFS
// als Toolbar-Fenster registriert wird, muessen wir das Custom-Element
// <ingamepanel-msfsvoicewalker> korrekt via customElements.define()
// definieren — sonst ignoriert MSFS es.
//
// Zur Laufzeit:
//   Wir probieren Ports 7801..7810 auf 127.0.0.1 durch (die App sucht bei
//   belegtem Port automatisch einen freien). Der erste antwortende Port
//   wird in einem iframe geladen, das die overlay.html der lokalen App
//   einbindet. Fliegt die App weg, probieren wir wieder durch.

(function () {
  'use strict';

  class IngamePanelMSFSVoiceWalker extends HTMLElement {
    constructor() {
      super();
      this._connectedPort = null;
      this._probeTimer = null;
    }

    connectedCallback() {
      this._status = this.querySelector('#status');
      this._frame  = this.querySelector('#frame');
      this._probe();
      this._probeTimer = setInterval(() => this._probe(), 1500);
    }

    disconnectedCallback() {
      if (this._probeTimer) {
        clearInterval(this._probeTimer);
        this._probeTimer = null;
      }
    }

    async _probe() {
      // 1. Bereits verbunden? Pruefe ob der Port noch lebt.
      if (this._connectedPort !== null) {
        try {
          await fetch(
            `http://127.0.0.1:${this._connectedPort}/`,
            { method: 'GET', mode: 'no-cors' }
          );
          return;
        } catch {
          this._connectedPort = null;
          if (this._status) {
            this._status.classList.remove('hidden');
            this._status.textContent = 'Verbindung zur lokalen App verloren';
          }
          if (this._frame) this._frame.src = 'about:blank';
        }
      }

      // 2. Port-Scan 7801..7810
      for (let p = 7801; p <= 7810; p++) {
        try {
          await fetch(`http://127.0.0.1:${p}/`, { method: 'GET', mode: 'no-cors' });
          this._connectedPort = p;
          if (this._status) this._status.classList.add('hidden');
          if (this._frame)  this._frame.src = `http://127.0.0.1:${p}/overlay.html`;
          return;
        } catch {}
      }

      // Keiner antwortet
      if (this._status) {
        this._status.classList.remove('hidden');
        this._status.textContent =
          'Starte MSFSVoiceWalker (start.bat oder die App), ' +
          'damit das Overlay hier erscheint.';
      }
    }
  }

  // MSFS verlangt, dass das Custom-Element explizit registriert ist.
  if (!customElements.get('ingamepanel-msfsvoicewalker')) {
    customElements.define('ingamepanel-msfsvoicewalker', IngamePanelMSFSVoiceWalker);
  }
})();
