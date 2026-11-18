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

ALTER TABLE students ADD COLUMN nfc_uid TEXT;
CREATE UNIQUE INDEX idx_students_nfc ON students(nfc_uid) WHERE nfc_uid IS NOT NULL;

CREATE TABLE student_photos (
  student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  photo      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

ALTER TABLE attendance ADD COLUMN check_in_method TEXT NOT NULL DEFAULT 'manual' CHECK (check_in_method IN ('nfc','manual'));

INSERT INTO users (username, name, role, password_hash, salt, iterations) VALUES ('admin', 'Administración', 'admin', 'd161843ef6d130c2f61caddb7033cb8962933f801ea703dd269789e91c0dd167', '086e889d6058a9ce4debcf79a898a825', 100000);
INSERT INTO users (username, name, role, password_hash, salt, iterations) VALUES ('staff', 'Carmen Rivera', 'staff', 'a40e9b9b4452181028d5e46ab7e3afe53efdceefa027b6f88afad8c9193b6303', 'a1b842b74f0f310eb2bfa6e810d3a551', 100000);
INSERT INTO users (username, name, role, password_hash, salt, iterations) VALUES ('staff2', 'Luis Ortiz', 'staff', '69670642dd1f3b2d7d8bf1d3ef3ae2609a463e889291c5f7a2df5e369df8b45a', '27f0004dda596ab3fbd36535cdeb884f', 100000);
