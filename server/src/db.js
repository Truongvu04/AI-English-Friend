import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({
  path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env"),
});

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export async function testDatabaseConnection() {
  const [rows] = await pool.query("SELECT 1 AS ok");
  return rows;
}

export async function getUsers() {
  const [rows] = await pool.query(`
    SELECT
      id,
      name,
      email,
      learning_goal,
      last_active_at,
      created_at
    FROM users
    ORDER BY id DESC
    LIMIT 10
  `);

  return rows;
}

export async function getOrCreateDevelopmentUser() {
  const email = process.env.DEV_USER_EMAIL;

  if (!email) {
    throw new Error("DEV_USER_EMAIL is missing");
  }

  const [existingUsers] = await pool.query(
    `
      SELECT id, name, email, learning_goal
      FROM users
      WHERE email = ?
      LIMIT 1
    `,
    [email],
  );

  if (existingUsers.length > 0) {
    const user = existingUsers[0];

    await pool.query(
      `
        INSERT IGNORE INTO user_settings (
          user_id,
          auto_speak,
          language_code,
          learning_level
        )
        VALUES (?, TRUE, 'en', 'A2')
      `,
      [user.id],
    );

    return user;
  }

  const [result] = await pool.query(
    `
      INSERT INTO users (
        name,
        email,
        learning_goal
      )
      VALUES (?, ?, ?)
    `,
    [
      "Development User",
      email,
      "Improve English speaking and conversation skills",
    ],
  );

  const userId = result.insertId;

  await pool.query(
    `
      INSERT INTO user_settings (
        user_id,
        auto_speak,
        language_code,
        learning_level
      )
      VALUES (?, TRUE, 'en', 'A2')
    `,
    [userId],
  );

  return {
    id: userId,
    name: "Development User",
    email,
    learning_goal: "Improve English speaking and conversation skills",
  };
}

export async function getDevelopmentUserId() {
  const user = await getOrCreateDevelopmentUser();
  return user.id;
}

const personaPresentation = {
  humorous: { cardLabel: "Light & playful", tagline: "The fun one", shortDescription: "A quick-witted friend who keeps practice relaxed, natural, and full of little laughs.", longDescription: "A warm conversational partner who uses gentle humor and playful observations to make speaking feel easy.", greeting: "Hey you 😄 Ready to talk, laugh, or both?" },
  serious: { cardLabel: "Clear & grounded", tagline: "The steady one", shortDescription: "A calm, thoughtful friend for clear conversations and focused English practice.", longDescription: "A mature listener who keeps things honest, composed, and useful without making conversation feel like class.", greeting: "Hi. I’m here and I’m listening. What would you like to talk about?" },
  empathetic: { cardLabel: "Warm & understanding", tagline: "The gentle one", shortDescription: "A patient listener who gives you room to speak, especially on the harder days.", longDescription: "A reassuring companion who responds with care, gentle questions, and support when you need to be heard.", greeting: "Hey, I’m here with you. What’s been on your mind?" },
  motivating: { cardLabel: "Bright & encouraging", tagline: "The cheerleader", shortDescription: "An upbeat friend who helps you find momentum without sounding like a teacher.", longDescription: "A positive companion who notices progress, brings energy to practice, and helps you take the next small step.", greeting: "Hey, I’m glad you’re here. What are we working through today?" },
  thoughtful: { cardLabel: "Curious & deep", tagline: "The deep one", shortDescription: "A curious friend who asks open questions and makes space for ideas with more depth.", longDescription: "A reflective conversationalist who follows your ideas, asks meaningful questions, and enjoys the details.", greeting: "Hi. What’s been occupying your thoughts lately?" },
};

