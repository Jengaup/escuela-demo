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
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_students_name ON students(last_name, first_name);

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
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  signature   TEXT,
  signed_by   TEXT CHECK (signed_by IN ('encargado','estudiante')),
  signed_at   TEXT,
  recorded_by INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (session_id, student_id)
);
CREATE INDEX idx_attendance_student ON attendance(student_id);

CREATE TABLE payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  attendance_id INTEGER NOT NULL UNIQUE REFERENCES attendance(id) ON DELETE CASCADE,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
  method        TEXT NOT NULL CHECK (method IN ('efectivo','ath_movil','tarjeta')),
  received_by   INTEGER NOT NULL REFERENCES users(id),
  local_date    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_payments_date ON payments(local_date);

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

INSERT INTO users (username, name, role, password_hash, salt, iterations) VALUES ('admin', 'Administración', 'admin', '0367cbe4c2c59a125b490366eecce4d3a9eb27f56ba83410801a00b7c183107a', '3252e85193d88cc3ca3a695261d2db9f', 100000);
INSERT INTO users (username, name, role, password_hash, salt, iterations) VALUES ('staff', 'Carmen Rivera', 'staff', '16b695dd9f97bc2e41464e1026b524943c4401229b4e0a95b57301275d9ccaba', '1ba22db81f04a80a1ad982b3e28a418d', 100000);
INSERT INTO users (username, name, role, password_hash, salt, iterations) VALUES ('staff2', 'Luis Ortiz', 'staff', 'e4a0649cff88e607b35b775744668e9b29df950952b451492a00155d70e3e738', 'd08f44b916f17b724df6c279130e6670', 100000);
