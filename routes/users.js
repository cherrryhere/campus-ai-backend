import { Router } from "express";
import db from "../db.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

router.get("/", authRequired, async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = await db
      .prepare(
        `SELECT id, name, email, branch, year, interests, avatar_path
         FROM users
         WHERE id != ? AND (name LIKE ? OR branch LIKE ? OR interests LIKE ?)
         ORDER BY name LIMIT 100`
      )
      .all(req.userId, like, like, like);
  } else {
    rows = await db
      .prepare(
        `SELECT id, name, email, branch, year, interests, avatar_path
         FROM users WHERE id != ? ORDER BY created_at DESC LIMIT 100`
      )
      .all(req.userId);
  }

  const followingRows = await db
    .prepare("SELECT following_id FROM follows WHERE follower_id = ?")
    .all(req.userId);
  const followingSet = new Set(followingRows.map((r) => r.following_id));
  res.json({ users: rows.map((u) => ({ ...u, is_following: followingSet.has(u.id) })) });
});

router.get("/:id", authRequired, async (req, res) => {
  const user = await db
    .prepare("SELECT id, name, email, branch, year, interests, bio, avatar_path, is_admin, is_suspended, created_at FROM users WHERE id = ?")
    .get(req.params.id);
  if (!user) return res.status(404).json({ error: "Not found" });

  const followers = await db.prepare("SELECT COUNT(*) AS c FROM follows WHERE following_id = ?").get(user.id);
  const following = await db.prepare("SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?").get(user.id);
  const posts = await db.prepare("SELECT COUNT(*) AS c FROM posts WHERE author_id = ?").get(user.id);
  const isFollowing = !!(await db
    .prepare("SELECT 1 AS x FROM follows WHERE follower_id = ? AND following_id = ?")
    .get(req.userId, user.id));

  const userPosts = await db
    .prepare("SELECT * FROM posts WHERE author_id = ? ORDER BY created_at DESC LIMIT 20")
    .all(user.id);

  res.json({
    user: { ...user, is_admin: !!user.is_admin, is_suspended: !!user.is_suspended },
    counts: { followers: followers.c, following: following.c, posts: posts.c },
    is_following: isFollowing,
    posts: userPosts.map((p) => ({ ...p, pinned: !!p.pinned, tags: p.tags ? JSON.parse(p.tags) : [] })),
  });
});

router.get("/:id/followers", authRequired, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT u.id, u.name, u.branch, u.year, u.avatar_path
       FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.following_id = ? ORDER BY f.created_at DESC LIMIT 200`
    )
    .all(req.params.id);
  const myFollowing = await db
    .prepare("SELECT following_id FROM follows WHERE follower_id = ?")
    .all(req.userId);
  const followingSet = new Set(myFollowing.map((r) => r.following_id));
  res.json({ users: rows.map((u) => ({ ...u, is_following: followingSet.has(u.id) })) });
});

router.get("/:id/following", authRequired, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT u.id, u.name, u.branch, u.year, u.avatar_path
       FROM follows f JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT 200`
    )
    .all(req.params.id);
  const myFollowing = await db
    .prepare("SELECT following_id FROM follows WHERE follower_id = ?")
    .all(req.userId);
  const followingSet = new Set(myFollowing.map((r) => r.following_id));
  res.json({ users: rows.map((u) => ({ ...u, is_following: followingSet.has(u.id) })) });
});

router.post("/:id/follow", authRequired, async (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.userId) return res.status(400).json({ error: "Cannot follow yourself" });
  const target = await db.prepare("SELECT id, name FROM users WHERE id = ?").get(targetId);
  if (!target) return res.status(404).json({ error: "User not found" });

  await db
    .prepare("INSERT IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)")
    .run(req.userId, targetId);

  const me = await db.prepare("SELECT name FROM users WHERE id = ?").get(req.userId);
  await db
    .prepare("INSERT INTO notifications (user_id, type, title) VALUES (?, 'social', ?)")
    .run(targetId, `${me.name} started following you`);

  res.json({ ok: true });
});

router.delete("/:id/follow", authRequired, async (req, res) => {
  await db
    .prepare("DELETE FROM follows WHERE follower_id = ? AND following_id = ?")
    .run(req.userId, req.params.id);
  res.json({ ok: true });
});

export default router;
