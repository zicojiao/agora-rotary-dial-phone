'use client';

import { useEffect } from 'react';
import AgoraCallController from './AgoraCallController';

export default function PhoneExperience() {
  useEffect(() => {
    void import('@/src/main');
  }, []);

  return (
    <main id="app">
      <canvas
        id="scene"
        aria-label="Agora interactive 1930s American Art Deco rotary telephone"
      />

      <header className="masthead">
        <aside className="instructions" aria-label="How to use the telephone">
          <p>
            <span>01</span> Lift the receiver to open the line
          </p>
          <p>
            <span>02</span> Dial the number marked on the Agora contact card
          </p>
          <p>
            <span>03</span> Reach the stop and release every digit
          </p>
        </aside>
        <div className="status" aria-live="polite">
          <span className="status-dot" />
          <span id="status-label">Receiver cradled</span>
        </div>
      </header>

      <p className="mobile-guide" aria-hidden="true">
        <span id="mobile-guide-step">01</span>
        <span id="mobile-guide-text">Lift the receiver to begin</span>
      </p>

      <aside
        className="mobile-contact-note"
        aria-label="Elon Musk AI telephone number"
      >
        <span>Agora AI line</span>
        <strong>Elon Musk AI</strong>
        <b>Dial 555-0193</b>
      </aside>

      <section className="dial-readout" aria-label="Dialing status">
        <p className="readout-label">Number registered</p>
        <output id="number-display" aria-live="polite">
          —
        </output>
        <div className="pulse-track" aria-hidden="true">
          <span id="pulse-progress" />
        </div>
      </section>

      <nav className="controls" aria-label="Telephone controls">
        <button id="receiver-button" type="button">
          <span id="receiver-action">Lift receiver</span>
          <span aria-hidden="true">↗</span>
        </button>
        <button id="clear-button" type="button">
          Clear dial
        </button>
      </nav>

      <p className="agora-signature">
        <span className="agora-signature-primary">Conversational AI</span>
        <span className="agora-signature-secondary">Powered by Agora</span>
      </p>

      <div id="loading" className="loading" role="status">
        <span className="loading-dial" aria-hidden="true" />
        <p
          className="loading-brand"
          aria-label="Conversational AI powered by Agora"
        >
          <span className="loading-brand-primary">
            Conversational <em>AI</em>
          </span>
          <span className="loading-brand-secondary">Powered by Agora</span>
        </p>
        <p className="loading-message">Opening the exchange…</p>
      </div>

      <div id="error-panel" className="error-panel" hidden>
        <p>The telephone exchange could not start the 3D scene.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>

      <AgoraCallController />
    </main>
  );
}
