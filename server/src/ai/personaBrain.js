const PERSONA_GUIDANCE = {
  humorous: "Use a light playful touch only when it softens the moment; never joke over distress.",
  serious: "Be calm, direct, grounded, and precise; avoid filler and forced cheer.",
  empathetic: "Acknowledge the user's feeling before advice; sound warm without becoming clinical.",
  motivating: "Notice effort and give one practical next step; encourage without slogans or pressure.",
  thoughtful: "Reflect briefly on the meaning or nuance, then offer one genuinely useful angle.",
};
function slug(name) { return String(name || "").toLowerCase().replace(/\s+friend$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function detectMood(message) {
  const value = String(message || "").toLowerCase();
  if (/(stressed|stress|overwhelmed|deadline|worried|anxious|panic|nervous)/.test(value)) return "stressed";
  if (/(sad|lonely|upset|terrible|awful|hurt|exhausted|tired|bad day)/.test(value)) return "low";
  if (/(excited|amazing|can't wait|cannot wait|!!!|so happy)/.test(value)) return "excited";
  if (/(happy|great|good news|love|thank you|thanks|glad)/.test(value)) return "positive";
  if (/(important|decision|serious|career|relationship|problem)/.test(value)) return "serious";
  if (/(why|meaning|think|wonder|perhaps|maybe)/.test(value)) return "reflective";
  return "neutral";
}
function detectIntent(message) {
  const value = String(message || "").trim();
  if (!value) return "unclear";
  if (value.endsWith("?")) return "question";
  if (/(please|can you|could you|teach me|help me|how do I|what does)/i.test(value)) return "request";
  if (/(feel|felt|sad|angry|stressed|worried|terrible|awful|hard day)/i.test(value)) return "venting";
  if (/(today|yesterday|this week|went|happened|just got|I am|I'm)/i.test(value)) return "update";
  if (value.split(/\s+/).length > 14) return "story";
  return "conversation";
}
function correctionGuidance(personaSlug, { familiarity, mood, explicitCorrection }) {
  const correctionNeed = explicitCorrection
    ? "The learner asked for correction, so answer the correction request directly."
    : "Correct only when meaning is broken or the mistake is obvious and naturally noticeable; do not correct every minor error.";
  if (personaSlug === "humorous") {
    if (familiarity === "new") return `${correctionNeed} Keep the correction light and friendly; do not roast a new learner.`;
    if (["low", "stressed", "serious"].includes(mood)) return `${correctionNeed} Use a warm, plain correction with teasing disabled because the learner may need care.`;
    return `${correctionNeed} With a familiar learner in a normal, positive, or excited mood, a brief close-friend tease is allowed, but vary it and never embarrass them.`;
  }
  const styles = {
    serious: "Use one short, direct, confident natural alternative, then continue the conversation.",
    empathetic: "Respond to the meaning first when appropriate, then correct gently and without judgment.",
    motivating: "Keep the correction brief and encouraging; frame it as progress, never as a score or lesson.",
    thoughtful: "Offer one calm, concise natural alternative, then return to the user's idea.",
  };
  return `${correctionNeed} ${styles[personaSlug] || styles.thoughtful}`;
}
export function buildPersonaBrain({ persona, currentMessage, recentMessages = [], level, summary, relationship }) {
  const personaSlug = slug(persona?.name);
  const mood = detectMood(currentMessage);
  const intent = detectIntent(currentMessage);
  const recentAssistantQuestions = recentMessages.slice(-4).filter((item) => item.role === "assistant" && /\?\s*$/.test(item.content || "")).length;
  const askQuestion = intent === "question" || intent === "request" || (recentAssistantQuestions === 0 && ["conversation", "update", "story"].includes(intent) && String(currentMessage).length > 20);
  const familiarity = relationship?.familiarity || "familiar";
  const explicitCorrection = /(correct|correction|grammar|mistake|natural way|is this right|teach me)/i.test(currentMessage);
  const correctionStyle = correctionGuidance(personaSlug, { familiarity, mood, explicitCorrection });
  return {
    personaSlug, familiarity, mood, intent, explicitCorrection, correctionStyle, askQuestion,
    guidance: [
      "RUNTIME PERSONA BRAIN (ephemeral guidance):",
      `Relationship familiarity: ${familiarity}. CEFR: ${level}.`,
      `Current social signal: ${mood}. Conversation intent: ${intent}.`,
      PERSONA_GUIDANCE[personaSlug] || PERSONA_GUIDANCE.thoughtful,
      "FINAL CORRECTION POLICY: Be a friend first. Correct a meaning-breaking or clearly obvious/naturally noticeable mistake, or correct when explicitly asked. Keep it to one short natural correction and continue the conversation. Do not teach every minor error.",
      correctionStyle,
      askQuestion ? "A single specific follow-up may help if it feels natural." : "Do not end with a question this turn; respond fully or leave space for the learner to continue.",
      summary ? "Use the earlier summary only when it is relevant to this turn." : "There is no earlier summary; stay grounded in this turn.",
    ].join("\n"),
  };
}
