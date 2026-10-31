-- Addresses (IPv6: /64 networks) that signed in with the right password, and
-- when. They skip the login limit shared by all addresses.
CREATE TABLE trusted_addresses (
  address TEXT PRIMARY KEY,
  last_login INTEGER NOT NULL
);
