CREATE TABLE postal_entries (
  id INTEGER PRIMARY KEY,
  local_code TEXT NOT NULL,
  old_postal_code TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  prefecture_kana TEXT NOT NULL,
  city_kana TEXT NOT NULL,
  town_kana TEXT NOT NULL,
  prefecture TEXT NOT NULL,
  city TEXT NOT NULL,
  town TEXT NOT NULL,
  address TEXT NOT NULL,
  city_town TEXT NOT NULL,
  kana_address TEXT NOT NULL,
  kana_city_town TEXT NOT NULL,
  has_multiple_postal_codes INTEGER NOT NULL CHECK (has_multiple_postal_codes IN (0, 1)),
  uses_koaza INTEGER NOT NULL CHECK (uses_koaza IN (0, 1)),
  has_chome INTEGER NOT NULL CHECK (has_chome IN (0, 1)),
  covers_multiple_towns INTEGER NOT NULL CHECK (covers_multiple_towns IN (0, 1)),
  change_status INTEGER NOT NULL,
  change_reason INTEGER NOT NULL
);

CREATE INDEX postal_entries_postal_code_idx ON postal_entries(postal_code);
CREATE INDEX postal_entries_prefecture_idx ON postal_entries(prefecture, postal_code);
CREATE INDEX postal_entries_address_idx ON postal_entries(address);
CREATE INDEX postal_entries_city_town_idx ON postal_entries(city_town);
CREATE INDEX postal_entries_town_idx ON postal_entries(town);
CREATE INDEX postal_entries_kana_address_idx ON postal_entries(kana_address);
CREATE INDEX postal_entries_kana_city_town_idx ON postal_entries(kana_city_town);

CREATE TABLE product_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_hash TEXT NOT NULL,
  event_name TEXT NOT NULL CHECK(event_name IN (
    'visited',
    'searched',
    'no_result',
    'postal_opened',
    'postal_copied',
    'address_copied',
    'saved',
    'returned'
  )),
  is_qa INTEGER NOT NULL DEFAULT 0 CHECK (is_qa IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE INDEX product_events_created_at_idx ON product_events(created_at);
CREATE INDEX product_events_session_idx ON product_events(session_hash, created_at);
