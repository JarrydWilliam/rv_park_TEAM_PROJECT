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
      type ENUM('BACK_IN','PULL_THRU','TENT') NOT NULL,
      lengthFt INT NOT NULL,
      description VARCHAR(255),
      active TINYINT(1) NOT NULL DEFAULT 1,
      UNIQUE(number)
    )
  `);

  // Reservation table (used by /reserve, /confirm, /cancel)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS Reservation (
      id INT AUTO_INCREMENT PRIMARY KEY,
      siteId INT NOT NULL,
      guestId INT,
      guestName VARCHAR(100) NOT NULL,
      guestEmail VARCHAR(255) NOT NULL,
      rigLengthFt INT NOT NULL,
      checkIn DATE NOT NULL,
      checkOut DATE NOT NULL,
      pcs TINYINT(1) NOT NULL DEFAULT 0,
      confirmationCode VARCHAR(16) NOT NULL,
      nightlyRate DECIMAL(10,2) NOT NULL DEFAULT 0,
      amountPaid DECIMAL(10,2) NOT NULL DEFAULT 0,
      paymentMethod VARCHAR(32) DEFAULT NULL,
      paid TINYINT(1) NOT NULL DEFAULT 0,
      status ENUM('CONFIRMED','CANCELLED') NOT NULL DEFAULT 'CONFIRMED',
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_reservation_site
        FOREIGN KEY (siteId) REFERENCES Site(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_reservation_guest
        FOREIGN KEY (guestId) REFERENCES users(id)
        ON DELETE SET NULL
    )
  `);

  // RatePlan table (used by activeRateFor in policy.js)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS RatePlan (
      id INT AUTO_INCREMENT PRIMARY KEY,
      siteType ENUM('BACK_IN','PULL_THRU','TENT') NOT NULL,
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
      INSERT INTO Site (number, type, lengthFt, description, active) VALUES
        ('1','BACK_IN',55,'Extra deep back-in, 55ft',1),
        ('2','BACK_IN',42,'Back-in, 42ft',1),
        ('3','BACK_IN',43,'Back-in, 43ft',1),
        ('4','BACK_IN',42,'Back-in, 42ft',1),
        ('5','BACK_IN',43,'Back-in, 43ft',1),
        ('6','BACK_IN',42,'Back-in, 42ft',1),
        ('7','BACK_IN',43,'Back-in, 43ft',1),
        ('8','BACK_IN',42,'Back-in, 42ft',1),
        ('9','BACK_IN',43,'Back-in, 43ft',1),
        ('10','BACK_IN',42,'Back-in, 42ft',1),
        ('11','BACK_IN',43,'Back-in, 43ft',1),
        ('12','BACK_IN',42,'Back-in, 42ft',1),
        ('13','BACK_IN',43,'Back-in, 43ft',1),
        ('14','BACK_IN',42,'Back-in, 42ft',1),
        ('15','PULL_THRU',43,'Pull-thru, 43ft',1),
        ('16','PULL_THRU',45,'Pull-thru, 45ft',1),
        ('17','PULL_THRU',55,'Extra deep pull-thru, 55ft',1),
        ('18','PULL_THRU',45,'Pull-thru, 45ft',1),
        ('19','PULL_THRU',55,'Extra deep pull-thru, 55ft',1),
        ('20','PULL_THRU',45,'Pull-thru, 45ft',1),
        ('21','PULL_THRU',55,'Extra deep pull-thru, 55ft',1),
        ('22','PULL_THRU',45,'Pull-thru, 45ft',1),
        ('23','PULL_THRU',46,'Pull-thru, 46ft',1),
        ('24','PULL_THRU',45,'Pull-thru, 45ft',1),
        ('25','PULL_THRU',46,'Pull-thru, 46ft',1),
        ('26','PULL_THRU',45,'Pull-thru, 45ft',1),
        ('27','PULL_THRU',46,'Pull-thru, 46ft',1),
        ('28','PULL_THRU',45,'Pull-thru, 45ft',1),
        ('29','PULL_THRU',46,'Pull-thru, 46ft',1),
        ('30','PULL_THRU',45,'Pull-thru, 45ft',1),
        ('31','PULL_THRU',46,'Pull-thru, 46ft',1),
        ('32','PULL_THRU',65,'Pull-thru, 65ft',1),
        ('33','PULL_THRU',65,'Pull-thru, 65ft',1),
        ('34','PULL_THRU',65,'Pull-thru, 65ft',1),
        ('35','PULL_THRU',65,'Pull-thru, 65ft',1),
        ('36','PULL_THRU',65,'Pull-thru, 65ft',1),
        ('37','PULL_THRU',65,'Pull-thru, 65ft',1),
        ('38','PULL_THRU',65,'Pull-thru, 65ft',1),
        ('39','PULL_THRU',65,'Pull-thru, 65ft',1),
        ('40','PULL_THRU',65,'Pull-thru, 65ft',1),
        ('41','TENT',0,'Tent site',1)
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
        ('PULL_THRU',40.00,'2025-01-01','2025-12-31',1),
        ('TENT',17.00,'2025-01-01','2025-12-31',1)
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
      pet_disclaimer_accepted TINYINT(1) NOT NULL DEFAULT 0,

      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
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