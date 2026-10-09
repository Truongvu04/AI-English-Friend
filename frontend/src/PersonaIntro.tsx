import { useMemo, useState, type CSSProperties } from "react";
import type { Persona } from "./services/api";
import { getPersonaCopy, introCopy, personaVisuals, type IntroLanguage } from "./personaConfig";
import "./PersonaIntro.css";

type PersonaIntroProps = {
  personas: Persona[];
  loading: boolean;
  error: string | null;
  onSelect: (persona: Persona) => void;
  selectingId: number | null;
};

const visualOrder = ["humorous", "serious", "empathetic", "motivating", "thoughtful"];

function getPersonaSlug(persona?: Persona) {
  return persona?.slug || persona?.name.toLowerCase().replace(/\s+friend$/i, "").replace(/\s+/g, "-") || "";
}

function IntroSkeleton({ label }: { label: string }) {
  return (
    <div className="persona-grid persona-grid-skeleton" aria-label={label}>
      {Array.from({ length: 5 }, (_, index) => (
        <div className="persona-skeleton-card" key={index} />
      ))}
    </div>
  );
}

export default function PersonaIntro({
  personas,
  loading,
  error,
  onSelect,
  selectingId,
}: PersonaIntroProps) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [language, setLanguage] = useState<IntroLanguage>(() => {
    try {
      return window.localStorage.getItem("introLanguage") === "vi" ? "vi" : "en";
    } catch {
      return "en";
    }
  });
  const copy = introCopy[language];
  const orderedPersonas = useMemo(
    () => [...personas].sort((left, right) => {
      const leftIndex = visualOrder.indexOf(getPersonaSlug(left));
      const rightIndex = visualOrder.indexOf(getPersonaSlug(right));
      return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
    }),
    [personas],
  );

  const highlightedSlug = activeSlug || getPersonaSlug(orderedPersonas[0]);
  const changeLanguage = (nextLanguage: IntroLanguage) => {
    setLanguage(nextLanguage);
    try {
      window.localStorage.setItem("introLanguage", nextLanguage);
    } catch {
      // Intro language remains session-local when storage is unavailable.
    }
  };

  return (
    <main className="persona-intro">
      <div className="intro-noise" aria-hidden="true" />
      <div className="intro-orb intro-orb-one" aria-hidden="true" />
      <div className="intro-orb intro-orb-two" aria-hidden="true" />
      <div className="intro-orb intro-orb-three" aria-hidden="true" />

      <header className="intro-header">
        <div className="intro-brand">
          <span className="intro-brand-mark"><i /><i /><i /></span>
          <span>
            <strong>AI English Friend</strong>
            <small>Conversation, your way</small>
          </span>
        </div>
        <div className="intro-header-right">
          <span className="intro-status"><i /> {copy.status}</span>
          <div className="intro-language-switch" role="group" aria-label="Intro language">
            <button type="button" aria-pressed={language === "en"} className={language === "en" ? "selected" : ""} onClick={() => changeLanguage("en")}>EN</button>
            <span aria-hidden="true">|</span>
            <button type="button" aria-pressed={language === "vi"} className={language === "vi" ? "selected" : ""} onClick={() => changeLanguage("vi")}>VI</button>
          </div>
        </div>
      </header>

      <section className="intro-hero" aria-labelledby="intro-title">
        <div className="intro-kicker"><span /> {copy.kicker} <span /></div>
        <h1 id="intro-title">{copy.headline.first}<br /><em>{copy.headline.second}</em></h1>
        <p>{copy.description.first}<br className="desktop-break" /> {copy.description.second}</p>
      </section>

      {loading ? <IntroSkeleton label={copy.loadingLabel} /> : error ? (
        <div className="intro-error" role="alert">
          <strong>{copy.errorTitle}</strong>
          <span>{error}</span>
        </div>
      ) : (
        <div className="persona-grid" role="list" aria-label={copy.friendsLabel}>
          {orderedPersonas.map((persona, index) => {
            const slug = getPersonaSlug(persona);
            const isActive = highlightedSlug === slug;
            const isSelecting = selectingId === persona.id;
            const visual = personaVisuals[slug as keyof typeof personaVisuals];
            const localized = getPersonaCopy(slug, language);
            const image = visual?.image || personaVisuals.thoughtful.image;
            const label = localized?.tag || persona.cardLabel || persona.tagline;
            const description = localized?.description || persona.shortDescription;
            const cta = persona.hasConversation ? copy.continue : copy.start;
            return (
              <article
                className={`persona-card persona-${slug} ${isActive ? "is-active" : ""} ${isSelecting ? "is-selecting" : ""}`}
                key={persona.id}
                style={{ "--card-index": index } as CSSProperties}
                onMouseEnter={() => setActiveSlug(slug)}
                onFocus={() => setActiveSlug(slug)}
                role="listitem"
              >
                <div className="persona-card-topline">
                  <span className="persona-number">0{index + 1}</span>
                  <span className="persona-availability">
                    <i /> {persona.hasConversation ? copy.yourFriend : copy.newFriend}
                  </span>
                </div>
                <div className="persona-visual">
                  <img
                    className="persona-character-image"
                    src={image}
                    alt={persona.name}
                    onError={(event) => { event.currentTarget.src = personaVisuals.thoughtful.image; }}
                  />
                </div>
                <div className="persona-copy">
                  <span className="persona-label">{label}</span>
                  <h2>{persona.name}</h2>
                  <p>{description}</p>
                </div>
                <button
                  type="button"
                  className="persona-cta"
                  onClick={() => onSelect(persona)}
                  disabled={selectingId !== null}
                >
                  <span>{isSelecting ? copy.opening : cta}</span>
                  <span className="persona-cta-arrow">↗</span>
                </button>
              </article>
            );
          })}
        </div>
      )}

      <footer className="intro-footer">
        <span>{copy.footerLeft}</span>
        <span className="intro-footer-line" />
        <span>{copy.footerRight}</span>
      </footer>
    </main>
  );
}
