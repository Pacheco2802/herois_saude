const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./database');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Pessoas ──────────────────────────────────────────────────────────────────

app.get('/api/pessoas', (req, res) => {
  const { categoria, status, na_lista_original, busca, premiado } = req.query;
  let query = 'SELECT * FROM pessoas WHERE 1=1';
  const params = [];

  if (categoria && categoria !== 'todos') {
    query += ' AND categoria = ?';
    params.push(categoria);
  }
  if (premiado !== undefined && premiado !== '') {
    query += ' AND premiado = ?';
    params.push(parseInt(premiado));
  }
  if (status === 'novos') {
    query += ' AND na_lista_original = 0';
  } else if (status && status !== 'todos') {
    query += ' AND status = ?';
    params.push(status);
  }
  if (na_lista_original !== undefined && na_lista_original !== '') {
    query += ' AND na_lista_original = ?';
    params.push(parseInt(na_lista_original));
  }
  if (busca) {
    query += ' AND (nome LIKE ? OR cargo LIKE ? OR observacoes LIKE ? OR local_trabalho LIKE ?)';
    params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`);
  }

  query += ' ORDER BY nome COLLATE NOCASE ASC';

  try {
    const pessoas = db.prepare(query).all(...params);
    res.json(pessoas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pessoas/:id', (req, res) => {
  const pessoa = db.prepare('SELECT * FROM pessoas WHERE id = ?').get(req.params.id);
  if (!pessoa) return res.status(404).json({ error: 'Não encontrado' });
  res.json(pessoa);
});

app.post('/api/pessoas', (req, res) => {
  const { nome, cargo, categoria, na_lista_original, observacoes, status, premiado, local_trabalho } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });

  const stmt = db.prepare(`
    INSERT INTO pessoas (nome, cargo, categoria, na_lista_original, observacoes, status, premiado, local_trabalho)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    nome.trim(),
    (cargo || '').trim(),
    categoria || 'convidado',
    na_lista_original ? 1 : 0,
    (observacoes || '').trim(),
    status || 'presente',
    premiado ? 1 : 0,
    (local_trabalho || '').trim()
  );

  const pessoa = db.prepare('SELECT * FROM pessoas WHERE id = ?').get(result.lastInsertRowid);
  io.emit('pessoa_adicionada', pessoa);
  res.status(201).json(pessoa);
});

app.put('/api/pessoas/:id', (req, res) => {
  const { id } = req.params;
  const { nome, cargo, categoria, na_lista_original, observacoes, status, premiado, local_trabalho } = req.body;

  const existente = db.prepare('SELECT * FROM pessoas WHERE id = ?').get(id);
  if (!existente) return res.status(404).json({ error: 'Não encontrado' });

  db.prepare(`
    UPDATE pessoas SET
      nome = ?, cargo = ?, categoria = ?, na_lista_original = ?,
      observacoes = ?, status = ?, premiado = ?, local_trabalho = ?,
      atualizado_em = datetime('now', 'localtime')
    WHERE id = ?
  `).run(
    (nome || existente.nome).trim(),
    (cargo !== undefined ? cargo : existente.cargo).trim(),
    categoria || existente.categoria,
    na_lista_original !== undefined ? (na_lista_original ? 1 : 0) : existente.na_lista_original,
    observacoes !== undefined ? observacoes.trim() : existente.observacoes,
    status || existente.status,
    premiado !== undefined ? (premiado ? 1 : 0) : existente.premiado,
    local_trabalho !== undefined ? local_trabalho.trim() : (existente.local_trabalho || ''),
    id
  );

  const atualizada = db.prepare('SELECT * FROM pessoas WHERE id = ?').get(id);
  io.emit('pessoa_atualizada', atualizada);
  res.json(atualizada);
});

app.patch('/api/pessoas/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['presente', 'ausente', 'pendente'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }

  const existente = db.prepare('SELECT * FROM pessoas WHERE id = ?').get(id);
  if (!existente) return res.status(404).json({ error: 'Não encontrado' });

  db.prepare(`UPDATE pessoas SET status = ?, atualizado_em = datetime('now', 'localtime') WHERE id = ?`)
    .run(status, id);

  const atualizada = db.prepare('SELECT * FROM pessoas WHERE id = ?').get(id);
  io.emit('pessoa_atualizada', atualizada);
  res.json(atualizada);
});

