# AI English Friend — Current Database Architecture

Source of truth:

- New database: `database/schema.sql`
- Existing database precheck: `database/PRECHECK_BEFORE_BASELINE.sql`
- Existing database cleanup: `database/migrations/003_finalize_ai_friend_baseline.sql`
- Existing database verification: `database/VERIFY_AFTER_BASELINE.sql`
- Runtime queries: `server/src/db.js` and `server/src/index.js`

Source-of-truth order:

1. Product rules
2. Current runtime code
3. Final baseline schema (`database/schema.sql`)
4. Reviewed migration and verification scripts

When runtime needs a new persistent field, all three database files must be updated together.

The older root-level `ai_english_friend.sql`, `ai_english_friend_v2.sql`, `DATABASE_DESIGN.md`, `DATABASE_DESIGN_V2.md`, `database/ai_english_friend_current.sql`, `database/UPDATE_CURRENT_DATABASE.sql`, and migrations `001`/`002` are historical references. They remain until the user manually runs and verifies migration `003`; this batch does not delete them.

## Product rules

1. One development user can have five AI friends: Humorous, Serious, Empathetic, Motivating, and Thoughtful.
2. One `(user_id, ai_persona_id)` pair has one persistent conversation. Legacy conversations with `ai_persona_id IS NULL` are preserved.
3. Text Mode and Voice Mode share the same persona conversation thread.
4. Memories are isolated by both `user_id` and `ai_persona_id`.
5. A memory with `ai_persona_id IS NULL` is legacy data and is never injected into a current persona context.
6. Translation is cached in `messages.translation`; the English message remains unchanged.
7. Persona voice overrides are modeled by `(user_id, ai_persona_id)`. The current browser UI stores these overrides in persona-keyed localStorage; the database table and `db.js` helpers are ready for account-level persistence when an API/account sync exists.
8. A summary belongs to its persistent conversation and is stored in `conversations.summary` and `summary_updated_at`.

## Tables

### Active runtime tables

| Table | Runtime purpose |
| --- | --- |
| `users` | Development user and future account profile. `password_hash` is retained for future authentication. |
| `user_settings` | Current `learning_level` and compatibility settings; global `voice_name` and `auto_speak` are deprecated legacy fields. |
| `ai_personas` | The five AI friend records, system prompts, stable IDs, and optional default voice hint. |
| `user_persona_settings` | Per-user, per-persona voice name, locale, and rate override. |
| `conversations` | Persistent user/persona threads, mode, title, and summary. |
| `messages` | Text/voice input, assistant reply, translation cache, and optional audio metadata. |
| `memories` | Long-term facts isolated by user and persona, including `learning_preference` memory types. |

### Legacy-compatible table

### Legacy tables scheduled for removal

`vocabulary`, `grammar_mistakes`, and `learning_progress` belong to the removed Learning subsystem. They have no active runtime callers, endpoints, UI, or writes. Migration `003_finalize_ai_friend_baseline.sql` drops them only after the user reviews the read-only precheck. Existing rows in those three legacy tables are the only data intentionally discarded by that migration.

## Important schemas

### `conversations`

- `ai_persona_id` is nullable for pre-persona legacy conversations.
- `UNIQUE(user_id, ai_persona_id)` enforces one persistent thread per persona. MySQL allows multiple `NULL` values, so legacy conversations remain valid.
- `summary` and `summary_updated_at` are conversation-scoped; no separate summary table is used.

### `messages`

The current fields are `id`, `conversation_id`, `role`, `content`, `message_type`, `translation`, `audio_url`, `audio_duration_ms`, and `created_at`. `audio_duration_ms` is measured in milliseconds. Assistant audio is currently browser TTS, so `audio_url` remains nullable for future persisted audio.

### `memories`

The current fields are `id`, `user_id`, `ai_persona_id`, `source_message_id`, `memory_type`, `content`, `importance`, `created_at`, and `updated_at`.

- `ai_persona_id` references `ai_personas.id` with `ON DELETE CASCADE`.
- `source_message_id` references `messages.id` with `ON DELETE SET NULL`.
- Existing memories are backfilled only when their source message resolves to a conversation with a known persona.
- Unattributed legacy memories remain `NULL`; runtime queries require both `user_id = ?` and `ai_persona_id = ?`.

### `user_persona_settings`

Primary key: `(user_id, ai_persona_id)`.

