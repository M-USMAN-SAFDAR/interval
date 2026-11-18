PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('Customer','Provider','Administrator')),
 active INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
 bio TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS one_admin ON users(role) WHERE role='Administrator';
CREATE TABLE IF NOT EXISTS services (
 id INTEGER PRIMARY KEY, provider_id INTEGER NOT NULL REFERENCES users, name TEXT NOT NULL, category TEXT NOT NULL,
 description TEXT NOT NULL, minutes INTEGER NOT NULL CHECK(minutes BETWEEN 1 AND 1440),
 active INTEGER NOT NULL DEFAULT 1, approved INTEGER NOT NULL DEFAULT 1, removed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS slots (
 id INTEGER PRIMARY KEY, service_id INTEGER NOT NULL REFERENCES services, start INTEGER NOT NULL,
 finish INTEGER NOT NULL CHECK(finish>start), removed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS slot_service ON slots(service_id,start);
CREATE TABLE IF NOT EXISTS bookings (
 id INTEGER PRIMARY KEY, slot_id INTEGER NOT NULL REFERENCES slots, customer_id INTEGER NOT NULL REFERENCES users,
 provider_id INTEGER NOT NULL REFERENCES users, service_name TEXT NOT NULL, provider_name TEXT NOT NULL,
 start INTEGER NOT NULL, finish INTEGER NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('Pending','Confirmed','Rejected','Cancelled','Completed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_reservation ON bookings(slot_id) WHERE status IN ('Pending','Confirmed');
CREATE TABLE IF NOT EXISTS problems (
 id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings, reporter INTEGER NOT NULL REFERENCES users,
 message TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
 token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users, expiry INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expiry);
CREATE TABLE IF NOT EXISTS auth_limits (
 bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expiry INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_limit_expiry ON auth_limits(expiry);
