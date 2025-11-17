-- updates.sql — RV Park schema aligned to instructor ERD (from your mxfile)
-- Safe setup
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- =========================
-- LOOKUP TABLES (IDs)
-- =========================
CREATE TABLE IF NOT EXISTS roles (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  CONSTRAINT uq_roles_name UNIQUE (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS site_types (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(50) NOT NULL,
  base_rate DECIMAL(10,2) NOT NULL,
  CONSTRAINT uq_site_types_name UNIQUE (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS power_types (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(20) NOT NULL,
  CONSTRAINT uq_power_types_name UNIQUE (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reservation_statuses (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(20) NOT NULL,
  CONSTRAINT uq_res_status_name UNIQUE (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_methods (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(20) NOT NULL,
  CONSTRAINT uq_pay_methods_name UNIQUE (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_statuses (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(20) NOT NULL,
  CONSTRAINT uq_pay_statuses_name UNIQUE (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ticket_statuses (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(20) NOT NULL,
  CONSTRAINT uq_ticket_statuses_name UNIQUE (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- CORE TABLES
-- =========================
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(120) NOT NULL,
  password_hash VARCHAR(60)  NOT NULL,
  password_salt VARCHAR(32)  NOT NULL,
  first_name    VARCHAR(80)  NOT NULL,
  last_name     VARCHAR(80)  NOT NULL,
  phone         VARCHAR(20)  NULL,
  role_id       INT          NOT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL,
  updated_at    DATETIME     NOT NULL,
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sites (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  site_code     VARCHAR(20) NOT NULL,
  site_type_id  INT NOT NULL,
  max_length_ft INT NOT NULL,
  pull_through  TINYINT(1) NOT NULL,
  has_water     TINYINT(1) NOT NULL,
  has_sewer     TINYINT(1) NOT NULL,
  power         INT NOT NULL,  -- FK → power_types.id
  status        ENUM('AVAILABLE','OCCUPIED','OOS') NOT NULL,
  notes         TEXT NULL,
  CONSTRAINT uq_sites_site_code UNIQUE (site_code),
  KEY idx_sites_type (site_type_id),
  KEY idx_sites_power (power),
  CONSTRAINT fk_sites_site_type FOREIGN KEY (site_type_id) REFERENCES site_types(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_sites_power FOREIGN KEY (power) REFERENCES power_types(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vehicles (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  type         VARCHAR(40) NOT NULL,
  length_ft    INT NOT NULL,
  plate_number VARCHAR(20) NOT NULL,
  KEY idx_vehicles_user (user_id),
  CONSTRAINT fk_vehicles_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reservations (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  site_id      INT NOT NULL,
  vehicle_id   INT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  status       INT  NOT NULL,        -- FK → reservation_statuses.id
  total_amount DECIMAL(10,2) NOT NULL,
  created_at   DATETIME NOT NULL,
  updated_at   DATETIME NOT NULL,
  KEY idx_res_user (user_id),
  KEY idx_res_site (site_id),
  KEY idx_res_vehicle (vehicle_id),
  KEY idx_res_status (status),
  CONSTRAINT fk_res_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_res_site FOREIGN KEY (site_id) REFERENCES sites(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_res_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    ON UPDATE RESTRICT ON DELETE SET NULL,
  CONSTRAINT fk_res_status FOREIGN KEY (status) REFERENCES reservation_statuses(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payments (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  user_id        INT NOT NULL,
  amount         DECIMAL(10,2) NOT NULL,
  method         INT NOT NULL,   -- FK → payment_methods.id
  status         INT NOT NULL,   -- FK → payment_statuses.id
  paid_at        DATETIME NULL,
  KEY idx_pay_res (reservation_id),
  KEY idx_pay_user (user_id),
  KEY idx_pay_method (method),
  KEY idx_pay_status (status),
  CONSTRAINT fk_pay_res FOREIGN KEY (reservation_id) REFERENCES reservations(id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_pay_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_pay_method FOREIGN KEY (method) REFERENCES payment_methods(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_pay_status FOREIGN KEY (status) REFERENCES payment_statuses(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS maintenance_tickets (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  site_id           INT NOT NULL,
  opened_by_user_id INT NOT NULL,
  status            INT NOT NULL,      -- FK → ticket_statuses.id
  opened_at         DATETIME NOT NULL,
  closed_at         DATETIME NULL,
  description       TEXT NOT NULL,
  KEY idx_ticket_site (site_id),
  KEY idx_ticket_user (opened_by_user_id),
  KEY idx_ticket_status (status),
  CONSTRAINT fk_ticket_site FOREIGN KEY (site_id) REFERENCES sites(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_user FOREIGN KEY (opened_by_user_id) REFERENCES users(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_status FOREIGN KEY (status) REFERENCES ticket_statuses(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  actor_user_id INT NOT NULL,
  action        VARCHAR(50) NOT NULL,
  entity_type   VARCHAR(50) NOT NULL,
  entity_id     INT NOT NULL,
  before_json   JSON NULL,
  after_json    JSON NULL,
  created_at    DATETIME NOT NULL,
  KEY idx_audit_actor (actor_user_id),
  KEY idx_audit_entity (entity_type, entity_id),
  CONSTRAINT fk_audit_user FOREIGN KEY (actor_user_id) REFERENCES users(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;

-- =========================
-- SEED MINIMAL LOOKUP DATA
-- =========================
INSERT IGNORE INTO roles (id, name) VALUES
  (1,'ADMIN'),(2,'EMPLOYEE'),(3,'CUSTOMER');

INSERT IGNORE INTO power_types (id, name) VALUES
  (1,'20A'),(2,'30A'),(3,'50A');

INSERT IGNORE INTO reservation_statuses (id, name) VALUES
  (1,'PENDING'),(2,'CONFIRMED'),(3,'CHECKED_IN'),(4,'COMPLETED'),(5,'CANCELLED');

INSERT IGNORE INTO payment_methods (id, name) VALUES
  (1,'CASH'),(2,'CARD'),(3,'OTHER');

INSERT IGNORE INTO payment_statuses (id, name) VALUES
  (1,'PENDING'),(2,'PAID'),(3,'REFUNDED');

INSERT IGNORE INTO ticket_statuses (id, name) VALUES
  (1,'OPEN'),(2,'IN_PROGRESS'),(3,'RESOLVED');
