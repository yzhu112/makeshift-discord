CREATE TABLE rooms (
  name       TEXT PRIMARY KEY,
  code       TEXT CHECK(code IS NULL OR (length(code) = 8)),
  created_at INTEGER NOT NULL
);

CREATE TABLE room_memberships (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_name TEXT    NOT NULL REFERENCES rooms(name) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, room_name)
);

CREATE INDEX idx_memberships_room ON room_memberships(room_name);
