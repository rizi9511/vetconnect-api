const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Inicialização do SQLite
const dbPath = path.join(__dirname, 'vetconnect.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erro ao conectar com a base de dados:', err.message);
    } else {
        console.log('✅ Conectado à base de dados SQLite.');
        initDatabase();
    }
});

// Inicializar tabelas
function initDatabase() {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            tipo TEXT NOT NULL,
            dataRegisto DATETIME DEFAULT CURRENT_TIMESTAMP,
            verificado BOOLEAN DEFAULT 0,
            codigoVerificacao TEXT,
            pin TEXT
        )
    `, (err) => {
        if (err) {
            console.error('Erro ao criar tabela users:', err);
        } else {
            console.log('✅ Tabela users pronta.');
        }
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS veterinarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            especialidade TEXT,
            email TEXT UNIQUE NOT NULL,
            dataRegisto DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Erro ao criar tabela veterinarios:', err);
        } else {
            console.log('✅ Tabela veterinarios pronta.');
        }
    });
}

// ----------------------------------------------------------------
// ROTAS DE UTILIZADOR
// ----------------------------------------------------------------

// POST /usuarios -> Criar um novo utilizador e gerar um código de verificação
app.post('/usuarios', async (req, res) => {
    try {
        const { nome, email, tipo } = req.body;

        if (!nome || !email || !tipo) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        // Verificar se o utilizador já existe
        db.get('SELECT * FROM users WHERE email = ?', [email], async (err, row) => {
            if (err) {
                console.error('Erro ao verificar utilizador:', err);
                return res.status(500).json({ error: 'Erro no servidor' });
            }

            if (row) {
                return res.status(400).json({ error: 'Utilizador com este email já existe' });
            }

            const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

            const newUser = {
                nome,
                email,
                tipo,
                verificado: false,
                codigoVerificacao: verificationCode
            };

            db.run(
                `INSERT INTO users (nome, email, tipo, verificado, codigoVerificacao) 
                 VALUES (?, ?, ?, ?, ?)`,
                [nome, email, tipo, 0, verificationCode],
                function (err) {
                    if (err) {
                        console.error('Erro ao inserir utilizador:', err);
                        return res.status(500).json({ error: 'Erro ao criar utilizador' });
                    }

                    console.log(`✅ Utilizador ${email} criado. Código: ${verificationCode}`);

                    const userResponse = {
                        id: this.lastID,
                        nome,
                        email,
                        tipo,
                        dataRegisto: new Date(),
                        verificado: false
                    };

                    res.status(201).json({
                        user: userResponse,
                        message: "Utilizador criado, aguardando verificação.",
                        verificationCode: verificationCode
                    });
                }
            );
        });

    } catch (error) {
        console.error('Erro ao criar utilizador:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// --- Rota para verificar o código ---
app.post('/usuarios/verificar', async (req, res) => {
    const { email, codigoVerificacao } = req.body;

    if (!email || !codigoVerificacao) {
        return res.status(400).json({ message: 'Email e código são obrigatórios' });
    }

    try {
        db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
            if (err) {
                console.error('Erro ao buscar utilizador:', err);
                return res.status(500).json({ message: 'Erro interno do servidor' });
            }

            if (!user) {
                return res.status(404).json({ message: 'Utilizador não encontrado' });
            }

            if (user.codigoVerificacao !== codigoVerificacao) {
                return res.status(400).json({ message: 'Código de verificação inválido' });
            }

            db.run(
                'UPDATE users SET codigoVerificacao = NULL, verificado = 1 WHERE email = ?',
                [email],
                function (err) {
                    if (err) {
                        console.error('Erro ao atualizar utilizador:', err);
                        return res.status(500).json({ message: 'Erro interno do servidor' });
                    }

                    console.log(`✅ Utilizador ${email} verificado com sucesso.`);
                    res.status(200).json({ message: 'Verificação bem-sucedida!' });
                }
            );
        });

    } catch (error) {
        console.error('Erro na verificação:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

// --- Rota para criar o PIN ---
app.post('/usuarios/criar-pin', async (req, res) => {
    const { nome, pin } = req.body;

    if (!nome || !pin) {
        return res.status(400).json({ message: 'Nome e PIN são obrigatórios' });
    }
    if (String(pin).length !== 6) {
        return res.status(400).json({ message: 'O PIN deve ter 6 dígitos' });
    }

    try {
        db.get('SELECT * FROM users WHERE nome = ?', [nome], async (err, user) => {
            if (err) {
                console.error('Erro ao buscar utilizador:', err);
                return res.status(500).json({ message: 'Erro interno do servidor' });
            }

            if (!user) {
                return res.status(404).json({ message: 'Utilizador não encontrado' });
            }

            const salt = await bcrypt.genSalt(10);
            const hashedPin = await bcrypt.hash(String(pin), salt);

            db.run(
                'UPDATE users SET pin = ? WHERE nome = ?',
                [hashedPin, nome],
                function (err) {
                    if (err) {
                        console.error('Erro ao atualizar PIN:', err);
                        return res.status(500).json({ message: 'Erro interno do servidor' });
                    }

                    console.log(`✅ PIN criado para o utilizador ${user.email}.`);
                    res.status(200).json({ message: 'PIN criado com sucesso! Pode agora fazer login.' });
                }
            );
        });

    } catch (error) {
        console.error('Erro ao criar o PIN:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

// --- Rota de Login ---
app.post('/usuarios/login', async (req, res) => {
    const { email, pin } = req.body;

    if (!email || !pin) {
        return res.status(400).json({ message: 'Email e PIN são obrigatórios' });
    }

    try {
        db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
            if (err) {
                console.error('Erro ao buscar utilizador:', err);
                return res.status(500).json({ message: 'Erro interno do servidor' });
            }

            if (!user || !user.pin) {
                return res.status(401).json({ message: 'Email ou PIN incorretos' });
            }

            const isPinCorrect = await bcrypt.compare(String(pin), user.pin);
            if (!isPinCorrect) {
                return res.status(401).json({ message: 'Email ou PIN incorretos' });
            }

            const token = jwt.sign({ id: user.id, email: user.email }, 'seu_segredo_super_secreto', { expiresIn: '24h' });

            const userResponse = {
                id: user.id,
                nome: user.nome,
                email: user.email,
                tipo: user.tipo
            };
            
            res.status(200).json({
                message: 'Login bem-sucedido!',
                token: token,
                user: userResponse
            });
        });

    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

// GET /usuarios -> Obter todos os utilizadores
app.get('/usuarios', (req, res) => {
    db.all('SELECT id, nome, email, tipo, dataRegisto, verificado FROM users', [], (err, rows) => {
        if (err) {
            console.error('Erro ao buscar utilizadores:', err);
            return res.status(500).json({ error: 'Erro ao buscar utilizadores' });
        }
        res.status(200).json(rows);
    });
});

// GET /usuarios/:id -> Obter um utilizador específico
app.get('/usuarios/:id', (req, res) => {
    const { id } = req.params;

    db.get('SELECT id, nome, email, tipo, dataRegisto, verificado FROM users WHERE id = ?', [id], (err, row) => {
        if (err) {
            console.error('Erro ao buscar utilizador:', err);
            return res.status(500).json({ error: 'Erro ao buscar utilizador' });
        }

        if (!row) {
            return res.status(404).json({ error: 'Utilizador não encontrado' });
        }

        res.status(200).json(row);
    });
});

// PUT /usuarios/:id -> Atualizar um utilizador
app.put('/usuarios/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, email, tipo } = req.body;

    try {
        db.run(
            'UPDATE users SET nome = ?, email = ?, tipo = ? WHERE id = ?',
            [nome, email, tipo, id],
            function (err) {
                if (err) {
                    console.error('Erro ao atualizar utilizador:', err);
                    return res.status(500).json({ error: 'Erro ao atualizar utilizador' });
                }

                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Utilizador não encontrado' });
                }

                res.status(200).json({ message: 'Utilizador atualizado com sucesso' });
            }
        );
    } catch (error) {
        console.error('Erro ao atualizar utilizador:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// DELETE /usuarios/:id -> Eliminar um utilizador
app.delete('/usuarios/:id', (req, res) => {
    const { id } = req.params;

    db.run('DELETE FROM users WHERE id = ?', [id], function (err) {
        if (err) {
            console.error('Erro ao eliminar utilizador:', err);
            return res.status(500).json({ error: 'Erro ao eliminar utilizador' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'Utilizador não encontrado' });
        }

        res.status(200).json({ message: 'Utilizador eliminado com sucesso' });
    });
});

// Rota para adicionar veterinários (exemplo)
app.post('/veterinarios', (req, res) => {
    const { nome, especialidade, email } = req.body;

    if (!nome || !email) {
        return res.status(400).json({ error: 'Nome e email são obrigatórios' });
    }

    db.run(
        'INSERT INTO veterinarios (nome, especialidade, email) VALUES (?, ?, ?)',
        [nome, especialidade, email],
        function (err) {
            if (err) {
                console.error('Erro ao inserir veterinário:', err);
                return res.status(500).json({ error: 'Erro ao criar veterinário' });
            }

            res.status(201).json({
                id: this.lastID,
                nome,
                especialidade,
                email,
                dataRegisto: new Date()
            });
        }
    );
});

// GET /veterinarios -> Obter todos os veterinários
app.get('/veterinarios', (req, res) => {
    db.all('SELECT * FROM veterinarios', [], (err, rows) => {
        if (err) {
            console.error('Erro ao buscar veterinários:', err);
            return res.status(500).json({ error: 'Erro ao buscar veterinários' });
        }
        res.status(200).json(rows);
    });
});

// Rota principal
app.get('/', (req, res) => {
    res.json({
        message: '🎉 API VetConnect está a funcionar!',
        status: 'OK',
        timestamp: new Date().toISOString(),
        database: 'SQLite',
        endpoints: {
            auth: {
                register: 'POST /api/auth/register',
                login: 'POST /api/auth/login'
            },
            public: {
                veterinarios: 'GET /api/veterinarios',
                servicos: 'GET /api/servicos'
            },
            test: 'GET /api/test'
        }
    });
});

// Rota de teste
app.get('/api/test', (req, res) => {
    res.json({
        message: '✅ API VetConnect a funcionar!',
        database: 'SQLite conectada',
        timestamp: new Date().toISOString()
    });
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor VetConnect a correr em http://localhost:${PORT}`);
});

// Fechar a base de dados quando o servidor terminar
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('✅ Conexão com a base de dados fechada.');
        process.exit(0);
    });
});