app.delete('/api/pessoas/:id', (req, res) => {
  const existente = db.prepare('SELECT * FROM pessoas WHERE id = ?').get(req.params.id);
  if (!existente) return res.status(404).json({ error: 'Não encontrado' });

  db.prepare('DELETE FROM pessoas WHERE id = ?').run(req.params.id);
  io.emit('pessoa_removida', { id: parseInt(req.params.id) });
  res.json({ success: true });
});

// Importação em lote
app.post('/api/importar', (req, res) => {
  const { pessoas } = req.body;
  if (!Array.isArray(pessoas) || pessoas.length === 0) {
    return res.status(400).json({ error: 'Lista inválida' });
  }

  const stmt = db.prepare(`
    INSERT INTO pessoas (nome, cargo, categoria, na_lista_original, status, premiado, local_trabalho, observacoes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const inseridas = [];
  db.exec('BEGIN');
  try {
    for (const p of pessoas) {
      if (!p.nome || !p.nome.trim()) continue;
      const result = stmt.run(
        p.nome.trim(),
        (p.cargo || '').trim(),
        p.categoria || 'convidado',
        p.na_lista_original ? 1 : 0,
        p.status || 'pendente',
        p.premiado ? 1 : 0,
        (p.local_trabalho || '').trim(),
        (p.observacoes || '').trim()
      );
      inseridas.push(db.prepare('SELECT * FROM pessoas WHERE id = ?').get(result.lastInsertRowid));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  inseridas.forEach(p => io.emit('pessoa_adicionada', p));
  res.json({ inseridas: inseridas.length, pessoas: inseridas });
});

// ── Stats ────────────────────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  const q = (sql) => db.prepare(sql).get().count;
  res.json({
    total:        q("SELECT COUNT(*) as count FROM pessoas"),
    presentes:    q("SELECT COUNT(*) as count FROM pessoas WHERE status = 'presente'"),
    ausentes:     q("SELECT COUNT(*) as count FROM pessoas WHERE status = 'ausente'"),
    pendentes:    q("SELECT COUNT(*) as count FROM pessoas WHERE status = 'pendente'"),
    novos:        q("SELECT COUNT(*) as count FROM pessoas WHERE na_lista_original = 0"),
    diretores:    q("SELECT COUNT(*) as count FROM pessoas WHERE categoria = 'diretor'"),
    autoridades:  q("SELECT COUNT(*) as count FROM pessoas WHERE categoria = 'autoridade'"),
    premiados:    q("SELECT COUNT(*) as count FROM pessoas WHERE premiado = 1"),
  });
});

// ── Config ───────────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  const rows = db.prepare('SELECT chave, valor FROM config').all();
  const config = {};
  rows.forEach(r => config[r.chave] = r.valor);
  res.json(config);
});

app.put('/api/config', (req, res) => {
  const { nome_evento } = req.body;
  if (nome_evento) {
    db.prepare('INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)').run('nome_evento', nome_evento);
    io.emit('config_atualizada', { nome_evento });
  }
  res.json({ success: true });
});

// ── WebSocket ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  socket.on('ping_viewer', () => socket.emit('pong_viewer'));
});

// ── Seed automático ──────────────────────────────────────────────────────────

function rodarSeedSeVazio() {
  const total = db.prepare('SELECT COUNT(*) as n FROM pessoas').get().n;
  if (total > 0) {
    console.log(`ℹ️  Banco já possui ${total} pessoa(s) — seed ignorado.`);
    return;
  }
  console.log('📋 Banco vazio — carregando lista de participantes...');
  require('./seed');
}

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n✅ Servidor rodando em http://localhost:${PORT}\n`);
  console.log(`   Operador:    http://localhost:${PORT}`);
  console.log(`   Visualizador: http://localhost:${PORT}?modo=visualizador\n`);
  rodarSeedSeVazio();
});