const defaultPersonaSeeds = [
  ["Humorous Friend", "You are a witty, warm English-speaking friend. Use light, kind humor and playful observations when they fit, never force jokes or humiliate the user. Notice the user's mood and conversation context. Correct obvious or meaningful English mistakes briefly and naturally without becoming a teacher. Keep the conversation casual, human, and warm."],
  ["Serious Friend", "You are a calm, direct, mature English-speaking friend. Keep your tone grounded, confident, and concise without sounding cold. Avoid unnecessary jokes. Notice the user's mood and context. Correct obvious or meaningful English mistakes briefly and directly without turning the conversation into a lesson. Speak like a thoughtful, reliable friend."],
  ["Empathetic Friend", "You are a warm, patient, emotionally attentive English-speaking friend. Listen carefully, respond gently, and never judge or act like a therapist. Notice the user's mood and emotional context. Correct obvious or meaningful English mistakes briefly and kindly without making the user feel embarrassed or turning the conversation into a lesson."],
  ["Motivating Friend", "You are a bright, encouraging, grounded English-speaking friend. Help the user regain energy and confidence without sounding like a motivational speaker or teacher. Notice their mood and avoid forced positivity. Correct obvious or meaningful English mistakes briefly and positively, then continue the conversation naturally."],
  ["Thoughtful Friend", "You are a calm, curious, reflective English-speaking friend. Ask meaningful questions when they fit and help the conversation go a little deeper without forcing philosophy into every topic. Notice the user's mood and context. Correct obvious or meaningful English mistakes briefly and naturally without turning the conversation into a lesson."],
];

