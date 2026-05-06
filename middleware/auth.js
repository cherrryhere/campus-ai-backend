import jwt from "jsonwebtoken";

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

export function adminRequired(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: "Admin only" });
  next();
}

export function loadUser(db) {
  return (req, _res, next) => {
    if (req.userId) {
      req.user = db.prepare("SELECT id, name, email, is_admin FROM users WHERE id = ?").get(req.userId);
    }
    next();
  };
}
