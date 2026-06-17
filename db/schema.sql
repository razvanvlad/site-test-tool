CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS project_pages (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  url TEXT NOT NULL,
  title TEXT,
  layout_areas TEXT, -- JSON array
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  url TEXT NOT NULL,
  started_at TEXT, finished_at TEXT,
  lighthouse_perf REAL, lighthouse_a11y REAL, lighthouse_seo REAL,
  status TEXT  -- running | done | error
);

CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY,
  audit_id INTEGER REFERENCES audits(id),
  page_id INTEGER REFERENCES project_pages(id),
  category TEXT,     -- accessibility | performance | console | network | links | seo
  severity TEXT,     -- critical | serious | moderate | minor
  title TEXT,
  description TEXT,
  selector TEXT,
  source_url TEXT,
  source_tool TEXT,  -- lighthouse | axe | pa11y | linkinator | playwright
  evidence_path TEXT,
  html_snippet TEXT,
  ai_explanation TEXT,
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
