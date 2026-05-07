# Campus AI Copilot — Backend

REST + WebSocket API for **Campus AI Copilot**, a student platform for IIT Hyderabad combining a social network with an LLM-powered campus assistant. Node.js + Express + MySQL + Socket.IO. Wired to Groq (Llama 3.3 70B) and Google Gemini for the AI chat.

> **Frontend repository:** [`cherryhere/campus-ai-frontend`](https://github.com/cherryhere/campus-ai-frontend)

---

## What this server does

| Concern | Implementation |
| --- | --- |
| **Authentication** | bcrypt password hashing, JWT sessions (30-day expiry), forgot/reset/change password flows, automatic admin promotion of the first user to sign up |
| **Authorisation** | Role-based middleware (`adminRequired`) gates the Admin Upload route. Suspension middleware (`notSuspended`) blocks suspended users from creating content |
| **Social graph** | Users, posts, likes, comments, follows, events, RSVPs, notifications |
| **Real-time** | Socket.IO authenticated by the same JWT as REST. Pushes `message:new` to both sender and recipient sockets. Auto-reconnect + dedup on the client |
| **File pipeline** | Multer for PDF uploads (25 MB) + image uploads (10 MB). Avatars (5 MB). Static serving of uploaded images via Express. Authenticated PDF downloads |
| **AI chat** | `pdf-parse` extracts text from attached files. System prompt encodes IIT Hyderabad domain knowledge + uploaded document list. Groq → Gemini → stub fallback chain. Conversations & messages persisted to MySQL |
| **Moderation** | Word-list profanity filter on posts / comments / DMs. First offense issues a system-notification warning + increments `users.warnings`. Second offense suspends the account |
| **Time** | All timestamps stored in **UTC** (`SET SESSION time_zone = '+00:00'`). Frontend converts to viewer's local timezone (e.g., IST) |

## Tech Stack

- **Node.js 20+** with native ES modules (`"type": "module"`)
- **Express 4** — HTTP routing
- **mysql2/promise** — async MySQL pool
- **Socket.IO 4** — real-time DMs, JWT-authenticated handshakes
- **bcryptjs**, **jsonwebtoken** — auth
- **multer** — multipart uploads (PDFs, images, avatars)
- **pdf-parse** — text extraction from uploaded PDFs for AI context
- **dotenv** — config from `.env`

## API Reference

All routes (except signup, login, forgot-password, reset-password) require:

```
Authorization: Bearer <jwt-token>
```

### Auth

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/signup` | Returns `{ token, user }`. First user gets `is_admin: true` automatically |
| POST | `/api/auth/login` | Returns `{ token, user }` |
| GET | `/api/auth/me` | Current user object |
| PUT | `/api/auth/me` | Update profile fields (name, branch, year, interests, bio) |
| POST | `/api/auth/avatar` | Multipart `avatar` (image, ≤5 MB) → updates `avatar_path` |
| POST | `/api/auth/change-password` | Body: `{ oldPassword, newPassword }` |
| POST | `/api/auth/forgot-password` | Body: `{ email }`. Returns one-time token (valid 1 hour) |
| POST | `/api/auth/reset-password` | Body: `{ token, password }` |

### Users

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/users?q=` | Search by name / branch / interests |
| GET | `/api/users/:id` | Profile + counts + `is_following` + recent posts |
| GET | `/api/users/:id/followers` | List of followers |
| GET | `/api/users/:id/following` | List of who they follow |
| POST | `/api/users/:id/follow` | Follow (sends notification) |
| DELETE | `/api/users/:id/follow` | Unfollow |

### Posts (Feed)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/posts?tag=foo` | Feed; optional `tag` filter |
| GET | `/api/posts/trending` | Top 12 hashtags by post count |
| POST | `/api/posts` | Multipart: `content`, `tags` (JSON array), optional `image` (≤10 MB). Profanity-checked |
| DELETE | `/api/posts/:id` | Author only |
| POST | `/api/posts/:id/like` | Toggle. Returns `{ liked, likes }` |
| GET | `/api/posts/:id/comments` |  |
| POST | `/api/posts/:id/comments` | Body: `{ content }`. Profanity-checked |

### Events

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/events` | List with `rsvped` flag |
| POST | `/api/events` | Create |
| DELETE | `/api/events/:id` | Creator only |
| POST | `/api/events/:id/rsvp` | Toggle RSVP |

### Documents (Admin RAG knowledge base)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/documents` | List all |
| POST | `/api/documents` | **Admin only**. Multipart: `file` (PDF, ≤25 MB), `title`, `category` |
| GET | `/api/documents/:id/download` | Auth-gated PDF download |
| DELETE | `/api/documents/:id` | Uploader only |

### Notifications

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/notifications` | Last 50 |
| POST | `/api/notifications/read-all` |  |

### Messages (DMs)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/messages/conversations` | All conversations with last message + unread count |
| GET | `/api/messages/:userId` | Full message history (last 200). Marks incoming as read |
| POST | `/api/messages` | Body: `{ recipient_id, content }`. Profanity-checked. Pushes `message:new` over Socket.IO |

### AI

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/ai/chat` | Multipart or JSON: `question`, optional `file`, optional `conversation_id`. Returns `{ conversation_id, answer, source, related, powered_by, attachment }`. Persists both user + assistant messages |
| GET | `/api/ai/suggestions` | Static IITH prompts + dynamic "Summarise <doc>" chips |
| GET | `/api/ai/conversations` | List user's chat conversations |
| POST | `/api/ai/conversations` |  |
| GET | `/api/ai/conversations/:id` | Conversation + messages |
| PUT | `/api/ai/conversations/:id` | Rename |
| DELETE | `/api/ai/conversations/:id` |  |

## Real-time (Socket.IO)

Mounted on the same HTTP port as the REST API.

```js
const socket = io("http://localhost:4000", { auth: { token } });
socket.on("message:new", (msg) => { /* msg = { id, sender_id, recipient_id, content, created_at, ... } */ });
```

The handshake middleware verifies the JWT and rejects connections without one. The server pushes `message:new` to **both** the sender's socket (so their UI updates) and the recipient's socket.

## Database Schema

MySQL 8, InnoDB, `utf8mb4`. The schema is created and migrated on every server boot — including idempotent `ALTER TABLE … ADD COLUMN` for older databases. All `DATETIME` columns are stored in UTC.

```
users
 ├─ id, name, email (unique), password (bcrypt)
 ├─ branch, year, interests, bio, avatar_path
 ├─ warnings, is_suspended, is_admin
 └─ created_at

follows                (follower_id, following_id) — composite PK

posts                  id, author_id → users
 ├─ content, tags (JSON), image_path, pinned
 └─ created_at

post_likes             (post_id, user_id) — composite PK
post_comments          id, post_id, user_id, content, created_at

events                 id, title, category, description, event_date, event_time, location, created_by
event_rsvps            (event_id, user_id) — composite PK

documents              id, title, category, file_name, file_path, status, uploaded_by, created_at
notifications          id, user_id, type, title, link, is_read, created_at
messages               id, sender_id, recipient_id, content, is_read, created_at

password_reset_tokens  token (PK), user_id, expires_at, created_at

chat_conversations     id, user_id, title, created_at, updated_at
chat_messages          id, conversation_id, role, content, source, related_json,
                        attachment_name, powered_by, created_at
```

## AI Engine

The `POST /api/ai/chat` route runs:

1. **Tokenise** the question (strip stop-words, lowercase, ≥3 chars).
2. **Score every uploaded document** by keyword + category match. Pick the top-scoring one as `source`.
3. **Extract attached file** (PDF via `pdf-parse`, text via UTF-8 read). First 8 000 characters are inserted into the prompt as the primary source.
4. **Build the system prompt** with: IIT Hyderabad institutional context (departments, hostels, fests, calendar) + the list of uploaded documents + the file content if any.
5. **Call the LLM**, in this priority order:
   - **Groq** (`llama-3.3-70b-versatile`) — recommended; free; ~14k requests/day
   - **Gemini** (`gemini-2.0-flash`) — fallback
   - **Stub** — category-aware canned answer if no API key is configured
6. **Persist** the user's question and the assistant's answer to `chat_messages`.
7. Return `answer`, `source`, top-3 `related` documents, and the `powered_by` provider tag.

## Moderation

`backend/lib/moderation.js` exports `applyModeration(userId, text)`. Posts, comments, and DMs all pipe through it before persistence:

- 1st violation → `users.warnings += 1`, system notification sent, **content rejected** with HTTP 400 + `{ warning: true }`
- 2nd violation → `users.is_suspended = 1`, **content rejected** with HTTP 403 + `{ suspended: true }`. Subsequent attempts are blocked by the `notSuspended` middleware

The frontend displays a red suspension banner and disables compose UI when it detects either response.

## Setup

### Prerequisites
- Node.js 20+
- MySQL Server 8.x running on `localhost:3306`

### Install

```bash
git clone https://github.com/cherryhere/campus-ai-backend.git
cd campus-ai-backend
npm install
cp .env.example .env
```

### Configure `.env`

```
PORT=4000
JWT_SECRET=replace-with-a-long-random-string
CLIENT_ORIGIN=http://localhost:5173

MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your-mysql-password
MYSQL_DATABASE=campus_ai

# Get a free Groq key at https://console.groq.com/keys
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile

# Optional fallback
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
```

### Run

```bash
npm run dev   # node --watch
```

The server creates the `campus_ai` database, runs all `CREATE TABLE` and idempotent `ALTER TABLE` migrations, and auto-promotes the first user to admin if no admin exists yet.

You should see:

```
MySQL connected: root@localhost:3306/campus_ai
Campus AI backend running on http://localhost:4000
Allowed client origin: http://localhost:5173
```

### Health check

```
GET http://localhost:4000/api/health  →  { ok: true, time: "..." }
```

## File Layout

```
backend/
├── server.js                  Express + Socket.IO bootstrap
├── db.js                      MySQL pool, schema migration, UTC enforcement
├── middleware/
│   └── auth.js                authRequired, adminRequired, notSuspended
├── lib/
│   └── moderation.js          Profanity word list + warning/suspend logic
├── routes/
│   ├── auth.js                signup / login / me / avatar / change-password / forgot / reset
│   ├── users.js               list / search / followers / following / follow / unfollow
│   ├── posts.js               CRUD / like / comment / trending / tag-filter
│   ├── events.js              CRUD / RSVP
│   ├── documents.js           Admin-only PDF upload + auth-gated download
│   ├── notifications.js       list / mark-read
│   ├── messages.js            DM endpoints + Socket.IO push
│   └── ai.js                  Chat (LLM) + conversations CRUD + suggestions
├── uploads/                   (gitignored) avatars/, posts/, document PDFs
├── .env.example
└── package.json
```

## Roadmap

- Replace keyword-matching in `/api/ai/chat` with a proper RAG pipeline (chunking + embeddings + FAISS or ChromaDB)
- Push notifications via FCM / Web Push
- Rate-limiting + per-IP abuse detection
- Image moderation (NSFW detection)
- Admin dashboard endpoints (analytics, manual unsuspend)
- OpenAPI / Swagger spec

## License

For educational and personal use.

---

**Built by [@cherryhere](https://github.com/cherryhere)** as the API layer for the Campus AI Copilot project.
