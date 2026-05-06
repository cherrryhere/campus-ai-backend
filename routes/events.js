import { Router } from "express";
import db from "../db.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

async function enrich(e, userId) {
  const rsvps = (await db.prepare("SELECT COUNT(*) AS c FROM event_rsvps WHERE event_id = ?").get(e.id)).c;
  const rsvped = !!(await db
    .prepare("SELECT 1 AS x FROM event_rsvps WHERE event_id = ? AND user_id = ?")
    .get(e.id, userId));
  return { ...e, rsvps, rsvped };
}

router.get("/", authRequired, async (req, res) => {
  const rows = await db.prepare("SELECT * FROM events ORDER BY created_at DESC LIMIT 100").all();
  const enriched = await Promise.all(rows.map((e) => enrich(e, req.userId)));
  res.json({ events: enriched });
});

router.post("/", authRequired, async (req, res) => {
  const { title, category, description, event_date, event_time, location } = req.body || {};
  if (!title) return res.status(400).json({ error: "Title required" });
  const info = await db
    .prepare(
      `INSERT INTO events (title, category, description, event_date, event_time, location, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(title, category || null, description || null, event_date || null, event_time || null, location || null, req.userId);

  const event = await db.prepare("SELECT * FROM events WHERE id = ?").get(info.lastInsertRowid);
  res.json({ event: await enrich(event, req.userId) });
});

router.delete("/:id", authRequired, async (req, res) => {
  const e = await db.prepare("SELECT created_by FROM events WHERE id = ?").get(req.params.id);
  if (!e) return res.status(404).json({ error: "Not found" });
  if (e.created_by !== req.userId) return res.status(403).json({ error: "Forbidden" });
  await db.prepare("DELETE FROM events WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.post("/:id/rsvp", authRequired, async (req, res) => {
  const event = await db.prepare("SELECT id FROM events WHERE id = ?").get(req.params.id);
  if (!event) return res.status(404).json({ error: "Not found" });
  const exists = await db
    .prepare("SELECT 1 AS x FROM event_rsvps WHERE event_id = ? AND user_id = ?")
    .get(event.id, req.userId);
  if (exists) {
    await db.prepare("DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?").run(event.id, req.userId);
  } else {
    await db.prepare("INSERT INTO event_rsvps (event_id, user_id) VALUES (?, ?)").run(event.id, req.userId);
  }
  res.json({ rsvped: !exists });
});

export default router;