function slugifyPersonaName(name) {
  return String(name || "").toLowerCase().replace(/\s+friend$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function decoratePersona(row, thread = null) {
  const slug = slugifyPersonaName(row.name);
  const presentation = personaPresentation[slug] || {
    cardLabel: "Your AI friend",
    tagline: "A new conversation",
    shortDescription: "A friendly space to practice English at your own pace.",
    longDescription: "A flexible English companion for natural conversation.",
    greeting: "Hi. What would you like to talk about today?",
  };
  return {
    id: Number(row.id), slug, name: row.name,
    cardLabel: presentation.cardLabel, tagline: presentation.tagline,
    shortDescription: presentation.shortDescription,
    longDescription: presentation.longDescription, greeting: presentation.greeting,
    voiceName: row.voice_name || null,
    hasConversation: Boolean(thread?.conversation_id),
    conversationId: thread?.conversation_id ? Number(thread.conversation_id) : null,
    lastActiveAt: thread?.last_active_at || null,
    messageCount: Number(thread?.message_count || 0),
  };
}

export async function seedDefaultPersonas() {
  for (const [name, systemPrompt] of defaultPersonaSeeds) {
    await pool.query(
      "INSERT IGNORE INTO ai_personas (name, system_prompt, voice_name) VALUES (?, ?, NULL)",
      [name, systemPrompt],
    );
  }
}

export async function getPersonasForUser(userId) {
  if (!userId) throw new Error("userId is required");
  const [rows] = await pool.query(`
    SELECT p.id, p.name, p.system_prompt, p.voice_name,
      c.id AS conversation_id, MAX(m.created_at) AS last_active_at, COUNT(m.id) AS message_count
    FROM ai_personas p
    LEFT JOIN conversations c ON c.ai_persona_id = p.id AND c.user_id = ?
    LEFT JOIN messages m ON m.conversation_id = c.id
    GROUP BY p.id, p.name, p.system_prompt, p.voice_name, c.id
    ORDER BY p.id ASC
  `, [userId]);
  return rows.map((row) => decoratePersona(row, row));
}

export async function getPersonaById(personaId) {
  if (!Number.isInteger(Number(personaId)) || Number(personaId) <= 0) throw new Error("personaId must be a positive integer");
  const [rows] = await pool.query("SELECT id, name, system_prompt, voice_name FROM ai_personas WHERE id = ? LIMIT 1", [Number(personaId)]);
  return rows[0] || null;
}

async function getPersonaConversation(userId, personaId) {
  const [rows] = await pool.query(`
    SELECT c.id, c.user_id, c.ai_persona_id, c.title, c.conversation_mode,
      c.summary, c.summary_updated_at, c.created_at
    FROM conversations c
    WHERE c.user_id = ? AND c.ai_persona_id = ?
    LIMIT 1
  `, [userId, personaId]);
  return rows[0] || null;
}

export async function getOrCreatePersonaConversation(userId, personaId, mode = "text") {
  if (!userId) throw new Error("userId is required");
  const persona = await getPersonaById(personaId);
  if (!persona) return null;
  const existing = await getPersonaConversation(userId, persona.id);
  if (existing) return { persona: decoratePersona(persona, { conversation_id: existing.id }), conversation: existing, createdNewConversation: false };
  try {
    const conversation = await createConversation({ userId, aiPersonaId: persona.id, mode, title: persona.name });
    const persistedConversation = await getPersonaConversation(userId, persona.id);
    return { persona: decoratePersona(persona, { conversation_id: conversation.id }), conversation: persistedConversation || conversation, createdNewConversation: true };
  } catch (error) {
    if (error?.code !== "ER_DUP_ENTRY") throw error;
    const concurrentConversation = await getPersonaConversation(userId, persona.id);
    if (!concurrentConversation) throw error;
    return { persona: decoratePersona(persona, { conversation_id: concurrentConversation.id }), conversation: concurrentConversation, createdNewConversation: false };
  }
}

export async function getPersonaThreadForUser(userId, personaId) {
  const resolved = await getOrCreatePersonaConversation(userId, personaId);
  if (!resolved) return null;
  const messages = await getConversationMessages(resolved.conversation.id, userId, 100);
  return { ...resolved, messages };
}

export async function getPersonaReentryState(userId, personaId) {
  const conversation = await getPersonaConversation(userId, personaId);
  if (!conversation) return null;

  const [userMessageRows] = await pool.query(`
    SELECT id, content, created_at
    FROM messages
    WHERE conversation_id = ? AND role = 'user'
    ORDER BY created_at DESC, id DESC
    LIMIT 40
  `, [conversation.id]);

  return {
    conversation,
    userMessages: userMessageRows,
  };
}

export async function getUserPersonaSettings(userId, personaId) {
  if (!userId) throw new Error("userId is required");
  if (!Number.isInteger(Number(personaId)) || Number(personaId) <= 0) {
    throw new Error("personaId must be a positive integer");
  }

  const [rows] = await pool.query(
    `
      SELECT
        user_id,
        ai_persona_id,
        voice_name,
        voice_lang,
        voice_rate,
        created_at,
        updated_at
      FROM user_persona_settings
      WHERE user_id = ?
        AND ai_persona_id = ?
      LIMIT 1
    `,
    [userId, Number(personaId)],
  );

  return rows[0] || null;
}

export async function upsertUserPersonaSettings({
  userId,
  personaId,
  voiceName = null,
  voiceLang = null,
  voiceRate = null,
} = {}) {
  if (!userId) throw new Error("userId is required");
  if (!Number.isInteger(Number(personaId)) || Number(personaId) <= 0) {
    throw new Error("personaId must be a positive integer");
  }

  const normalizedVoiceName = voiceName === null || voiceName === undefined
    ? null
    : String(voiceName).trim().slice(0, 255) || null;
  const normalizedVoiceLang = voiceLang === null || voiceLang === undefined
    ? null
    : String(voiceLang).trim().slice(0, 20) || null;
  const normalizedVoiceRate = voiceRate === null || voiceRate === undefined
    ? null
    : Number(voiceRate);

  if (normalizedVoiceRate !== null && (!Number.isFinite(normalizedVoiceRate) || normalizedVoiceRate < 0.75 || normalizedVoiceRate > 1.25)) {
    throw new Error("voiceRate must be between 0.75 and 1.25");
  }

  await pool.query(
    `
      INSERT INTO user_persona_settings (
        user_id,
        ai_persona_id,
        voice_name,
        voice_lang,
        voice_rate
      )
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        voice_name = VALUES(voice_name),
        voice_lang = VALUES(voice_lang),
        voice_rate = VALUES(voice_rate),
        updated_at = CURRENT_TIMESTAMP(3)
    `,
    [userId, Number(personaId), normalizedVoiceName, normalizedVoiceLang, normalizedVoiceRate],
  );

  return getUserPersonaSettings(userId, personaId);
}

export async function createConversation({
  userId,
  mode = "text",
  title = null,
  aiPersonaId = null,
}) {
  if (!userId) {
    throw new Error("userId is required");
  }

  if (mode !== "text" && mode !== "voice") {
    throw new Error("conversation mode must be text or voice");
  }

  const [result] = await pool.query(
    `
      INSERT INTO conversations (
        user_id,
        ai_persona_id,
        title,
        conversation_mode
      )
      VALUES (?, ?, ?, ?)
    `,
    [userId, aiPersonaId, title, mode],
  );

  return {
    id: result.insertId,
    userId,
    aiPersonaId,
    title,
    conversationMode: mode,
  };
}

export async function saveMessage({
  conversationId,
  role,
  content,
  messageType = "text",
  translation = null,
  audioUrl = null,
  audio_duration_ms = null,
}) {
  if (!conversationId) {
    throw new Error("conversationId is required");
  }

  if (role !== "user" && role !== "assistant") {
    throw new Error("role must be user or assistant");
  }

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("content is required");
  }

  if (messageType !== "text" && messageType !== "voice") {
    throw new Error("messageType must be text or voice");
  }

  const [result] = await pool.query(
    `
      INSERT INTO messages (
        conversation_id,
        role,
        content,
        message_type,
        translation,
        audio_url,
        audio_duration_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      conversationId,
      role,
      content.trim(),
      messageType,
      translation,
      audioUrl,
      audio_duration_ms,
    ],
  );

  return {
    id: result.insertId,
    conversationId,
    role,
    content: content.trim(),
    messageType,
    translation,
    audioUrl,
    audio_duration_ms,
  };
}

export async function getConversationForUser(conversationId, userId) {
  const [rows] = await pool.query(
    `
      SELECT
        id,
        user_id,
        ai_persona_id,
        title,
        conversation_mode,
        summary,
        summary_updated_at,
        created_at
      FROM conversations
      WHERE id = ?
        AND user_id = ?
      LIMIT 1
    `,
    [conversationId, userId],
  );

  return rows[0] || null;
}

export async function getConversationsForUser(userId) {
  if (!userId) {
    throw new Error("userId is required");
  }

  const [rows] = await pool.query(
    `
      SELECT
        c.id,
        c.title,
        c.conversation_mode,
        c.summary,
        c.summary_updated_at,
        c.started_at,
        c.ended_at,
        c.created_at,
        c.updated_at,
        COUNT(m.id) AS message_count,
        MAX(m.created_at) AS last_message_at
      FROM conversations c
      LEFT JOIN messages m
        ON m.conversation_id = c.id
      WHERE c.user_id = ?
      GROUP BY
        c.id,
        c.title,
        c.conversation_mode,
        c.summary,
        c.summary_updated_at,
        c.started_at,
        c.ended_at,
        c.created_at,
        c.updated_at
      ORDER BY
        COALESCE(MAX(m.created_at), c.created_at) DESC
      LIMIT 50
    `,
    [userId],
  );

  return rows;
}

export async function getConversationMessages(
  conversationId,
  userId,
  limit = 50,
) {
  if (!conversationId) {
    throw new Error("conversationId is required");
  }

  if (!userId) {
    throw new Error("userId is required");
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

  const [rows] = await pool.query(
    `
      SELECT
        recent.id,
        recent.conversation_id,
        recent.role,
        recent.content,
        recent.message_type,
        recent.translation,
        recent.audio_url,
        recent.audio_duration_ms,
        recent.created_at
      FROM (
        SELECT
          m.id,
          m.conversation_id,
          m.role,
          m.content,
          m.message_type,
          m.translation,
          m.audio_url,
          m.audio_duration_ms,
          m.created_at
        FROM messages m
        INNER JOIN conversations c
          ON c.id = m.conversation_id
        WHERE m.conversation_id = ?
          AND c.user_id = ?
        ORDER BY m.id DESC
        LIMIT ?
      ) AS recent
      ORDER BY recent.id ASC
    `,
    [conversationId, userId, safeLimit],
  );

  return rows;
}

export async function getConversationMessageCount(conversationId, userId) {
  if (!conversationId) {
    throw new Error("conversationId is required");
  }

  if (!userId) {
    throw new Error("userId is required");
  }

  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS message_count
      FROM messages m
      INNER JOIN conversations c
        ON c.id = m.conversation_id
      WHERE m.conversation_id = ?
        AND c.user_id = ?
    `,
    [conversationId, userId],
  );

  return Number(rows[0]?.message_count || 0);
}

export async function getMessagesForConversationSummary(
  conversationId,
  userId,
  { summaryUpdatedAt = null, keepRecent = 12, limit = 30 } = {},
) {
  if (!conversationId) {
    throw new Error("conversationId is required");
  }

  if (!userId) {
    throw new Error("userId is required");
  }

  const safeKeepRecent = Math.min(Math.max(Number(keepRecent) || 12, 0), 100);
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);

  const [rows] = await pool.query(
    `
      SELECT
        m.id,
        m.conversation_id,
        m.role,
        m.content,
        m.created_at
      FROM messages m
      INNER JOIN conversations c
        ON c.id = m.conversation_id
      WHERE m.conversation_id = ?
        AND c.user_id = ?
        AND m.id NOT IN (
          SELECT recent.id
          FROM (
            SELECT id
            FROM messages
            WHERE conversation_id = ?
            ORDER BY id DESC
            LIMIT ?
          ) AS recent
        )
        AND (? IS NULL OR m.created_at >= ?)
      ORDER BY m.id ASC
      LIMIT ?
    `,
    [
      conversationId,
      userId,
      conversationId,
      safeKeepRecent,
      summaryUpdatedAt,
      summaryUpdatedAt,
      safeLimit,
    ],
  );

  return rows;
}

