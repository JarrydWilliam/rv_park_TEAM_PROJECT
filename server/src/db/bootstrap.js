// server/src/db/bootstrap.js
//
// On startup, this does:
//  1) Try to connect as app user (team/team123) to rvpark.
//     - If that works, DB already exists -> log success and return.
//  2) If that fails, try to connect as root (no DB).
//     - If ECONNREFUSED  -> MySQL not running / not installed -> log clear message.
//     - If ER_ACCESS_DENIED_ERROR -> MySQL running but root creds wrong -> log clear message.
//     - If root works -> create rvpark DB + team/team123 user + grants.

require("dotenv").config();
const mysql = require("mysql2/promise");

async function bootstrapDb() {
  const host = process.env.DB_HOST || "127.0.0.1";
  const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306;

  const dbName = process.env.DB_NAME || "rvpark";
  const appUser = process.env.DB_USER || "team";
  const appPass = process.env.DB_PASSWORD || "team123";

  const rootUser = process.env.DB_ROOT_USER || "root";
  const rootPass = process.env.DB_ROOT_PASSWORD || "";

  console.log("=== RV Park DB Bootstrap (OLD project) ===");
  console.log(`DB host: ${host}:${port}, DB name: ${dbName}, app user: ${appUser}`);

  // STEP 1: Try existing DB with app user (team/team123)
  try {
    const appConn = await mysql.createConnection({
      host,
      port,
      user: appUser,
      password: appPass,
      database: dbName
    });
    console.log("✅ MySQL is reachable and RV Park DB already exists.");
    console.log("   Connected as app user, skipping DB/user creation.");
    await appConn.end();
    return;
  } catch (err) {
    console.log("ℹ  Could not connect as app user yet. Will check MySQL/root next.");
    console.log(`   App-user error code: ${err.code || "N/A"}, message: ${err.message}`);
  }

  // STEP 2: Try connecting as root (no DB specified) to check MySQL availability.
  let rootConn;
  try {
    rootConn = await mysql.createConnection({
      host,
      port,
      user: rootUser,
      password: rootPass,
      multipleStatements: true
    });

    console.log(" MySQL server is running and root credentials worked.");
    console.log("   Creating/verifying RV Park DB and user...");

    // Create database if it doesn't exist
    await rootConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );

    // Create app user if it doesn\'t exist
    await rootConn.query(
      `CREATE USER IF NOT EXISTS '${appUser}'@'localhost' IDENTIFIED BY ?;`,
      [appPass]
    );
 // USERS TABLE – used for login/registration and roles
  await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      username        VARCHAR(50) NOT NULL UNIQUE,
      email           VARCHAR(100) NOT NULL,
      first_name      VARCHAR(50) NOT NULL,
      last_name       VARCHAR(50) NOT NULL,
      password_hash   CHAR(64) NOT NULL,
      role            ENUM('customer', 'employee', 'admin') NOT NULL DEFAULT 'customer',

      dod_affiliation VARCHAR(50) NOT NULL,
      branch          VARCHAR(50) NOT NULL,
      rank_grade      VARCHAR(20) NOT NULL,

      num_adults      INT NOT NULL DEFAULT 1,
      num_pets        INT NOT NULL DEFAULT 0,
      pet_breed_notes VARCHAR(255),

      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
    // Grant privileges on this DB
    await rootConn.query(
      `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${appUser}'@'localhost';`
    );

    await rootConn.query("FLUSH PRIVILEGES;");

    console.log("✅ RV Park DB and app user are ready to use.");
  } catch (err) {
    if (err.code === "ECONNREFUSED") {
      console.error(" Could not connect to MySQL at:", `${host}:${port}`);
      console.error("   This usually means MySQL is not installed or the MySQL service is not running.");
      console.error("   Start MySQL and run this app again.");
    } else if (err.code === "ER_ACCESS_DENIED_ERROR") {
      console.error("❌ MySQL is running, but root credentials are incorrect.");
      console.error("   Please update DB_ROOT_USER and DB_ROOT_PASSWORD in .env to match your local MySQL root account.");
      console.error("   Or manually create the rvpark database and team/team123 user if you prefer.");
    } else {
      console.error(" Unexpected error while checking/creating MySQL DB/user:", err);
    }
    throw err;
  } finally {
    if (rootConn) {
      if (rootConn.end) {
        await rootConn.end();
      }
    }
  }
}

module.exports = { bootstrapDb };