// Script de seed — pré-cadastra diretores, autoridades e convidados
// Todos entram com status 'pendente' (recepção confirma presença no dia)
//
// Uso:
//   node seed.js          → insere apenas quem ainda não está no banco
//   node seed.js --limpar → apaga tudo e reinicia (CUIDADO)

const db = require('./database');

const PESSOAS = [
  // Adicione aqui as pessoas do novo evento.
  // Exemplo:
  // { nome: 'Fulano de Tal', cargo: 'Médico', local_trabalho: 'Hospital X', categoria: 'convidado', premiado: true },
];

const limpar = process.argv.includes('--limpar');

if (limpar) {
  db.exec(`DELETE FROM pessoas`);
  console.log('⚠  Cadastros anteriores removidos.\n');
}

const inserir = db.prepare(`
  INSERT INTO pessoas (nome, cargo, local_trabalho, categoria, status, premiado, na_lista_original)
  VALUES (?, ?, ?, ?, 'pendente', ?, 1)
`);

const existe = db.prepare(`SELECT id FROM pessoas WHERE LOWER(TRIM(nome)) = LOWER(TRIM(?))`);

let inseridos = 0, ignorados = 0;

for (const p of PESSOAS) {
  const nome = (p.nome || '').trim();
  if (!nome) continue;
  if (!limpar && existe.get(nome)) {
    console.log('  → já existe:', nome);
    ignorados++;
    continue;
  }
  inserir.run(nome, p.cargo || '', p.local_trabalho || '', p.categoria || 'convidado', p.premiado ? 1 : 0);
  console.log('  ✔', p.categoria.padEnd(10), nome);
  inseridos++;
}

console.log('\nConcluído:', inseridos, 'inserido(s),', ignorados, 'ignorado(s).');
