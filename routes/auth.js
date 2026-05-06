import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import db from "../db.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

const sign = (user) =>
  jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "30d" });

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  branch: u.branch,
  year: u.year,
  interests: u.interests,
  bio: u.bio,
  is_admin: !!u.is_admin,
});

router.post("/signup", async (req, res) => {
  const { name, email, password, branch, year, interests } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "Missing fields" });
  if (password.length < 6) return res.status(400).json({ error: "Password too short" });

  const normEmail = String(email).trim().toLowerCase();
  const exists = await db.prepare("SELECT id FROM users WHERE email = ?").get(normEmail);
  if (exists) return res.status(409).json({ error: "Email already registered" });

  const hash = await bcrypt.hash(password, 10);
  const info = await db
    .prepare("INSERT INTO users (name, email, password, branch, year, interests) VALUES (?, ?, ?, ?, ?, ?)")
    .run(name.trim(), normEmail, hash, branch || null, year || null, interests || null);

  const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  res.json({ token: sign(user), user: publicUser(user) });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Missing fields" });

  const user = await db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).trim().toLowerCase());
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  res.json({ token: sign(user), user: publicUser(user) });
});

router.get("/me", authRequired, async (req, res) => {
  const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json({ user: publicUser(user) });
});

router.put("/me", authRequired, async (req, res) => {
  const { name, branch, year, interests, bio } = req.body || {};
  await db
    .prepare("UPDATE users SET name = COALESCE(?, name), branch = ?, year = ?, interests = ?, bio = ? WHERE id = ?")
    .run(name || null, branch || null, year || null, interests || null, bio || null, req.userId);
  const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  res.json({ user: publicUser(user) });
});

router.post("/change-password", authRequired, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ error: "Missing fields" });
  if (newPassword.length < 6) return res.status(400).json({ error: "Password too short" });

  const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  const ok = await bcrypt.compare(oldPassword, user.password);
  if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

  const hash = await bcrypt.hash(newPassword, 10);
  await db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hash, req.userId);
  res.json({ ok: true });
});

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email required" });
  const user = await db.prepare("SELECT id FROM users WHERE email = ?").get(String(email).trim().toLowerCase());
  if (!user) return res.json({ ok: true });

  const token = crypto.randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  await db
    .prepare("INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)")
    .run(token, user.id, expires);

  res.json({ ok: true, token });
});

router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: "Missing fields" });
  if (password.length < 6) return res.status(400).json({ error: "Password too short" });

  const row = await db
    .prepare("SELECT * FROM password_reset_tokens WHERE token = ?")
    .get(token);
  if (!row) return res.status(400).json({ error: "Invalid token" });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.prepare("DELETE FROM password_reset_tokens WHERE token = ?").run(token);
    return res.status(400).json({ error: "Token expired" });
  }

  const hash = await bcrypt.hash(password, 10);
  await db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hash, row.user_id);
  await db.prepare("DELETE FROM password_reset_tokens WHERE token = ?").run(token);
  res.json({ ok: true });
});

export default router;
