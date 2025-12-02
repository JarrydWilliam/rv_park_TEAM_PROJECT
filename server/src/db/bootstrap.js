// server/src/db/bootstrap.js
//
// On startup, this does:
//  1) Try to connect as app user (team/team123) to rvpark.
//     - If that works, ensure tables + seed data exist, then return.
//  2) If that fails, try to connect as root (no DB).
//     - If ECONNREFUSED  -> MySQL not running / not installed -> log clear message.
//     - If ER_ACCESS_DENIED_ERROR -> MySQL running but root creds wrong -> log clear message.
//     - If root works -> create rvpark DB + team/team123 user + grants,
//       then connect as app user and ensure tables + seed.

require('dotenv').config();
const mysql = require('mysql2/promise');

async function ensureSchemaAndSeed(conn) {
  // ---- Core tables ----

  // Site table (used by /search and /vacancy)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS Site (
      id INT AUTO_INCREMENT PRIMARY KEY,
      number VARCHAR(10) NOT NULL,
      type ENUM('BACK_IN','PULL_THRU') NOT NULL,
      lengthFt INT NOT NULL,
      description VARCHAR(255),
      active TINYINT(1) NOT NULL DEFAULT 1
    )
  `);

  // Reservation table (used by /reserve, /confirm, /cancel)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS Reservation (
      id INT AUTO_INCREMENT PRIMARY KEY,
      siteId INT NOT NULL,
      guestName VARCHAR(100) NOT NULL,
      guestEmail VARCHAR(255) NOT NULL,
      rigLengthFt INT NOT NULL,
      checkIn DATE NOT NULL,
      checkOut DATE NOT NULL,
      pcs TINYINT(1) NOT NULL DEFAULT 0,
      confirmationCode VARCHAR(16) NOT NULL,
      nightlyRate DECIMAL(10,2) NOT NULL DEFAULT 0,
      amountPaid DECIMAL(10,2) NOT NULL DEFAULT 0,
      status ENUM('CONFIRMED','CANCELLED') NOT NULL DEFAULT 'CONFIRMED',
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_reservation_site
        FOREIGN KEY (siteId) REFERENCES Site(id)
        ON DELETE CASCADE
    )
  `);

  // RatePlan table (used by activeRateFor in policy.js)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS RatePlan (
      id INT AUTO_INCREMENT PRIMARY KEY,
      siteType ENUM('BACK_IN','PULL_THRU') NOT NULL,
      nightlyRate DECIMAL(10,2) NOT NULL,
      startDate DATE NOT NULL,
      endDate DATE NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1
    )
  `);

  // SpecialEvent table (used by stayTouchesSpecialEvent in policy.js)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS SpecialEvent (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      startDate DATE NOT NULL,
      endDate DATE NOT NULL
    )
  `);

  console.log('✅ Tables ensured.');

  // ---- Seed data (only when empty) ----

  // Seed Site
  const [siteCountRows] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM Site'
  );
  if (siteCountRows[0].cnt === 0) {
    await conn.query(`
      INSERT INTO Site (number, type, lengthFt, description, active)
      VALUES
        ('A1','BACK_IN',30,'Back-in, 30ft pad',1),
        ('A2','BACK_IN',35,'Back-in, 35ft pad',1),
        ('B1','PULL_THRU',40,'Pull-through, 40ft pad',1),
        ('B2','PULL_THRU',45,'Pull-through, 45ft pad',1)
    `);
    console.log('✅ Seeded Site table.');
  }

  // Seed RatePlan
  const [rateCountRows] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM RatePlan'
  );
  if (rateCountRows[0].cnt === 0) {
    await conn.query(`
      INSERT INTO RatePlan (siteType, nightlyRate, startDate, endDate, active)
      VALUES
        ('BACK_IN',30.00,'2025-01-01','2025-12-31',1),
        ('PULL_THRU',40.00,'2025-01-01','2025-12-31',1)
    `);
    console.log('✅ Seeded RatePlan table.');
  }

  // Seed SpecialEvent
  const [eventCountRows] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM SpecialEvent'
  );
  if (eventCountRows[0].cnt === 0) {
    await conn.query(`
      INSERT INTO SpecialEvent (name, startDate, endDate)
      VALUES
        ('4th of July','2025-07-03','2025-07-05'),
        ('Labor Day Weekend','2025-08-29','2025-09-02')
    `);
    console.log('✅ Seeded SpecialEvent table.');
  }

  console.log('✅ Schema + seed complete.');
}

