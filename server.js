import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server as SocketIOServer } from "socket.io";
import jwt from "jsonwebtoken";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import db, { initDb } from "./db.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import postRoutes from "./routes/posts.js";
import eventRoutes from "./routes/events.js";
import documentRoutes from "./routes/documents.js";
import notificationRoutes from "./routes/notifications.js";
import aiRoutes from "./routes/ai.js";
import { buildMessagesRouter } from "./routes/messages.js";

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

if (!process.env.JWT_SECRET) {
  console.warn("[warn] JWT_SECRET is not set — using insecure dev fallback. Set it in .env for production.");
  process.env.JWT_SECRET = "dev-insecure-secret";
}

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: CLIENT_ORIGIN } });

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/uploads/avatars", express.static(path.join(__dirname, "uploads", "avatars")));
app.use("/uploads/posts", express.static(path.join(__dirname, "uploads", "posts")));

const userSockets = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Missing token"));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = payload.id;
    next();
  } catch {
    next(new Error("Invalid token"));
  }
});

io.on("connection", (socket) => {
  userSockets.set(socket.userId, socket.id);
  socket.on("disconnect", () => {
    if (userSockets.get(socket.userId) === socket.id) userSockets.delete(socket.userId);
  });
});

app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/messages", buildMessagesRouter(io, userSockets));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

async function start() {
  await initDb();
  server.listen(PORT, () => {
    console.log(`Campus AI backend running on http://localhost:${PORT}`);
    console.log(`Allowed client origin: ${CLIENT_ORIGIN}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

export { db };
