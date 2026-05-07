import { Router } from "express";
import db from "../db.js";
import { authRequired, notSuspended } from "../middleware/auth.js";
import { applyModeration } from "../lib/moderation.js";

export function buildMessagesRouter(io, userSockets) {
  const router = Router();

  router.get("/conversations", authRequired, async (req, res) => {
    const rows = await db
      .prepare(
        `SELECT u.id, u.name, u.branch, u.year,
                (SELECT content FROM messages
                  WHERE (sender_id = u.id AND recipient_id = ?) OR (sender_id = ? AND recipient_id = u.id)
                  ORDER BY created_at DESC LIMIT 1) AS last_message,
                (SELECT created_at FROM messages
                  WHERE (sender_id = u.id AND recipient_id = ?) OR (sender_id = ? AND recipient_id = u.id)
                  ORDER BY created_at DESC LIMIT 1) AS last_at,
                (SELECT COUNT(*) FROM messages
                  WHERE sender_id = u.id AND recipient_id = ? AND is_read = 0) AS unread
         FROM users u
         WHERE u.id IN (
           SELECT DISTINCT recipient_id FROM messages WHERE sender_id = ?
           UNION
           SELECT DISTINCT sender_id FROM messages WHERE recipient_id = ?
         )
         ORDER BY last_at DESC`
      )
      .all(req.userId, req.userId, req.userId, req.userId, req.userId, req.userId, req.userId);
    res.json({ conversations: rows });
  });

  router.get("/:userId", authRequired, async (req, res) => {
    const otherId = Number(req.params.userId);
    const rows = await db
      .prepare(
        `SELECT * FROM messages
         WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
         ORDER BY created_at ASC LIMIT 200`
      )
      .all(req.userId, otherId, otherId, req.userId);
    await db
      .prepare("UPDATE messages SET is_read = 1 WHERE sender_id = ? AND recipient_id = ?")
      .run(otherId, req.userId);
    res.json({ messages: rows.map((m) => ({ ...m, is_read: !!m.is_read })) });
  });

  router.post("/", authRequired, notSuspended, async (req, res) => {
    const { recipient_id, content } = req.body || {};
    if (!recipient_id || !content || !content.trim())
      return res.status(400).json({ error: "recipient_id and content required" });
    if (Number(recipient_id) === req.userId)
      return res.status(400).json({ error: "Cannot message yourself" });

    const moderation = await applyModeration(req.userId, content);
    if (moderation.blocked) return res.status(moderation.status).json(moderation.body);

    const recipient = await db.prepare("SELECT id FROM users WHERE id = ?").get(recipient_id);
    if (!recipient) return res.status(404).json({ error: "Recipient not found" });

    const info = await db
      .prepare("INSERT INTO messages (sender_id, recipient_id, content) VALUES (?, ?, ?)")
      .run(req.userId, recipient_id, content.trim());
    const msg = await db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid);
    const payload = { ...msg, is_read: false };

    const sender = await db.prepare("SELECT name FROM users WHERE id = ?").get(req.userId);
    await db
      .prepare("INSERT INTO notifications (user_id, type, title) VALUES (?, 'message', ?)")
      .run(recipient_id, `New message from ${sender.name}`);

    const targetSocket = userSockets.get(Number(recipient_id));
    if (targetSocket) io.to(targetSocket).emit("message:new", payload);
    const senderSocket = userSockets.get(req.userId);
    if (senderSocket) io.to(senderSocket).emit("message:new", payload);

    res.json({ message: payload });
  });

  return router;
}
