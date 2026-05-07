import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import db from "../db.js";
import { authRequired, notSuspended } from "../middleware/auth.js";
import { applyModeration } from "../lib/moderation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const postImgDir = path.join(__dirname, "..", "uploads", "posts");
if (!fs.existsSync(postImgDir)) fs.mkdirSync(postImgDir, { recursive: true });

const postUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, postImgDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `p${req.userId}_${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

const router = Router();

async function enrichPost(p, userId) {
  const likes = (await db.prepare("SELECT COUNT(*) AS c FROM post_likes WHERE post_id = ?").get(p.id)).c;
  const comments = (await db.prepare("SELECT COUNT(*) AS c FROM post_comments WHERE post_id = ?").get(p.id)).c;
  const liked = !!(await db
    .prepare("SELECT 1 AS x FROM post_likes WHERE post_id = ? AND user_id = ?")
    .get(p.id, userId));
  const author = await db
    .prepare("SELECT id, name, branch, year, avatar_path FROM users WHERE id = ?")
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
  const tag = (req.query.tag || "").toString().trim().replace(/^#/, "").toLowerCase();
  let rows;
  if (tag) {
    rows = await db
      .prepare("SELECT * FROM posts WHERE LOWER(tags) LIKE ? ORDER BY pinned DESC, created_at DESC LIMIT 100")
      .all(`%${tag}%`);
  } else {
    rows = await db
      .prepare("SELECT * FROM posts ORDER BY pinned DESC, created_at DESC LIMIT 100")
      .all();
  }
  const enriched = await Promise.all(rows.map((p) => enrichPost(p, req.userId)));
  res.json({ posts: enriched });
});

router.get("/trending", authRequired, async (_req, res) => {
  const rows = await db.prepare("SELECT tags FROM posts WHERE tags IS NOT NULL AND tags != ''").all();
  const counts = new Map();
  for (const r of rows) {
    try {
      const tags = JSON.parse(r.tags);
      if (!Array.isArray(tags)) continue;
      for (const raw of tags) {
        if (!raw) continue;
        const norm = `#${String(raw).replace(/^#/, "").toLowerCase()}`;
        counts.set(norm, (counts.get(norm) || 0) + 1);
      }
    } catch { /* skip */ }
  }
  const trending = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  res.json({ trending });
});

router.post("/", authRequired, notSuspended, postUpload.single("image"), async (req, res) => {
  const content = (req.body.content || "").toString().trim();
  if (!content && !req.file) return res.status(400).json({ error: "Content or image required" });

  const moderation = await applyModeration(req.userId, content);
  if (moderation.blocked) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch { /* noop */ }
    return res.status(moderation.status).json(moderation.body);
  }

  let tags = null;
  try {
    if (req.body.tags) {
      const parsed = typeof req.body.tags === "string" ? JSON.parse(req.body.tags) : req.body.tags;
      if (Array.isArray(parsed)) tags = JSON.stringify(parsed);
    }
  } catch { /* ignore bad tags */ }

  const info = await db
    .prepare("INSERT INTO posts (author_id, content, tags, image_path, pinned) VALUES (?, ?, ?, ?, ?)")
    .run(req.userId, content || "", tags, req.file?.filename || null, 0);

  const post = await db.prepare("SELECT * FROM posts WHERE id = ?").get(info.lastInsertRowid);
  res.json({ post: await enrichPost(post, req.userId) });
});

router.delete("/:id", authRequired, async (req, res) => {
  const post = await db.prepare("SELECT author_id, image_path FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });
  if (post.author_id !== req.userId) return res.status(403).json({ error: "Forbidden" });
  if (post.image_path) {
    try { fs.unlinkSync(path.join(postImgDir, post.image_path)); } catch { /* noop */ }
  }
  await db.prepare("DELETE FROM posts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.post("/:id/like", authRequired, notSuspended, async (req, res) => {
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

  const liked = !existing;
  const likes = (await db.prepare("SELECT COUNT(*) AS c FROM post_likes WHERE post_id = ?").get(post.id)).c;
  res.json({ liked, likes });
});

router.get("/:id/comments", authRequired, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT c.id, c.post_id, c.user_id, c.content, c.created_at,
              u.name AS author_name, u.avatar_path AS author_avatar
       FROM post_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? ORDER BY c.created_at ASC`
    )
    .all(req.params.id);
  res.json({ comments: rows });
});

router.post("/:id/comments", authRequired, notSuspended, async (req, res) => {
  const content = (req.body?.content || "").toString().trim();
  if (!content) return res.status(400).json({ error: "Content required" });

  const moderation = await applyModeration(req.userId, content);
  if (moderation.blocked) return res.status(moderation.status).json(moderation.body);

  const post = await db.prepare("SELECT id, author_id FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });

  const info = await db
    .prepare("INSERT INTO post_comments (post_id, user_id, content) VALUES (?, ?, ?)")
    .run(post.id, req.userId, content);

  const comment = await db
    .prepare(
      `SELECT c.id, c.post_id, c.user_id, c.content, c.created_at,
              u.name AS author_name, u.avatar_path AS author_avatar
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
