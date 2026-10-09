const stopWords = new Set(["about", "after", "again", "also", "because", "been", "being", "could", "from", "have", "into", "just", "like", "more", "only", "should", "some", "that", "their", "there", "these", "they", "this", "want", "what", "when", "where", "which", "with", "would", "your"]);
const temporalWords = new Set(["today", "tomorrow", "yesterday", "tonight", "morning", "evening", "week", "month", "soon", "later", "next", "deadline"]);
const emotionalWords = new Set(["nervous", "worried", "anxious", "stressed", "excited", "sad", "happy", "upset", "proud", "relieved"]);
const ongoingTypes = new Set(["goal", "project", "personal_fact", "interest"]);

export function tokenizeContext(value) {
  return new Set(String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).map((token) => token.replace(/(ing|ed|es|s)$/i, "")).filter((token) => token.length > 2 && !stopWords.has(token)));
}

function normalizedWords(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

function sharedPhraseCount(left, right) {
  const leftWords = normalizedWords(left);
  const rightText = normalizedWords(right).join(" ");
  let count = 0;
  for (let index = 0; index < leftWords.length - 1; index += 1) {
    const phrase = `${leftWords[index]} ${leftWords[index + 1]}`;
    if (phrase.length > 5 && rightText.includes(phrase)) count += 1;
  }
  return count;
}

function contextualRelation(message, memory) {
  const messageWords = new Set(normalizedWords(message));
  const memoryWords = new Set(normalizedWords(memory.content));
  const sharedTemporal = [...temporalWords].some((word) => messageWords.has(word) && memoryWords.has(word));
  const sharedEmotion = [...emotionalWords].some((word) => messageWords.has(word)) && [...temporalWords].some((word) => memoryWords.has(word));
  const eventMemory = /\b(interview|deadline|exam|appointment|trip|meeting|launch|plan|project|goal)\b/i.test(memory.content);
  const ongoingType = ongoingTypes.has(String(memory.memory_type || "").toLowerCase());
  return (sharedTemporal && eventMemory) || (sharedEmotion && (eventMemory || ongoingType));
}

export function selectRelevantMemories(currentMessage, memories, limit = 5) {
  const messageTokens = tokenizeContext(currentMessage);
  return memories.map((memory) => {
    const memoryTokens = tokenizeContext(memory.content);
    const overlap = [...memoryTokens].filter((token) => messageTokens.has(token)).length;
    const phraseOverlap = sharedPhraseCount(currentMessage, memory.content);
    const contextual = contextualRelation(currentMessage, memory);
    const overlapRatio = messageTokens.size ? overlap / messageTokens.size : 0;
    const importance = Number(memory.importance) || 0;
    const ageDays = memory.updated_at ? Math.max(0, (Date.now() - new Date(memory.updated_at).getTime()) / 86_400_000) : 365;
    const recencyBoost = Math.max(0, 0.08 - ageDays * 0.002);
    const typeBoost = ongoingTypes.has(String(memory.memory_type || "").toLowerCase()) ? 0.08 : 0;
    return { memory, overlap, phraseOverlap, contextual, score: overlapRatio + phraseOverlap * 0.18 + (importance >= 4 ? 0.35 : 0) + typeBoost + recencyBoost };
  }).filter(({ overlap, phraseOverlap, contextual }) => overlap > 0 || phraseOverlap > 0 || contextual)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ memory }) => memory);
}
