PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','staff')),
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  iterations    INTEGER NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  rl_key     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_login_attempts_key ON login_attempts(rl_key, created_at);

CREATE TABLE programs (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE levels (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL
);

CREATE TABLE students (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  birth_date    TEXT,
  guardian_name TEXT,
  phone         TEXT,
  email         TEXT,
  notes         TEXT,
  nfc_uid       TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_students_name ON students(last_name, first_name);
CREATE UNIQUE INDEX idx_students_nfc ON students(nfc_uid) WHERE nfc_uid IS NOT NULL;

CREATE TABLE student_photos (
  student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  photo      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE guardians (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  relationship TEXT,
  phone        TEXT,
  email        TEXT
);
CREATE INDEX idx_guardians_student ON guardians(student_id);

CREATE TABLE courses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id  INTEGER NOT NULL REFERENCES programs(id),
  level_id    INTEGER NOT NULL REFERENCES levels(id),
  days        TEXT NOT NULL,
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  exam_fee_cents       INTEGER NOT NULL DEFAULT 0 CHECK (exam_fee_cents >= 0),
  enrollment_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (enrollment_fee_cents >= 0),
  instructor  TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE enrollments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  enrolled_on TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo','inactivo')),
  UNIQUE (student_id, course_id)
);
CREATE INDEX idx_enrollments_course ON enrollments(course_id, status);

CREATE TABLE class_sessions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  UNIQUE (course_id, date)
);
CREATE INDEX idx_sessions_date ON class_sessions(date);

CREATE TABLE attendance (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  check_in_method TEXT NOT NULL DEFAULT 'manual' CHECK (check_in_method IN ('nfc','manual')),
  recorded_by     INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (session_id, student_id)
);
CREATE INDEX idx_attendance_student ON attendance(student_id);

CREATE TABLE charges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('clase','examen','matricula','otro')),
  description   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  attendance_id INTEGER UNIQUE REFERENCES attendance(id) ON DELETE CASCADE,
  course_id     INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  local_date    TEXT NOT NULL,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_charges_student ON charges(student_id, created_at);

CREATE TABLE payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method       TEXT NOT NULL CHECK (method IN ('efectivo','ath_movil','tarjeta')),
  received_by  INTEGER NOT NULL REFERENCES users(id),
  local_date   TEXT NOT NULL,
  note         TEXT,
  client_ref   TEXT UNIQUE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_payments_date ON payments(local_date);
CREATE INDEX idx_payments_student ON payments(student_id, created_at);

CREATE TABLE payment_allocations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id   INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  charge_id    INTEGER NOT NULL REFERENCES charges(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0)
);
CREATE INDEX idx_alloc_payment ON payment_allocations(payment_id);
CREATE INDEX idx_alloc_charge ON payment_allocations(charge_id);

CREATE VIEW charge_status AS
  SELECT c.*, c.amount_cents - IFNULL((SELECT SUM(pa.amount_cents) FROM payment_allocations pa WHERE pa.charge_id = c.id), 0) AS due_cents
    FROM charges c;
CREATE VIEW payment_status AS
  SELECT p.*, p.amount_cents - IFNULL((SELECT SUM(pa.amount_cents) FROM payment_allocations pa WHERE pa.payment_id = p.id), 0) AS free_cents
    FROM payments p;

CREATE TABLE wristbands (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  attendance_id INTEGER NOT NULL UNIQUE REFERENCES attendance(id) ON DELETE CASCADE,
  delivered     INTEGER NOT NULL DEFAULT 0,
  code          TEXT NOT NULL,
  delivered_by  INTEGER REFERENCES users(id),
  delivered_at  TEXT
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username   TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  details    TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_created ON audit_log(created_at);

INSERT INTO programs (name) VALUES ('Modelaje'), ('Costura'), ('Cocina');
INSERT INTO levels (name, sort_order) VALUES ('Básico', 1), ('Intermedio', 2), ('Avanzado', 3);

INSERT INTO users (username, name, role, password_hash, salt, iterations) VALUES ('admin', 'Administración', 'admin', '8e350e07932302270e6aa503337db16c7c7b8501434656fd4efe3dc9a224625b', '0726e2cf9a758b866ec4fa6ca9099e91', 100000);
INSERT INTO users (username, name, role, password_hash, salt, iterations) VALUES ('staff', 'Carmen Rivera', 'staff', 'd8660d03e2ad54e89d5e839a644957dcc3ca50c46461ad13ed1d84fa1e1d7d03', '53fc5a4a26d70a2009072decfc7a4bc2', 100000);
INSERT INTO users (username, name, role, password_hash, salt, iterations) VALUES ('staff2', 'Luis Ortiz', 'staff', '9a06f82fb23cf038a5fa8e77a4ff061a4c1a906c1cef48dbeb401963b429a34d', '397fa34d0aadde0c7a833a58922193d7', 100000);
