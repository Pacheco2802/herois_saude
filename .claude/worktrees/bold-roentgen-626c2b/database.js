// Node.js 22.5+ built-in SQLite (no native build needed)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'evento.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS pessoas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    cargo TEXT DEFAULT '',
    categoria TEXT DEFAULT 'convidado',
    na_lista_original INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pendente',
    premiado INTEGER DEFAULT 0,
    observacoes TEXT DEFAULT '',
    criado_em TEXT DEFAULT (datetime('now', 'localtime')),
    atualizado_em TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS config (
    chave TEXT PRIMARY KEY,
    valor TEXT
  );

  INSERT OR IGNORE INTO config (chave, valor) VALUES ('nome_evento', 'Confirmação de Presença');
`);

// Migration: adiciona coluna premiado em bancos já existentes
try { db.exec(`ALTER TABLE pessoas ADD COLUMN premiado INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE pessoas ADD COLUMN local_trabalho TEXT DEFAULT ''`); } catch {}

module.exports = db;
