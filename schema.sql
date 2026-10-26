-- Melody Rent : ระบบเช่าเครื่องดนตรี
CREATE TABLE roles (
  role_id     SERIAL PRIMARY KEY,
  role_name   VARCHAR(50) UNIQUE NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  user_id       SERIAL PRIMARY KEY,
  username      VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(100) NOT NULL,
  role_id       INT NOT NULL REFERENCES roles(role_id),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  permission_id   SERIAL PRIMARY KEY,
  permission_name VARCHAR(80) UNIQUE NOT NULL,
  description     VARCHAR(255) NOT NULL DEFAULT ''
);

-- ACL : Role x Permission (หนึ่งแถว = หนึ่งสิทธิ์ของหนึ่ง Role)
CREATE TABLE role_permissions (
  role_id       INT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE instruments (
  instrument_id SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  category      VARCHAR(20) NOT NULL
                CHECK (category IN ('guitar','keyboard','drums','strings','wind','other')),
  description   VARCHAR(500) NOT NULL DEFAULT '',
  daily_price   NUMERIC(10,2) NOT NULL CHECK (daily_price > 0),
  stock         INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  version       INT NOT NULL DEFAULT 1,  -- optimistic lock: กันบันทึกทับข้อมูลที่เพิ่งถูกเปลี่ยน
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rentals (
  rental_id     SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(user_id),
  instrument_id INT NOT NULL REFERENCES instruments(instrument_id),
  start_date    DATE NOT NULL,
  days          INT NOT NULL CHECK (days BETWEEN 1 AND 30),
  total_price   NUMERIC(10,2) NOT NULL CHECK (total_price >= 0),
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','picked_up','returned','cancelled')),
  note          VARCHAR(255) NOT NULL DEFAULT '',
  reviewed_by   INT REFERENCES users(user_id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ไฟล์/รูปภาพ : เก็บตัวไฟล์นอก public, เก็บข้อมูลอ้างอิงที่นี่
CREATE TABLE files (
  file_id       SERIAL PRIMARY KEY,
  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(100) UNIQUE NOT NULL,
  mime_type     VARCHAR(50) NOT NULL,
  size_bytes    INT NOT NULL,
  uploaded_by   INT NOT NULL REFERENCES users(user_id),
  instrument_id INT REFERENCES instruments(instrument_id) ON DELETE CASCADE,
  rental_id     INT REFERENCES rentals(rental_id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((instrument_id IS NOT NULL)::int + (rental_id IS NOT NULL)::int = 1)
);

CREATE TABLE audit_logs (
  log_id      BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     INT REFERENCES users(user_id) ON DELETE SET NULL,
  username    VARCHAR(100),
  event       VARCHAR(50) NOT NULL,
  resource    VARCHAR(100),
  resource_id VARCHAR(50),
  result      VARCHAR(10) NOT NULL CHECK (result IN ('success','failure','denied')),
  detail      VARCHAR(500) NOT NULL DEFAULT '',
  ip          VARCHAR(64)
);
CREATE INDEX idx_logs_created ON audit_logs (created_at DESC);
CREATE INDEX idx_logs_username ON audit_logs (username);
CREATE INDEX idx_logs_event ON audit_logs (event);
CREATE INDEX idx_rentals_user ON rentals (user_id);
CREATE INDEX idx_files_rental ON files (rental_id);
CREATE INDEX idx_files_instrument ON files (instrument_id);

-- กันกดส่งคำขอซ้ำ: ผู้ใช้หนึ่งคนมีคำขอ pending ของเครื่องเดียวกันได้ครั้งละ 1 รายการ
CREATE UNIQUE INDEX uq_rental_pending ON rentals (user_id, instrument_id) WHERE status = 'pending';
