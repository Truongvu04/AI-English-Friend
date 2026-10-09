import { useCallback, useEffect, useState } from "react";
import App from "./App";
import PersonaIntro from "./PersonaIntro";
import {
  getPersonaThread,
  getPersonas,
  type Persona,
  type PersonaThreadResponse,
  type StoredMessage,
} from "./services/api";

function mapThreadMessages(thread: PersonaThreadResponse): StoredMessage[] {
  return thread.messages;
}

export default function ExperienceRoot() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [selectedThread, setSelectedThread] = useState<PersonaThreadResponse | null>(null);
  const [selectingId, setSelectingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPersonas()
      .then(({ personas: nextPersonas }) => {
        if (!cancelled) setPersonas(nextPersonas);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : "Unable to load AI friends");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const openPersona = useCallback(async (persona: Persona) => {
    setSelectingId(persona.id);
    setError(null);
    try {
      const thread = await getPersonaThread(persona.id);
      setSelectedPersona(thread.persona);
      setSelectedThread({ ...thread, messages: mapThreadMessages(thread) });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to open this AI friend");
    } finally {
      setSelectingId(null);
    }
  }, []);

  const returnToIntro = useCallback(() => {
    setSelectedPersona(null);
    setSelectedThread(null);
  }, []);

  if (selectedPersona && selectedThread) {
    return (
      <App
        key={selectedPersona.id}
        persona={selectedPersona}
        initialThread={selectedThread}
        onBackToPersonas={returnToIntro}
      />
    );
  }

  return (
    <PersonaIntro
      personas={personas}
      loading={loading}
      error={error}
      onSelect={openPersona}
      selectingId={selectingId}
    />
  );
}
