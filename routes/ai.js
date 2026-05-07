import { Router } from "express";
import multer from "multer";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import db from "../db.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "application/pdf" ||
      file.mimetype.startsWith("text/") ||
      file.originalname.match(/\.(txt|md|csv|json|log)$/i);
    if (ok) cb(null, true);
    else cb(new Error("Only PDF or text files are allowed"));
  },
});

const STOP = new Set([
  "the","a","an","is","of","to","in","on","for","and","or","my","me","i","you","what",
  "how","when","where","why","do","does","please","tell","show","list","about",
  "summarise","summarize","build","plan","get","give","make","next","this","that","with","at",
]);

function tokenize(s) {
  return String(s || "")
    .toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/)
    .filter((w) => w && w.length > 2 && !STOP.has(w));
}

function scoreDoc(doc, qTokens) {
  const haystack = `${doc.title} ${doc.category || ""} ${doc.file_name || ""}`.toLowerCase();
  let score = 0;
  for (const t of qTokens) {
    if (haystack.includes(t)) score += 2;
    if ((doc.category || "").toLowerCase() === t) score += 3;
    if ((doc.title || "").toLowerCase().split(/\s+/).includes(t)) score += 2;
  }
  return score;
}

const IITH_PROFILE = `You are Campus AI Copilot for IIT Hyderabad (IITH).
About IITH: Established 2008. Located at Kandi, Sangareddy district, Telangana, India. Second-generation IIT known for its fractal academic curriculum and research focus.
Departments: CSE, EE, ME, CE, CHE, MSME, AI, BT, EP, MA, CY, PH, BME, Liberal Arts, Climate Change, Design.
Programs: B.Tech, M.Tech, M.Sc, M.Des, MA, PhD, Dual Degree.
Hostels: letter-named blocks (Aryabhata, Bhaskara, Charaka, Dronacharya, Ekalavya, Falaki, Gargi, Himalaya, etc.).
Major fests: Elan & nVision (annual techno-cultural fest), Sangam (sports + cultural), department fests.
Academic calendar: Aug–Dec and Jan–May semesters; mid-sems mid-Oct & mid-Mar; end-sems Nov & Apr/May.
Placement cell starts campus drives around Nov–Dec.
Style: Be concise, practical, friendly. Use short paragraphs or bullet lists. If a file is attached, use it as the primary source.`;

function buildSystemPrompt(allDocs, topDoc, fileText, fileName) {
  const docList = allDocs.length
    ? allDocs.map((d) => `- "${d.title}" (${d.category || "Document"})`).join("\n")
    : "(none uploaded yet)";
  let prompt = `${IITH_PROFILE}\n\nUploaded knowledge-base documents:\n${docList}\n`;
  if (topDoc) prompt += `\nMost relevant document for this question: "${topDoc.title}" (${topDoc.category || "Document"}).`;
  if (fileText && fileName) {
    const trimmed = fileText.length > 8000 ? fileText.slice(0, 8000) + "\n…(truncated)" : fileText;
    prompt += `\n\nThe student attached a file named "${fileName}". Contents:\n--- FILE START ---\n${trimmed}\n--- FILE END ---`;
  }
  return prompt;
}

async function callGroq(question, system) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: question }],
        temperature: 0.7, max_tokens: 800,
      }),
    });
    if (!res.ok) { console.error("Groq error:", res.status, await res.text()); return null; }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (err) { console.error("Groq failed:", err.message); return null; }
}

async function callGemini(question, system) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${system}\n\nStudent question: ${question}` }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
      }),
    });
    if (!res.ok) { console.error("Gemini error:", res.status, await res.text()); return null; }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("\n") || null;
  } catch (err) { console.error("Gemini failed:", err.message); return null; }
}

async function callLLM(question, system) {
  const groq = await callGroq(question, system);
  if (groq) return { text: groq, provider: "groq" };
  const gem = await callGemini(question, system);
  if (gem) return { text: gem, provider: "gemini" };
  return null;
}

async function extractFileText(file) {
  if (!file) return null;
  try {
    if (file.mimetype === "application/pdf") {
      const data = await pdfParse(file.buffer);
      return data.text || "";
    }
    return file.buffer.toString("utf-8");
  } catch (err) { console.error("File extraction failed:", err.message); return null; }
}

function stubAnswer(question) {
  const q = (question || "").toLowerCase();
  if (q.includes("study plan") || q.includes("dsa")) {
    return [
      "Here's a 7-day DSA plan you can adapt:",
      "• Day 1: Arrays & Strings — 8 problems",
      "• Day 2: Hashing — 6 problems",
      "• Day 3: Two Pointers / Sliding Window — 6 problems",
      "• Day 4: Linked Lists & Stacks — 6 problems",
      "• Day 5: Trees & BST — 8 problems",
      "• Day 6: Graphs (BFS/DFS) — 6 problems",
      "• Day 7: DP intro — 5 problems + revision",
    ].join("\n");
  }
  return `I don't have a college document that directly matches "${question}" yet. Ask the admin to upload the relevant PDF, then ask me again.`;
}

/* ---------- Conversations CRUD ---------- */

