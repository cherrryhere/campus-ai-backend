# Campus AI Backend

Node.js + Express + MySQL + Socket.IO.

## Prerequisites

- Node.js 20+
- MySQL Server 8.x running locally (or accessible remotely). On Windows: install [MySQL Community Server](https://dev.mysql.com/downloads/mysql/) or use XAMPP / WAMP / MySQL Workbench.

## Setup

```bash
cd backend
npm install
cp .env.example .env
# edit .env: set MYSQL_PASSWORD, JWT_SECRET, etc.
npm run dev
```

The server creates the `campus_ai` database (and all tables) on first start.

Server runs on `http://localhost:4000`. Allowed client origin (CORS) is `CLIENT_ORIGIN`.

## API

All routes (except signup/login/forgot-password/reset-password) require `Authorization: Bearer <token>`.

| Section       | Routes                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| Auth          | `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`, `PUT /api/auth/me`, `POST /api/auth/change-password`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` |
| Users         | `GET /api/users?q=`, `GET /api/users/:id`, `POST/DELETE /api/users/:id/follow`                               |
| Posts (Feed)  | `GET /api/posts`, `POST /api/posts`, `POST /api/posts/:id/like`, `GET/POST /api/posts/:id/comments`          |
| Events        | `GET /api/events`, `POST /api/events`, `POST /api/events/:id/rsvp`                                           |
| Documents     | `GET /api/documents`, `POST /api/documents` (multipart `file` + `title`), `GET /api/documents/:id/download`  |
| Notifications | `GET /api/notifications`, `POST /api/notifications/read-all`                                                 |
| AI Chat       | `POST /api/ai/chat`                                                                                          |
| Messages      | `GET /api/messages/conversations`, `GET /api/messages/:userId`, `POST /api/messages`                         |

## Realtime

Socket.IO mounted on the same port. Connect with:

```js
io("http://localhost:4000", { auth: { token } });
```

Events:
- `message:new` — pushed to both sender and recipient sockets when a DM is sent.

## Storage

- MySQL database `campus_ai` (created automatically)
- Uploaded PDFs go to `backend/uploads/` (gitignored)
