import { Router } from "express";
import db from "../db.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

router.post("/chat", authRequired, async (req, res) => {
  const { question } = req.body || {};
  if (!question) return res.status(400).json({ error: "Question required" });

  const docs = await db
    .prepare("SELECT id, title, file_name, category FROM documents ORDER BY created_at DESC LIMIT 50")
    .all();
  const q = question.toLowerCase();

  let match =
    docs.find((d) => q.includes(d.title.toLowerCase().split(" ")[0])) ||
    docs.find((d) => d.category && q.includes(d.category.toLowerCase()));

  const answer = match
    ? `Based on "${match.title}", here is a placeholder answer for: "${question}". Wire this route to LangChain/LlamaIndex with FAISS or ChromaDB to return real RAG-grounded responses.`
    : `I don't have a college document that directly matches "${question}" yet. Ask the admin to upload the relevant PDF, then ask again.`;

  res.json({
    answer,
    source: match ? match.file_name : null,
    suggested: docs.slice(0, 3).map((d) => d.title),
  });
});

export default router;
