import React from 'react';
import { Bot, FileText, ShieldCheck, X } from 'lucide-react';
import { ModalDialog } from './ModalDialog.tsx';

export type LegalTab = 'impressum' | 'privacy';

interface LegalDialogProps {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  isOpen: boolean;
  activeTab: LegalTab;
  onChangeTab: (tab: LegalTab) => void;
  onClose: () => void;
}

export function LegalDialog({
  dialogRef,
  isOpen,
  activeTab,
  onChangeTab,
  onClose,
}: LegalDialogProps) {
  const closeDialog = () => {
    dialogRef.current?.close();
    onClose();
  };

  return (
    <ModalDialog
      dialogRef={dialogRef}
      isOpen={isOpen}
      onClose={onClose}
      className="legal-dialog"
      aria-labelledby="legal-dialog-title"
    >
      <div className="dialog-header">
        <h2 id="legal-dialog-title">
          {activeTab === 'impressum' ? 'Impressum' : 'Datenschutz & KI-Hinweis'}
        </h2>
        <button
          type="button"
          className="btn-icon"
          onClick={closeDialog}
          aria-label="Schließen"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="legal-tabs" role="tablist" aria-label="Rechtliche Hinweise">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'impressum'}
          className={`btn-tab ${activeTab === 'impressum' ? 'is-active' : ''}`}
          onClick={() => onChangeTab('impressum')}
        >
          <FileText size={14} aria-hidden="true" />
          Impressum
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'privacy'}
          className={`btn-tab ${activeTab === 'privacy' ? 'is-active' : ''}`}
          onClick={() => onChangeTab('privacy')}
        >
          <ShieldCheck size={14} aria-hidden="true" />
          Datenschutz &amp; KI
        </button>
      </div>

      <div className="legal-body">
        {activeTab === 'impressum' ? (
          <>
            <section className="legal-section">
              <h3>Angaben gemäß § 5 DDG</h3>
              <p>
                Carsten Isert
                <br />
                Carsten Isert AI Labs
                <br />
                Theresienstr. 148d
                <br />
                80333 München
                <br />
                Deutschland
              </p>
            </section>

            <section className="legal-section">
              <h3>Kontakt</h3>
              <p>
                Telefon: +49 174 2842109
                <br />
                E-Mail: info@carsten-isert-ai-labs.de
              </p>
            </section>

            <section className="legal-section">
              <h3>Umsatzsteuer-ID</h3>
              <p>
                Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz: DE461272081
              </p>
            </section>

            <section className="legal-section">
              <h3>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h3>
              <p>Carsten Isert (Anschrift wie oben)</p>
            </section>

            <section className="legal-section">
              <h3>Streitbeilegung</h3>
              <p>
                Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer
                Verbraucherschlichtungsstelle teilzunehmen.
              </p>
            </section>

            <section className="legal-section">
              <h3>Haftung für Inhalte</h3>
              <p>
                Die Inhalte unserer Seiten wurden mit größter Sorgfalt erstellt. Für die
                Richtigkeit, Vollständigkeit und Aktualität der Inhalte können wir jedoch keine
                Gewähr übernehmen. Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene
                Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach den §§
                8 bis 10 DDG sind wir als Diensteanbieter jedoch nicht verpflichtet, übermittelte
                oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu
                forschen, die auf eine rechtswidrige Tätigkeit hinweisen. Verpflichtungen zur
                Entfernung oder Sperrung der Nutzung von Informationen nach den allgemeinen
                Gesetzen bleiben hiervon unberührt. Eine diesbezügliche Haftung ist jedoch erst ab
                dem Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich. Bei
                Bekanntwerden von entsprechenden Rechtsverletzungen werden wir diese Inhalte
                umgehend entfernen.
              </p>
            </section>

            <section className="legal-section">
              <h3>Haftung für Links</h3>
              <p>
                Unser Angebot enthält Links zu externen Webseiten Dritter, auf deren Inhalte wir
                keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine
                Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige
                Anbieter oder Betreiber der Seiten verantwortlich. Bei Bekanntwerden von
                Rechtsverletzungen werden wir derartige Links umgehend entfernen.
              </p>
            </section>

            <section className="legal-section">
              <h3>Hinweis zur Nutzung (Privates Lernprojekt)</h3>
              <p>
                Diese Anwendung („CAI Labs Learn Chinese“) ist ein nicht-kommerzielles Lernprojekt
                für geladene Freunde und Familie (Zugang nur per Einladungscode).
              </p>
            </section>
          </>
        ) : (
          <>
            <section className="legal-section legal-ai-box">
              <h3>
                <Bot size={16} aria-hidden="true" /> Transparenzhinweis gemäß EU AI Act (Art. 50)
              </h3>
              <p>
                Bei den Gesprächspartnern und der Aussprache- sowie Lernauswertung in dieser
                Anwendung handelt es sich um <strong>künstliche Intelligenz</strong> (Google Gemini
                Modelle). Alle gesprochenen Antworten, Audiodateien und Lerntexte werden
                synthetisch erzeugt – du sprichst nicht mit einem menschlichen Tutor.
              </p>
            </section>

            <section className="legal-section">
              <h3>1. Datenschutz auf einen Blick</h3>
              <p>
                Die folgenden Hinweise geben einen Überblick darüber, was mit deinen
                personenbezogenen Daten passiert, wenn du diese Anwendung nutzt.
              </p>
            </section>

            <section className="legal-section">
              <h3>2. Verantwortliche Stelle</h3>
              <p>
                Carsten Isert
                <br />
                Carsten Isert AI Labs
                <br />
                Theresienstr. 148d, 80333 München
                <br />
                E-Mail: info@carsten-isert-ai-labs.de
              </p>
            </section>

            <section className="legal-section">
              <h3>3. Hosting (Hetzner)</h3>
              <p>
                Diese Anwendung wird auf einem Server der Hetzner Online GmbH, Industriestr. 25,
                91710 Gunzenhausen, Deutschland, gehostet. Es besteht ein Vertrag über
                Auftragsverarbeitung (AVV). Server-Log-Dateien (IP-Adresse, Zeitstempel,
                abgerufene Pfade) werden zur technischen Sicherheit und Fehleranalyse auf Grundlage
                von Art. 6 Abs. 1 lit. f DSGVO verarbeitet.
              </p>
            </section>

            <section className="legal-section">
              <h3>4. Cookies</h3>
              <p>
                Diese Anwendung verwendet ausschließlich ein technisch notwendiges Session-Cookie (
                <code>lc_session</code>, HttpOnly, SameSite=Lax, Laufzeit 30 Tage), um dich nach
                dem Login angemeldet zu halten (Art. 6 Abs. 1 lit. b / f DSGVO, § 25 Abs. 2 Nr. 2
                TDDDG). Es werden keine Tracking-, Werbe- oder Analyse-Cookies eingesetzt.
              </p>
            </section>

            <section className="legal-section">
              <h3>5. Registrierung, Lerndaten &amp; Kontolöschung</h3>
              <p>
                Bei der Registrierung speichern wir deine E-Mail-Adresse, deinen Anzeigenamen und
                einen kryptografisch gehashten Passwort-Wert in einer lokalen SQLite-Datenbank auf
                dem Server. Während der Nutzung werden deine Lernfortschritte, Vokabeln,
                Gesprächspartner-Profile, Erinnerungsnotizen und Sitzungszusammenfassungen
                gespeichert (Art. 6 Abs. 1 lit. b DSGVO).
              </p>
              <p>
                Du kannst dein Konto und sämtliche zugehörigen Lerndaten jederzeit selbst im
                Benutzermenü unter <strong>„Konto löschen“</strong> unwiderruflich entfernen.
              </p>
            </section>

            <section className="legal-section">
              <h3>6. KI-Sprachverarbeitung über Google Gemini API</h3>
              <p>
                Für Live-Sprachgespräche, Aussprache-Checks, Vokabel-Audio (TTS) und
                Lernauswertungen übermittelt unser Server deine Spracheingaben (Mikrofon-Audio),
                Texteingaben sowie den notwendigen Lernkontext verschlüsselt an die{' '}
                <strong>Google Gemini API</strong> (Google Ireland Limited / Google LLC, USA).
                Dabei kann eine Datenübermittlung in die USA erfolgen (EU-US Data Privacy Framework
                bzw. Standardvertragsklauseln).
              </p>
              <p>
                <strong>Wichtiger Hinweis:</strong> Bitte teile in Sprachgesprächen oder
                Erinnerungsnotizen keine sensiblen persönlichen Daten (z. B. Gesundheits-,
                Finanz-, Passwort- oder Ausweisdaten).
              </p>
            </section>

            <section className="legal-section">
              <h3>7. Schriftarten</h3>
              <p>
                Es werden ausschließlich lokale System-Schriftarten verwendet. Es findet keine
                Verbindung zu Google Fonts statt.
              </p>
            </section>

            <section className="legal-section">
              <h3>8. Deine Rechte (DSGVO)</h3>
              <p>
                Du hast jederzeit das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16),
                Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18),
                Datenübertragbarkeit (Art. 20) sowie Widerspruch gegen die Verarbeitung (Art. 21
                DSGVO). Zudem steht dir ein Beschwerderecht bei der zuständigen Aufsichtsbehörde
                zu (Bayerisches Landesamt für Datenschutzaufsicht).
              </p>
            </section>
          </>
        )}
      </div>

      <div className="dialog-actions">
        <button type="button" className="btn-primary" onClick={closeDialog}>
          Schließen
        </button>
      </div>
    </ModalDialog>
  );
}
