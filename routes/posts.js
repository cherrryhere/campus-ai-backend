import { Router } from "express";
import db from "../db.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

async function enrichPost(p, userId) {
  const likes = (await db.prepare("SELECT COUNT(*) AS c FROM post_likes WHERE post_id = ?").get(p.id)).c;
  const comments = (await db.prepare("SELECT COUNT(*) AS c FROM post_comments WHERE post_id = ?").get(p.id)).c;
  const liked = !!(await db
    .prepare("SELECT 1 AS x FROM post_likes WHERE post_id = ? AND user_id = ?")
    .get(p.id, userId));
  const author = await db
    .prepare("SELECT id, name, branch, year FROM users WHERE id = ?")
    .get(p.author_id);
  return {
    ...p,
    pinned: !!p.pinned,
    tags: p.tags ? JSON.parse(p.tags) : [],
    author,
    likes,
    comments,
    liked,
  };
}

router.get("/", authRequired, async (req, res) => {
  const rows = await db
    .prepare("SELECT * FROM posts ORDER BY pinned DESC, created_at DESC LIMIT 100")
    .all();
  const enriched = await Promise.all(rows.map((p) => enrichPost(p, req.userId)));
  res.json({ posts: enriched });
});

router.post("/", authRequired, async (req, res) => {
  const { content, tags, pinned } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: "Content required" });

  const info = await db
    .prepare("INSERT INTO posts (author_id, content, tags, pinned) VALUES (?, ?, ?, ?)")
    .run(req.userId, content.trim(), tags ? JSON.stringify(tags) : null, pinned ? 1 : 0);

  const post = await db.prepare("SELECT * FROM posts WHERE id = ?").get(info.lastInsertRowid);
  res.json({ post: await enrichPost(post, req.userId) });
});

router.delete("/:id", authRequired, async (req, res) => {
  const post = await db.prepare("SELECT author_id FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });
  if (post.author_id !== req.userId) return res.status(403).json({ error: "Forbidden" });
  await db.prepare("DELETE FROM posts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.post("/:id/like", authRequired, async (req, res) => {
  const post = await db.prepare("SELECT id, author_id FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });
  const existing = await db
    .prepare("SELECT 1 AS x FROM post_likes WHERE post_id = ? AND user_id = ?")
    .get(post.id, req.userId);
  if (existing) {
    await db.prepare("DELETE FROM post_likes WHERE post_id = ? AND user_id = ?").run(post.id, req.userId);
  } else {
    await db.prepare("INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)").run(post.id, req.userId);
    if (post.author_id !== req.userId) {
      const me = await db.prepare("SELECT name FROM users WHERE id = ?").get(req.userId);
      await db
        .prepare("INSERT INTO notifications (user_id, type, title) VALUES (?, 'social', ?)")
        .run(post.author_id, `${me.name} liked your post`);
    }
  }
  res.json({ liked: !existing });
});

router.get("/:id/comments", authRequired, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT c.id, c.post_id, c.user_id, c.content, c.created_at,
              u.name AS author_name
       FROM post_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? ORDER BY c.created_at ASC`
    )
    .all(req.params.id);
  res.json({ comments: rows });
});

router.post("/:id/comments", authRequired, async (req, res) => {
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: "Content required" });
  const post = await db.prepare("SELECT id, author_id FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });

  const info = await db
    .prepare("INSERT INTO post_comments (post_id, user_id, content) VALUES (?, ?, ?)")
    .run(post.id, req.userId, content.trim());

  const comment = await db
    .prepare(
      `SELECT c.id, c.post_id, c.user_id, c.content, c.created_at, u.name AS author_name
       FROM post_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`
    )
    .get(info.lastInsertRowid);

  if (post.author_id !== req.userId) {
    const me = await db.prepare("SELECT name FROM users WHERE id = ?").get(req.userId);
    await db
      .prepare("INSERT INTO notifications (user_id, type, title) VALUES (?, 'social', ?)")
      .run(post.author_id, `${me.name} commented on your post`);
  }

  res.json({ comment });
});

export default router;