export async function updateConversationSummary(
  conversationId,
  userId,
  summary,
  summaryUpdatedAt,
) {
  if (!conversationId) {
    throw new Error("conversationId is required");
  }

  if (!userId) {
    throw new Error("userId is required");
  }

  if (typeof summary !== "string" || !summary.trim()) {
    throw new Error("summary is required");
  }

  if (!summaryUpdatedAt) {
    throw new Error("summaryUpdatedAt is required");
  }

  const [result] = await pool.query(
    `
      UPDATE conversations
      SET
        summary = ?,
        summary_updated_at = ?
      WHERE id = ?
        AND user_id = ?
    `,
    [summary.trim(), summaryUpdatedAt, conversationId, userId],
  );

  return result.affectedRows > 0;
}

export async function getMemoriesForPersona(userId, personaId, limit = 30) {
  if (!userId) {
    throw new Error("userId is required");
  }
  if (!Number.isInteger(Number(personaId)) || Number(personaId) <= 0) {
    throw new Error("personaId must be a positive integer");
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const [rows] = await pool.query(
    `
      SELECT
        id,
        user_id,
        ai_persona_id,
        source_message_id,
        memory_type,
        content,
        importance,
        created_at,
        updated_at
      FROM memories
      WHERE user_id = ?
        AND ai_persona_id = ?
      ORDER BY importance DESC, updated_at DESC
      LIMIT ?
    `,
    [userId, Number(personaId), safeLimit],
  );

  return rows;
}

export async function createMemory({
  userId,
  personaId,
  sourceMessageId = null,
  memoryType,
  content,
  importance,
}) {
  if (!userId) {
    throw new Error("userId is required");
  }
  if (!Number.isInteger(Number(personaId)) || Number(personaId) <= 0) {
    throw new Error("personaId must be a positive integer");
  }

  if (typeof memoryType !== "string" || !memoryType.trim() || memoryType.length > 50) {
    throw new Error("memoryType is required");
  }

  if (typeof content !== "string" || !content.trim() || content.length > 1_000) {
    throw new Error("memory content is required");
  }

  if (!Number.isInteger(importance) || importance < 1 || importance > 5) {
    throw new Error("importance must be an integer from 1 to 5");
  }

  const persona = await getPersonaById(Number(personaId));
  if (!persona) {
    throw new Error("personaId does not exist");
  }

  if (sourceMessageId !== null) {
    const [sourceRows] = await pool.query(
      `
        SELECT m.id
        FROM messages m
        INNER JOIN conversations c
          ON c.id = m.conversation_id
        WHERE m.id = ?
          AND m.role = 'user'
          AND c.user_id = ?
          AND c.ai_persona_id = ?
        LIMIT 1
      `,
      [Number(sourceMessageId), userId, Number(personaId)],
    );
    if (!sourceRows[0]) {
      throw new Error("sourceMessageId must belong to a user message");
    }
  }

  const [result] = await pool.query(
    `
      INSERT INTO memories (
        user_id,
        ai_persona_id,
        source_message_id,
        memory_type,
        content,
        importance
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [userId, Number(personaId), sourceMessageId, memoryType.trim(), content.trim(), importance],
  );

  return {
    id: result.insertId,
    userId,
    personaId: Number(personaId),
    sourceMessageId,
    memoryType: memoryType.trim(),
    content: content.trim(),
    importance,
  };
}

export async function updateMemoryImportance(memoryId, userId, personaId, importance) {
  if (!Number.isInteger(Number(memoryId)) || Number(memoryId) <= 0) {
    throw new Error("memoryId must be a positive integer");
  }

  if (!userId) {
    throw new Error("userId is required");
  }

  if (!Number.isInteger(Number(personaId)) || Number(personaId) <= 0) {
    throw new Error("personaId must be a positive integer");
  }

  if (!Number.isInteger(importance) || importance < 1 || importance > 5) {
    throw new Error("importance must be an integer from 1 to 5");
  }

  const [result] = await pool.query(
    `
      UPDATE memories
      SET importance = ?
      WHERE id = ?
        AND user_id = ?
        AND ai_persona_id = ?
        AND importance < ?
      `,
    [importance, Number(memoryId), userId, Number(personaId), importance],
  );

  return result.affectedRows > 0;
}

export async function getMessageForUser(messageId, userId) {
  if (!Number.isInteger(Number(messageId)) || Number(messageId) <= 0) {
    throw new Error("messageId must be a positive integer");
  }

  if (!userId) {
    throw new Error("userId is required");
  }

  const [rows] = await pool.query(
    `
      SELECT
        m.id,
        m.conversation_id,
        m.role,
        m.content,
        m.message_type,
        m.translation,
        m.audio_url,
        m.audio_duration_ms,
        m.created_at
      FROM messages m
      INNER JOIN conversations c
        ON c.id = m.conversation_id
      WHERE m.id = ?
        AND c.user_id = ?
      LIMIT 1
    `,
    [Number(messageId), userId],
  );

  return rows[0] || null;
}

export async function getTranslationContext(messageId, userId, precedingLimit = 2) {
  if (!Number.isInteger(Number(messageId)) || Number(messageId) <= 0) {
    throw new Error("messageId must be a positive integer");
  }

  if (!userId) {
    throw new Error("userId is required");
  }

  const safeLimit = Math.min(Math.max(Number(precedingLimit) || 2, 1), 2);
  const [targetRows] = await pool.query(
    `
      SELECT
        m.id,
        m.conversation_id,
        m.role,
        m.content,
        m.translation,
        c.ai_persona_id,
        p.name AS persona_name
      FROM messages m
      INNER JOIN conversations c
        ON c.id = m.conversation_id
      LEFT JOIN ai_personas p
        ON p.id = c.ai_persona_id
      WHERE m.id = ?
        AND c.user_id = ?
      LIMIT 1
    `,
    [Number(messageId), userId],
  );

  const target = targetRows[0] || null;
  if (!target) return null;

  const [precedingRows] = await pool.query(
    `
      SELECT id, role, content
      FROM messages
      WHERE conversation_id = ?
        AND id < ?
      ORDER BY id DESC
      LIMIT ?
    `,
    [target.conversation_id, target.id, safeLimit],
  );

  return {
    target,
    precedingMessages: precedingRows.reverse(),
  };
}

export async function updateMessageTranslation(messageId, userId, translation) {
  if (!Number.isInteger(Number(messageId)) || Number(messageId) <= 0) {
    throw new Error("messageId must be a positive integer");
  }

  if (!userId) {
    throw new Error("userId is required");
  }

  if (typeof translation !== "string" || !translation.trim()) {
    throw new Error("translation is required");
  }

  const [result] = await pool.query(
    `
      UPDATE messages m
      INNER JOIN conversations c
        ON c.id = m.conversation_id
      SET
        m.translation = ?
      WHERE m.id = ?
        AND c.user_id = ?
    `,
    [translation.trim(), Number(messageId), userId],
  );

  return result.affectedRows > 0;
}

export async function getUserSettings(userId) {
  if (!userId) {
    throw new Error("userId is required");
  }

  const [rows] = await pool.query(
    `
      SELECT
        user_id,
        auto_speak,
        language_code,
        learning_level,
        created_at,
        updated_at
      FROM user_settings
      WHERE user_id = ?
      LIMIT 1
    `,
    [userId],
  );

  return rows[0] || null;
}

export async function updateUserSettings(userId, settings) {
  if (!userId) {
    throw new Error("userId is required");
  }

  const assignments = [];
  const values = [];

  if (Object.prototype.hasOwnProperty.call(settings, "learningLevel")) {
    assignments.push("learning_level = ?");
    values.push(settings.learningLevel);
  }

  if (Object.prototype.hasOwnProperty.call(settings, "autoSpeak")) {
    assignments.push("auto_speak = ?");
    values.push(settings.autoSpeak);
  }

  if (Object.prototype.hasOwnProperty.call(settings, "languageCode")) {
    assignments.push("language_code = ?");
    values.push(settings.languageCode);
  }

  if (assignments.length === 0) {
    throw new Error("No settings to update");
  }

  values.push(userId);

  await pool.query(
    `
      UPDATE user_settings
      SET
        ${assignments.join(", ")},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE user_id = ?
    `,
    values,
  );

  return getUserSettings(userId);
}

function validateUserScopedConversation(conversationId, userId) {
  if (!conversationId) throw new Error("conversationId is required");
  if (!userId) throw new Error("userId is required");
}
export async function getUserMessageCountForConversation(conversationId, userId) {
  validateUserScopedConversation(conversationId, userId);
  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS user_message_count
      FROM messages m
      INNER JOIN conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ?
        AND c.user_id = ?
        AND m.role = 'user'
    `,
    [conversationId, userId],
  );
  return Number(rows[0]?.user_message_count || 0);
}

export async function updateConversationTitle(conversationId, userId, title) {
  if (!conversationId) {
    throw new Error("conversationId is required");
  }

  if (!userId) {
    throw new Error("userId is required");
  }

  if (typeof title !== "string" || !title.trim()) {
    throw new Error("title is required");
  }

  const [result] = await pool.query(
    `
      UPDATE conversations
      SET
        title = ?,
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?
        AND user_id = ?
    `,
    [title.trim(), conversationId, userId],
  );

  return result.affectedRows > 0;
}

export default pool;
