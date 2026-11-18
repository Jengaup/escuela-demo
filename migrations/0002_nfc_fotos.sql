-- Chapitas NFC, fotos de estudiantes y forma de entrada (sin firma digital).

ALTER TABLE students ADD COLUMN nfc_uid TEXT;
CREATE UNIQUE INDEX idx_students_nfc ON students(nfc_uid) WHERE nfc_uid IS NOT NULL;

-- Fotos aparte para que las listas de estudiantes no carguen imágenes.
CREATE TABLE student_photos (
  student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  photo      TEXT NOT NULL,             -- data:image/jpeg;base64,...
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 'nfc' = pasó la chapita, 'manual' = el staff lo marcó en la lista.
ALTER TABLE attendance ADD COLUMN check_in_method TEXT NOT NULL DEFAULT 'manual' CHECK (check_in_method IN ('nfc','manual'));
