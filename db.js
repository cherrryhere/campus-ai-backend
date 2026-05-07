import "dotenv/config";
import mysql from "mysql2/promise";

let pool;

const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    branch VARCHAR(100),
    year VARCHAR(50),
    interests VARCHAR(500),
    bio VARCHAR(500),
    avatar_path VARCHAR(500),
    warnings INT DEFAULT 0,
    is_suspended TINYINT(1) DEFAULT 0,
    is_admin TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS follows (
    follower_id INT NOT NULL,
    following_id INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, following_id),
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS posts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    author_id INT NOT NULL,
    content TEXT NOT NULL,
    tags VARCHAR(500),
    image_path VARCHAR(500),
    pinned TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS post_likes (
    post_id INT NOT NULL,
    user_id INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS post_comments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    post_id INT NOT NULL,
    user_id INT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS events (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(50),
    description TEXT,
    event_date VARCHAR(100),
    event_time VARCHAR(50),
    location VARCHAR(255),
    created_by INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS event_rsvps (
    event_id INT NOT NULL,
    user_id INT NOT NULL,
    PRIMARY KEY (event_id, user_id),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS documents (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(50),
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'Processed',
    uploaded_by INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    type VARCHAR(50),
    title VARCHAR(500) NOT NULL,
    link VARCHAR(500),
    is_read TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_notifications_user (user_id, is_read, created_at)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    sender_id INT NOT NULL,
    recipient_id INT NOT NULL,
    content TEXT NOT NULL,
    is_read TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_messages_pair (sender_id, recipient_id, created_at)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token VARCHAR(64) PRIMARY KEY,
    user_id INT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_conversations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    title VARCHAR(255),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_chat_conv_user (user_id, updated_at)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    conversation_id INT NOT NULL,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    source VARCHAR(255),
    related_json TEXT,
    attachment_name VARCHAR(255),
    powered_by VARCHAR(20),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
    INDEX idx_chat_msg_conv (conversation_id, created_at)
  ) ENGINE=InnoDB`,
];

// idempotent ALTERs for existing databases
const ALTERS = [
  "ALTER TABLE users ADD COLUMN avatar_path VARCHAR(500)",
  "ALTER TABLE users ADD COLUMN warnings INT DEFAULT 0",
  "ALTER TABLE users ADD COLUMN is_suspended TINYINT(1) DEFAULT 0",
  "ALTER TABLE users ADD COLUMN bio VARCHAR(500)",
  "ALTER TABLE posts ADD COLUMN image_path VARCHAR(500)",
];

export async function initDb() {
  const baseConfig = {
    host: process.env.MYSQL_HOST || "localhost",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    waitForConnections: true,
    connectionLimit: 10,
    timezone: "Z",
  };
  const dbName = process.env.MYSQL_DATABASE || "campus_ai";

  const bootstrap = await mysql.createConnection(baseConfig);
  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await bootstrap.end();

  pool = mysql.createPool({ ...baseConfig, database: dbName });
  // Force every connection to write/read DATETIME values in UTC so the frontend
  // can convert reliably to the viewer's local timezone (e.g., IST).
  // The pool's "connection" event hands back a raw (callback-style) Connection,
  // so we use the callback form here to avoid "tried to call .catch on a non-promise".
  pool.on("connection", (conn) => {
    conn.query("SET SESSION time_zone = '+00:00'", () => {});
  });
  await pool.query("SET SESSION time_zone = '+00:00'");
  for (const sql of TABLES) await pool.query(sql);
  for (const sql of ALTERS) {
    try { await pool.query(sql); } catch { /* column already exists */ }
  }

  // Auto-promote first user to admin if no admin exists yet
  const [admins] = await pool.query("SELECT COUNT(*) AS c FROM users WHERE is_admin = 1");
  if (admins[0].c === 0) {
    const [first] = await pool.query("SELECT id, email FROM users ORDER BY id ASC LIMIT 1");
    if (first[0]) {
      await pool.query("UPDATE users SET is_admin = 1 WHERE id = ?", [first[0].id]);
      console.log(`First admin auto-promoted: ${first[0].email} (id=${first[0].id})`);
    }
  }

  console.log(`MySQL connected: ${baseConfig.user}@${baseConfig.host}:${baseConfig.port}/${dbName}`);
}

const stmt = (sql) => ({
  async run(...args) {
    const [r] = await pool.execute(sql, args);
    return { lastInsertRowid: r.insertId, changes: r.affectedRows };
  },
  async get(...args) {
    const [rows] = await pool.execute(sql, args);
    return rows[0];
  },
  async all(...args) {
    const [rows] = await pool.execute(sql, args);
    return rows;
  },
});

const db = {
  prepare: stmt,
  get pool() { return pool; },
};

export default db;
