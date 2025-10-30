const path = require("path");

// Load envs (local .env optional; project root .env preferred)
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", "..", ".env") });         // root .env (DATABASE_URL)
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", "..", "server", ".env") });// optional server/.env

const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());

const DEFAULT_URL = "mysql://team:team123@127.0.0.1:3306/rvpark";
const PORT = Number(process.env.PORT || 3001);
const dbUrl = new URL(process.env.DATABASE_URL || DEFAULT_URL);

// Pull credentials/host/port/db from the connection string
const dbName = dbUrl.pathname.replace(/^\//, "");
const baseConn = {
  host: dbUrl.hostname || "127.0.0.1",
  port: dbUrl.port ? Number(dbUrl.port) : 3306,
  user: decodeURIComponent(dbUrl.username || "team"),
  password: decodeURIComponent(dbUrl.password || "team123"),
  // no database here (server-level pool for CREATE DATABASE)
  waitForConnections: true,
  connectionLimit: 5
};

// Ensure database + minimal schema
async function bootstrap() {
  // 1) connect to server (no database) and ensure DB exists
  const serverPool = mysql.createPool(baseConn);
  await serverPool.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  await serverPool.end();

  // 2) connect to the specific DB and ensure table exists
  const appPool = mysql.createPool({ ...baseConn, database: dbName });
  await appPool.query(`
    CREATE TABLE IF NOT EXISTS hello_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      message VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return appPool;
}

let pool;

// Routes
app.get("/", (_req, res) => res.send("Hello RV Park! (DB auto-initialized)"));

app.get("/health/db", async (_req, res) => {
  try {
    const conn = await pool.getConnection();
    await conn.query("SELECT 1");
    conn.release();
    res.json({ ok: true });
  } catch (err) {
    console.error("DB health error:", err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post("/hello", async (req, res) => {
  const message = req.body?.message ? String(req.body.message) : null;
  if (!message) return res.status(400).json({ error: "message is required" });
  try {
    const [result] = await pool.query("INSERT INTO hello_messages (message) VALUES (?)", [message]);
    res.status(201).json({ id: result.insertId, message });
  } catch (err) {
    console.error("Insert error:", err);
    res.status(500).json({ error: "failed to insert" });
  }
});

app.get("/hello", async (_req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, message, created_at FROM hello_messages ORDER BY id DESC LIMIT 5"
    );
    res.json(rows);
  } catch (err) {
    console.error("Select error:", err);
    res.status(500).json({ error: "failed to select" });
  }
});

// Start: bootstrap DB then listen
(async () => {
  try {
    pool = await bootstrap();
    app.listen(PORT, () => {
      console.log(`Hello World server listening on http://localhost:${PORT}`);
      console.log(`Using DB: ${dbName} at ${baseConn.host}:${baseConn.port}`);
    });
  } catch (err) {
    console.error("Startup failed:", err);
    process.exit(1);
  }
})();
