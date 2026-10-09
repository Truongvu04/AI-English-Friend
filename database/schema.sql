-- AI English Friend - final fresh-install baseline schema
--
-- This file defines structure only. It contains no development users,
-- personas, conversations, messages, memories, translations, or benchmark data.
-- For an existing database, run PRECHECK_BEFORE_BASELINE.sql, review it, and
-- then manually run database/migrations/003_finalize_ai_friend_baseline.sql.

CREATE DATABASE IF NOT EXISTS ai_english_friend
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE ai_english_friend;

CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NULL,
  password_hash VARCHAR(255) NULL,
  learning_goal VARCHAR(255) NULL,
  avatar_url VARCHAR(500) NULL,
  last_active_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='User accounts and learning profile data';

CREATE TABLE user_settings (
  user_id BIGINT UNSIGNED NOT NULL,
  voice_name VARCHAR(255) NULL,
  auto_speak BOOLEAN NOT NULL DEFAULT TRUE,
  language_code VARCHAR(10) NOT NULL DEFAULT 'en',
  learning_level ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2') NOT NULL DEFAULT 'A2',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Global user preferences and CEFR learning level';

CREATE TABLE ai_personas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  system_prompt TEXT NOT NULL,
  voice_name VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_personas_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='The five configurable AI friend personas';

CREATE TABLE user_persona_settings (
  user_id BIGINT UNSIGNED NOT NULL,
  ai_persona_id BIGINT UNSIGNED NOT NULL,
  voice_name VARCHAR(255) NULL,
  voice_lang VARCHAR(20) NULL,
  voice_rate DECIMAL(4,2) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, ai_persona_id),
  CONSTRAINT chk_user_persona_voice_rate CHECK (voice_rate IS NULL OR voice_rate BETWEEN 0.75 AND 1.25),
  CONSTRAINT fk_user_persona_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_persona_settings_persona FOREIGN KEY (ai_persona_id) REFERENCES ai_personas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-user voice overrides for each AI friend';

CREATE TABLE conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  ai_persona_id BIGINT UNSIGNED NULL,
  title VARCHAR(255) NULL,
  conversation_mode ENUM('text', 'voice') NOT NULL DEFAULT 'text',
  summary TEXT NULL,
  summary_updated_at DATETIME(3) NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ended_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_conversations_user_started (user_id, started_at),
  KEY idx_conversations_persona (ai_persona_id),
  UNIQUE KEY uq_conversations_user_persona (user_id, ai_persona_id),
  CONSTRAINT fk_conversations_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_conversations_persona FOREIGN KEY (ai_persona_id) REFERENCES ai_personas (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Persistent conversation thread; one per user and persona';

CREATE TABLE messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  role ENUM('user', 'assistant') NOT NULL,
  content TEXT NOT NULL,
  message_type ENUM('text', 'voice') NOT NULL DEFAULT 'text',
  translation TEXT NULL,
  audio_url VARCHAR(500) NULL,
  audio_duration_ms INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_messages_conversation_created (conversation_id, created_at),
  KEY idx_messages_conversation_id (conversation_id, id),
  CONSTRAINT chk_messages_audio_duration CHECK (audio_duration_ms IS NULL OR audio_duration_ms >= 0),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='User and AI friend messages; audio_duration_ms is milliseconds';

CREATE TABLE memories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  ai_persona_id BIGINT UNSIGNED NULL,
  source_message_id BIGINT UNSIGNED NULL,
  memory_type VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  importance TINYINT UNSIGNED NOT NULL DEFAULT 3,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_memories_user_persona_importance (user_id, ai_persona_id, importance),
  KEY idx_memories_source_message (source_message_id),
  CONSTRAINT chk_memories_importance CHECK (importance BETWEEN 1 AND 5),
  CONSTRAINT fk_memories_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_memories_persona FOREIGN KEY (ai_persona_id) REFERENCES ai_personas (id) ON DELETE CASCADE,
  CONSTRAINT fk_memories_source_message FOREIGN KEY (source_message_id) REFERENCES messages (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Long-term memories scoped to a user and AI persona';
