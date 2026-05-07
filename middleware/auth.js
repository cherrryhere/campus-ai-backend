import jwt from "jsonwebtoken";
import db from "../db.js";

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

export async function adminRequired(req, res, next) {
  const user = await db.prepare("SELECT id, is_admin FROM users WHERE id = ?").get(req.userId);
  if (!user || !user.is_admin) return res.status(403).json({ error: "Admin only" });
  next();
}

export async function notSuspended(req, res, next) {
  const user = await db.prepare("SELECT id, is_suspended FROM users WHERE id = ?").get(req.userId);
  if (user?.is_suspended) {
    return res.status(403).json({ error: "Account suspended due to repeated policy violations.", suspended: true });
  }
  next();
}
