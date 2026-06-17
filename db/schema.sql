CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  started_at TEXT, finished_at TEXT,
  lighthouse_perf REAL, lighthouse_a11y REAL, lighthouse_seo REAL,
  status TEXT  -- running | done | error
);

CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY,
  audit_id INTEGER REFERENCES audits(id),
  category TEXT,     -- accessibility | performance | console | network | links | seo
  severity TEXT,     -- critical | serious | moderate | minor
  title TEXT,
  description TEXT,
  selector TEXT,
  source_url TEXT,
  source_tool TEXT,  -- lighthouse | axe | pa11y | linkinator | playwright
  evidence_path TEXT,
  status TEXT DEFAULT 'open',  -- open | fixed | wontfix
  is_false_positive INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS fix_tracker (
  id INTEGER PRIMARY KEY,
  finding_id INTEGER REFERENCES findings(id),
  before_screenshot TEXT,
  after_screenshot TEXT,
  diff_image TEXT,
  diff_pixels INTEGER,
  diff_percentage REAL,
  verified INTEGER DEFAULT 0,
  updated_at TEXT
);
