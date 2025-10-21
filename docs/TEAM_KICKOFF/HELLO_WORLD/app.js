const path = require("path");

// Load envs (local .env optional; project root .env preferred)
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", "..", ".env") });
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", "..", "server", ".env") });

const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());

const DEFAULT_URL = "mysql://team:team123@127.0.0.1:3306/rvpark";
const PORT = Number(process.env.PORT || 3001);
const dbUrl = new URL(process.env.DATABASE_URL || DEFAULT_URL);
const SKIP_CREATE_DB = String(process.env.SKIP_CREATE_DB || "false").toLowerCase() === "true";

// Parse connection details
const dbName = decodeURIComponent(dbUrl.pathname.replace(/^\//, ""));
const baseConn = {
  host: dbUrl.hostname || "127.0.0.1",
  port: dbUrl.port ? Number(dbUrl.port) : 3306,
  user: decodeURIComponent(dbUrl.username || "team"),
  password: decodeURIComponent(dbUrl.password || "team123"),
  waitForConnections: true,
  connectionLimit: 5
};

// PlanetScale & some hosts require SSL; accept if query param present
if (dbUrl.searchParams.get("sslaccept") === "strict") {
  baseConn.ssl = { rejectUnauthorized: true };
}

async function bootstrap() {
  // If allowed (local dev), try to create DB; in cloud we skip
  if (!SKIP_CREATE_DB) {
    const serverPool = mysql.createPool(baseConn);
    await serverPool.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    await serverPool.end();
  }

  // App pool connects to the specific DB
  const appPool = mysql.createPool({ ...baseConn, database: dbName });

  // Ensure table exists
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
app.get("/", (_req, res) => res.send("Hello RV Park! (DB auto-init for table; database creation skipped in PROD)"));

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

// Start
(async () => {
  try {
    pool = await bootstrap();
    app.listen(PORT, () => {
      console.log(`Server listening on http://0.0.0.0:${PORT}`);
      console.log(`DB: ${dbName} @ ${baseConn.host}:${baseConn.port} (skipCreateDB=${SKIP_CREATE_DB})`);
    });
  } catch (err) {
    console.error("Startup failed:", err);
    process.exit(1);
  }
})();
