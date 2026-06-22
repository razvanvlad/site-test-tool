import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function initDb(dbPath = 'data/audit.db') {
  const projectRoot = path.resolve(__dirname, '..');
  const absoluteDbPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(projectRoot, dbPath);
  const dbDir = path.dirname(absoluteDbPath);
  
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(absoluteDbPath);
  
  const schemaPath = path.join(projectRoot, 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  
  db.exec(schema);

  // Dynamic migration for existing databases
  try {
    db.exec('ALTER TABLE audits ADD COLUMN ai_summary TEXT');
  } catch (e) {
    // Ignore error if column already exists
  }
  try {
    db.exec('ALTER TABLE audits ADD COLUMN ai_tasks TEXT');
  } catch (e) {
    // Ignore error if column already exists
  }
  try {
    db.exec('ALTER TABLE projects ADD COLUMN local_path TEXT');
  } catch (e) {
    // Ignore
  }
  try {
    db.exec('ALTER TABLE projects ADD COLUMN tech_stack TEXT');
  } catch (e) {
    // Ignore
  }
  
  return db;
}