async function bootstrapDb() {
  const host = process.env.DB_HOST || '127.0.0.1';
  const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306;

  const dbName = process.env.DB_NAME || 'rvpark';
  const appUser = process.env.DB_USER || 'team';
  const appPass = process.env.DB_PASSWORD || 'team123';

  const rootUser = process.env.DB_ROOT_USER || 'root';
  const rootPass = process.env.DB_ROOT_PASSWORD || '';

  console.log('=== RV Park DB Bootstrap (OLD project) ===');
  console.log(
    `DB host: ${host}:${port}, DB name: ${dbName}, app user: ${appUser}`
  );

  // STEP 1: Try existing DB with app user (team/team123)
  let appConn;
  try {
    appConn = await mysql.createConnection({
      host,
      port,
      user: appUser,
      password: appPass,
      database: dbName,
      multipleStatements: true,
    });
    console.log(
      '✅ MySQL is reachable and RV Park DB already exists (app user).'
    );
    // Even if DB exists, make sure tables + seed exist:
    await ensureSchemaAndSeed(appConn);
    await appConn.end();
    console.log('✅ RV Park DB bootstrap complete (app user path).');
    return;
  } catch (err) {
    console.log(
      'ℹ  Could not connect as app user yet. Will check MySQL/root next.'
    );
    console.log(
      `   App-user error code: ${err.code || 'N/A'}, message: ${err.message}`
    );
  }

  // STEP 2: Try connecting as root (no DB specified) to check MySQL availability.
  let rootConn;
  try {
    rootConn = await mysql.createConnection({
      host,
      port,
      user: rootUser,
      password: rootPass,
      multipleStatements: true,
    });

    console.log(' MySQL server is running and root credentials worked.');
    console.log('   Creating/verifying RV Park DB and user...');

    // Create database if it doesn't exist
    await rootConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );

    // Create app user if it doesn't exist
    await rootConn.query(
      `CREATE USER IF NOT EXISTS '${appUser}'@'localhost' IDENTIFIED BY ?;`,
      [appPass]
    );

    // Grant privileges on this DB
    await rootConn.query(
      `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${appUser}'@'localhost';`
    );

    await rootConn.query('FLUSH PRIVILEGES;');

    console.log('✅ RV Park DB and app user are ready to use (root path).');
    await rootConn.end();

    // Now connect as app user and ensure tables + seed
    appConn = await mysql.createConnection({
      host,
      port,
      user: appUser,
      password: appPass,
      database: dbName,
      multipleStatements: true,
    });

    await ensureSchemaAndSeed(appConn);
    await appConn.end();
    console.log('✅ RV Park DB bootstrap complete (root path).');
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.error(' Could not connect to MySQL at:', `${host}:${port}`);
      console.error(
        '   This usually means MySQL is not installed or the MySQL service is not running.'
      );
      console.error('   Start MySQL and run this app again.');
    } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('❌ MySQL is running, but root credentials are incorrect.');
      console.error(
        '   Please update DB_ROOT_USER and DB_ROOT_PASSWORD in .env to match your local MySQL root account.'
      );
      console.error(
        '   Or manually create the rvpark database and team/team123 user if you prefer.'
      );
    } else {
      console.error(
        ' Unexpected error while checking/creating MySQL DB/user:',
        err
      );
    }
    throw err;
  }
}

module.exports = { bootstrapDb };