Fields: `voice_name`, `voice_lang`, `voice_rate`, `created_at`, and `updated_at`. `voice_rate` is nullable or constrained to `0.75`–`1.25`. Both foreign keys use `ON DELETE CASCADE`.

## Voice source and deprecated fields

The active voice resolution priority is:

1. User + persona override (`user_persona_settings.voice_name` at account/API level; currently the equivalent persona-keyed browser localStorage value).
2. Active persona configuration and browser voice ranking: gender, style, name hints, and English locale preference.
3. Best available English browser voice fallback.

`user_settings.voice_name` is a deprecated global voice field retained for backward compatibility. It must not become the automatic voice fallback for all five personas.

`user_settings.auto_speak` is a deprecated compatibility field. Current behavior is mode-driven: Voice Mode automatically speaks the assistant reply; Text Mode stays silent unless the user manually presses the speaker control. `auto_speak` must not make Text Mode speak automatically.

`ai_personas.voice_name` is optional persona metadata/default hint only. It is not treated as a guaranteed browser voice and never overrides a user-persona voice selection. Browser availability varies by operating system, browser, and device.

## Runtime usage decisions

- `learning_level` remains in `user_settings` with its A1–C2 enum and continues to control conversation difficulty.
- `learning_goal` remains in `users` as profile/context data.
- `learning_preference` remains a valid `memories.memory_type`.
- `vocabulary`, `grammar_mistakes`, and `learning_progress` are scheduled for removal by migration `003`; this migration has not been applied by Codex.
- `user_settings.voice_name` is not removed because old installations may contain it and the settings contract remains compatible. It is not an active persona voice source.
- `auto_speak` is retained because the server still reads and serializes it. It is not an active mode decision.
- `language_code` is retained because it remains part of the settings API and schema contract.
- Old conversations and messages are neither reassigned nor deleted.
- The main migration preserves all existing translation cache rows and can be rerun without clearing new Translation V2 results. The optional one-time cleanup is isolated in `database/RESET_LEGACY_TRANSLATIONS.sql`.

## Indexes

The migration keeps or adds only query-driven indexes:

- `users.email` unique
- `conversations(user_id, started_at)`
- `conversations(ai_persona_id)`
- `conversations(user_id, ai_persona_id)` unique when existing data permits it
- `messages(conversation_id, created_at)`
- `memories(user_id, ai_persona_id, importance)`
- `memories(source_message_id)`
- `messages(conversation_id, id)` is added by migration `003` because runtime history and summary queries select newest messages by `conversation_id` and `id DESC`.

No memory index is changed: the existing `(user_id, ai_persona_id, importance)` index matches the leading filters and ordering, while `updated_at` is only a tie-breaker. No legacy-table indexes are migrated because those tables are removed.

## Migration safety

`database/PRECHECK_BEFORE_BASELINE.sql` is read-only. `database/migrations/003_finalize_ai_friend_baseline.sql` uses `DROP TABLE IF EXISTS` only for the three obsolete Learning tables and conditionally adds the verified message-history index and persona uniqueness constraint. It does not drop the database, rebuild core tables, assign legacy rows to a random persona, delete conversations/messages/personas/users, or reset translations. If duplicate non-NULL persona threads exist, it preserves them and reports the condition instead of adding a constraint that would fail.

The main migration does not reset `messages.translation`. If old development translations need to be cleared after Translation V2 is verified, run `database/RESET_LEGACY_TRANSLATIONS.sql` separately and intentionally.

## Active, legacy-compatible, and future-ready

- Intended final runtime tables after migration `003`: `users`, `user_settings`, `ai_personas`, `user_persona_settings`, `conversations`, `messages`, and `memories`.
- Tables removed by migration `003`: `vocabulary`, `grammar_mistakes`, and `learning_progress`.
- Future-ready: account/API synchronization of `user_persona_settings`. Until then, the browser's persona-keyed localStorage is the active UI persistence layer.

## Baseline policy

`database/schema.sql` is the fresh-install source of truth. Migration `003` is for the existing development database only and must be reviewed and run manually in MySQL Workbench. After this baseline is verified, future schema changes should use `database/migrations/004_...`, `005_...`, and so on; migration `003` should not be edited after release.

`database/schema.sql` intentionally contains no persona seed rows. Backend startup already runs `seedDefaultPersonas()` with deterministic `INSERT IGNORE` seeds for the five AI friends, so there is one persona seed source and no personal conversation/history data in the fresh-install schema.
