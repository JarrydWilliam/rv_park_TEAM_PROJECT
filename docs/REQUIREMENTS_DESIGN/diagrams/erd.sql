-- ROLES
CREATE TABLE IF NOT EXISTS rvpark.roles (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- USERS
CREATE TABLE IF NOT EXISTS rvpark.users (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  email          VARCHAR(120) NOT NULL UNIQUE,
  password_hash  VARCHAR(60)  NOT NULL,
  password_salt  VARCHAR(32)  NOT NULL,
  first_name     VARCHAR(80)  NOT NULL,
  last_name      VARCHAR(80)  NOT NULL,
  phone          VARCHAR(20)  NULL,
  role_id        INT          NOT NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_users_role (role_id),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES rvpark.roles(id)
) ENGINE=InnoDB;

-- SITE TYPES
CREATE TABLE IF NOT EXISTS rvpark.site_types (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(50) NOT NULL UNIQUE,
  base_rate  DECIMAL(10,2) NOT NULL DEFAULT 0.00
) ENGINE=InnoDB;

-- SITES
CREATE TABLE IF NOT EXISTS rvpark.sites (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  site_code      VARCHAR(10) NOT NULL UNIQUE,
  site_type_id   INT NOT NULL,
  status         ENUM('AVAILABLE','OCCUPIED','MAINTENANCE') NOT NULL DEFAULT 'AVAILABLE',
  max_length_ft  INT NULL,
  has_power      TINYINT(1) NOT NULL DEFAULT 1,
  has_water      TINYINT(1) NOT NULL DEFAULT 1,
  has_sewer      TINYINT(1) NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_sites_type (site_type_id),
  KEY idx_sites_status (status),
  CONSTRAINT fk_sites_type FOREIGN KEY (site_type_id) REFERENCES rvpark.site_types(id)
) ENGINE=InnoDB;

-- VEHICLES
CREATE TABLE IF NOT EXISTS rvpark.vehicles (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  make          VARCHAR(50) NULL,
  model         VARCHAR(50) NULL,
  plate         VARCHAR(20) NULL,
  length_ft     INT NULL,
  type          ENUM('MOTORHOME','TRAILER','FIFTH_WHEEL','VAN','OTHER') NOT NULL DEFAULT 'OTHER',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_veh_user (user_id),
  CONSTRAINT fk_vehicle_user FOREIGN KEY (user_id) REFERENCES rvpark.users(id)
) ENGINE=InnoDB;

-- RESERVATIONS
CREATE TABLE IF NOT EXISTS rvpark.reservations (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  site_id       INT NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  status        ENUM('PENDING','CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  vehicle_id    INT NULL,
  total_amount  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_res_user (user_id),
  KEY idx_res_site (site_id),
  KEY idx_res_dates (start_date, end_date),
  KEY idx_res_status (status),
  KEY fk_res_vehicle (vehicle_id),
  CONSTRAINT fk_res_user    FOREIGN KEY (user_id)    REFERENCES rvpark.users(id),
  CONSTRAINT fk_res_site    FOREIGN KEY (site_id)    REFERENCES rvpark.sites(id),
  CONSTRAINT fk_res_vehicle FOREIGN KEY (vehicle_id) REFERENCES rvpark.vehicles(id)
) ENGINE=InnoDB;

-- PAYMENTS
CREATE TABLE IF NOT EXISTS rvpark.payments (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id  INT NOT NULL,
  amount          DECIMAL(10,2) NOT NULL,
  method          ENUM('CASH','CARD','OTHER') NOT NULL DEFAULT 'CARD',
  status          ENUM('AUTHORIZED','CAPTURED','REFUNDED','FAILED') NOT NULL DEFAULT 'CAPTURED',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pay_res (reservation_id),
  CONSTRAINT fk_pay_res FOREIGN KEY (reservation_id) REFERENCES rvpark.reservations(id)
) ENGINE=InnoDB;

-- MAINTENANCE TICKETS
CREATE TABLE IF NOT EXISTS rvpark.maintenance_tickets (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  site_id            INT NOT NULL,
  created_by_user_id INT NOT NULL,
  priority           ENUM('LOW','MEDIUM','HIGH') NOT NULL DEFAULT 'LOW',
  state              ENUM('OPEN','IN_PROGRESS','CLOSED') NOT NULL DEFAULT 'OPEN',
  notes              TEXT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_mt_site (site_id),
  KEY idx_mt_user (created_by_user_id),
  CONSTRAINT fk_mt_site FOREIGN KEY (site_id) REFERENCES rvpark.sites(id),
  CONSTRAINT fk_mt_user FOREIGN KEY (created_by_user_id) REFERENCES rvpark.users(id)
) ENGINE=InnoDB;

-- AUDIT LOGS
CREATE TABLE IF NOT EXISTS rvpark.audit_logs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  actor_user_id INT NOT NULL,
  action        VARCHAR(60) NOT NULL,
  entity        VARCHAR(60) NOT NULL,
  entity_id     INT NULL,
  details       JSON NULL,
  occurred_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_actor (actor_user_id),
  KEY idx_audit_entity (entity, entity_id),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES rvpark.users(id)
) ENGINE=InnoDB;

-- ===== Seeds (idempotent) =====
INSERT IGNORE INTO rvpark.roles (id, name) VALUES
  (1,'admin'), (2,'staff'), (3,'guest');

INSERT IGNORE INTO rvpark.site_types (id, name, base_rate) VALUES
  (1,'Standard',35.00), (2,'Premium',55.00), (3,'ADA',35.00);

INSERT IGNORE INTO rvpark.sites (id, site_code, site_type_id, status, max_length_ft, has_power, has_water, has_sewer) VALUES
  (1,'A01',1,'AVAILABLE',40,1,1,0),
  (2,'A02',1,'AVAILABLE',40,1,1,0),
  (3,'B01',2,'AVAILABLE',45,1,1,1);