router.get("/conversations", authRequired, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
              (SELECT content FROM chat_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS preview
       FROM chat_conversations c WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`
    )
    .all(req.userId);
  res.json({ conversations: rows });
});

router.post("/conversations", authRequired, async (req, res) => {
  const title = (req.body?.title || "New chat").toString().slice(0, 200);
  const info = await db
    .prepare("INSERT INTO chat_conversations (user_id, title) VALUES (?, ?)")
    .run(req.userId, title);
  const conv = await db.prepare("SELECT * FROM chat_conversations WHERE id = ?").get(info.lastInsertRowid);
  res.json({ conversation: conv });
});

router.get("/conversations/:id", authRequired, async (req, res) => {
  const conv = await db
    .prepare("SELECT * FROM chat_conversations WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId);
  if (!conv) return res.status(404).json({ error: "Not found" });
  const messages = await db
    .prepare("SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC")
    .all(conv.id);
  res.json({
    conversation: conv,
    messages: messages.map((m) => ({
      ...m,
      related: m.related_json ? JSON.parse(m.related_json) : [],
    })),
  });
});

router.put("/conversations/:id", authRequired, async (req, res) => {
  const title = (req.body?.title || "").toString().slice(0, 200);
  await db
    .prepare("UPDATE chat_conversations SET title = ? WHERE id = ? AND user_id = ?")
    .run(title, req.params.id, req.userId);
  res.json({ ok: true });
});

router.delete("/conversations/:id", authRequired, async (req, res) => {
  await db
    .prepare("DELETE FROM chat_conversations WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.userId);
  res.json({ ok: true });
});

/* ---------- Chat ---------- */

router.post("/chat", authRequired, chatUpload.single("file"), async (req, res) => {
  const question = (req.body.question || "").toString().trim();
  let conversationId = req.body.conversation_id ? Number(req.body.conversation_id) : null;

  if (!question && !req.file) return res.status(400).json({ error: "Question or file required" });

  // Ensure a conversation exists
  if (conversationId) {
    const conv = await db
      .prepare("SELECT id FROM chat_conversations WHERE id = ? AND user_id = ?")
      .get(conversationId, req.userId);
    if (!conv) conversationId = null;
  }
  if (!conversationId) {
    const title = (question || req.file?.originalname || "New chat").slice(0, 80);
    const info = await db
      .prepare("INSERT INTO chat_conversations (user_id, title) VALUES (?, ?)")
      .run(req.userId, title);
    conversationId = info.lastInsertRowid;
  }

  const fileText = await extractFileText(req.file);
  const fileName = req.file?.originalname || null;

  const docs = await db
    .prepare("SELECT id, title, file_name, category FROM documents ORDER BY created_at DESC LIMIT 100")
    .all();

  const qTokens = tokenize(question);
  const scored = docs
    .map((d) => ({ doc: d, score: scoreDoc(d, qTokens) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0]?.doc || null;
  const related = scored.slice(0, 3).map((s) => s.doc);

  const userQuestion = question || (fileName ? `Analyse the attached file "${fileName}" and summarise the key points.` : "");
  const system = buildSystemPrompt(docs, top, fileText, fileName);
  const llm = await callLLM(userQuestion, system);
  const answer = llm?.text || stubAnswer(question);
  const provider = llm?.provider || "stub";

  // Persist both messages
  await db
    .prepare("INSERT INTO chat_messages (conversation_id, role, content, attachment_name) VALUES (?, 'user', ?, ?)")
    .run(conversationId, userQuestion, fileName);
  await db
    .prepare("INSERT INTO chat_messages (conversation_id, role, content, source, related_json, powered_by) VALUES (?, 'assistant', ?, ?, ?, ?)")
    .run(conversationId, answer, top?.file_name || null, related.length ? JSON.stringify(related) : null, provider);

  // Touch conversation
  await db.prepare("UPDATE chat_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(conversationId);

  res.json({
    conversation_id: conversationId,
    answer,
    source: top ? top.file_name : null,
    related,
    powered_by: provider,
    attachment: fileName ? { name: fileName, chars: fileText?.length || 0 } : null,
  });
});

router.get("/suggestions", authRequired, async (_req, res) => {
  const docs = await db
    .prepare("SELECT id, title, file_name, category FROM documents ORDER BY created_at DESC LIMIT 20")
    .all();
  const general = [
    { q: "Summarise the IITH placement policy", category: "Placement" },
    { q: "What is the IITH attendance requirement?", category: "Notice" },
    { q: "When does the next IITH semester start?", category: "Exam" },
    { q: "Tell me about the IITH hostel system", category: "Notice" },
    { q: "Explain the fractal academic curriculum at IITH", category: "Syllabus" },
    { q: "Build me a 7-day DSA study plan", category: "Plan" },
    { q: "What is Elan & nVision?", category: "Plan" },
    { q: "How does IITH placements process work?", category: "Placement" },
  ];
  const dynamic = docs.slice(0, 4).map((d) => ({
    q: `Summarise "${d.title}"`,
    category: d.category || "Document",
    documentId: d.id,
  }));
  res.json({ suggestions: [...dynamic, ...general] });
});

export default router;
