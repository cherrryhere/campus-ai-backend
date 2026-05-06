import { Router } from "express";
import db from "../db.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

router.get("/", authRequired, async (req, res) => {
  const rows = await db
    .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50")
    .all(req.userId);
  res.json({ notifications: rows.map((n) => ({ ...n, is_read: !!n.is_read })) });
});

router.post("/:id/read", authRequired, async (req, res) => {
  await db
    .prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.userId);
  res.json({ ok: true });
});

router.post("/read-all", authRequired, async (req, res) => {
  await db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(req.userId);
  res.json({ ok: true });
});

export default router;
