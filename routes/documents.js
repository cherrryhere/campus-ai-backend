import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import db from "../db.js";
import { authRequired } from "../middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") return cb(new Error("Only PDF allowed"));
    cb(null, true);
  },
});

const router = Router();

router.get("/", authRequired, async (_req, res) => {
  const rows = await db.prepare("SELECT * FROM documents ORDER BY created_at DESC").all();
  res.json({ documents: rows });
});

router.post("/", authRequired, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "PDF file required" });
  const { title, category } = req.body || {};
  if (!title) return res.status(400).json({ error: "Title required" });

  const info = await db
    .prepare(
      `INSERT INTO documents (title, category, file_name, file_path, status, uploaded_by)
       VALUES (?, ?, ?, ?, 'Processed', ?)`
    )
    .run(title, category || "Notice", req.file.originalname, req.file.filename, req.userId);

  const doc = await db.prepare("SELECT * FROM documents WHERE id = ?").get(info.lastInsertRowid);
  res.json({ document: doc });
});

router.get("/:id/download", authRequired, async (req, res) => {
  const doc = await db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
  if (!doc) return res.status(404).json({ error: "Not found" });
  res.download(path.join(uploadDir, doc.file_path), doc.file_name);
});

router.delete("/:id", authRequired, async (req, res) => {
  const doc = await db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
  if (!doc) return res.status(404).json({ error: "Not found" });
  if (doc.uploaded_by !== req.userId) return res.status(403).json({ error: "Forbidden" });
  try { fs.unlinkSync(path.join(uploadDir, doc.file_path)); } catch { /* noop */ }
  await db.prepare("DELETE FROM documents WHERE id = ?").run(doc.id);
  res.json({ ok: true });
});

export default router;
