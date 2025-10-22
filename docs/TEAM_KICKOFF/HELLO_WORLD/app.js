// docs/TEAM_KICKOFF/HELLO_WORLD/app.js
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());

/**
 * Auto-login defaults (works even if no .env is present)
 * You can override with DATABASE_URL in .env like:
 *   DATABASE_URL="mysql://RV:password@127.0.0.1:3306/rvpark"
 */
const DEFAULT_URL = "mysql://RV:password@127.0.0.1:3306/rvpark";
const PORT = Number(process.env.PORT || 3001);

const dbUrl = new URL(process.env.DATABASE_URL || DEFAULT_URL);
const dbName = decodeURIComponent(dbUrl.pathname.replace(/^\//, ""));
const baseConn = {
  host: dbUrl.hostname || "127.0.0.1",
  port: dbUrl.port ? Number(dbUrl.port) : 3306,
  user: decodeURIComponent(dbUrl.username || "RV"),
  password: decodeURIComponent(dbUrl.password || "password"),
  waitForConnections: true,
  connectionLimit: 5,
};

// Optional SSL 
if (dbUrl.searchParams.get("sslaccept") === "strict") {
  baseConn.ssl = { rejectUnauthorized: true };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForMySQL(retries = 10, delayMs = 750) {
  for (let i = 1; i <= retries; i++) {
    try {
      const testPool = mysql.createPool(baseConn);
      await testPool.query("SELECT 1");
      await testPool.end();
      return;
    } catch (err) {
      if (i === retries) throw err;
      console.log(`MySQL not ready (attempt ${i}/${retries})… retrying in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
}

async function bootstrap() {
  await waitForMySQL(); // handles slow-starting DB services

  // Create database if missing (works for local MySQL)
  const serverPool = mysql.createPool(baseConn);
  await serverPool.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  await serverPool.end();

  // App pool points at the specific database
  const appPool = mysql.createPool({ ...baseConn, database: dbName });

  // Create table if missing
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
app.get("/", (_req, res) =>
  res.send("Hello RV Park! (auto-login to MySQL as RV/password, DB/table auto-init)")
);

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

// Start server
(async () => {
  try {
    pool = await bootstrap();
    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
      console.log(`DB: ${dbName} @ ${baseConn.host}:${baseConn.port} as ${baseConn.user}`);
    });
  } catch (err) {
    console.error("Startup failed:", err);
    process.exit(1);
  }
})();
