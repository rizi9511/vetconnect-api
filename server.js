const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());



// Configuração da BD para Render==============================================

// 1. Determinar ambiente
const isRender = process.env.RENDER === 'true';
// No Render, sempre caminho local (sistema efémero)
const DB_PATH = path.join(__dirname, 'vetconnect.db');

console.log(`Ambiente: ${isRender ? 'PRODUÇÃO (Render)' : 'DESENVOLVIMENTO/LOCAL'}`);
console.log(`BD caminho: ${DB_PATH}`);

// 2. INICIALIZAÇÃO AUTOMÁTICA DA BD
function garantirBDExiste() {
    if (!fs.existsSync(DB_PATH)) {
        console.log('🆕 Criando nova BD...');
        // Cria ficheiro vazio
        fs.writeFileSync(DB_PATH, '');
        console.log('✅ Ficheiro BD criado');
        return true; // BD foi criada agora
    }
    return false; // BD já existia
}

// 3. CONECTA À BD
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Erro ao conectar com a base de dados:', err.message);
    } else {
        console.log('Conectado à base de dados SQLite.');

        // Verifica se a BD é nova (acabou de ser criada)
        const bdNova = garantirBDExiste();

        // Inicializa as tabelas (sempre, mas especialmente se for nova)
        initDatabase(bdNova);
    }
});

// ==============================================
// INICIALIZAÇÃO DAS TABELAS
// ==============================================

function initDatabase(bdNova = false) {
    console.log(`Inicializando tabelas... ${bdNova ? '(BD nova)' : '(BD existente)'}`);

    // Tabela users
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
            console.log('Tabela users pronta.');

        }
    });


}



// Rotas de utilizador==============================================

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

                    console.log(`Utilizador ${email} criado. Código: ${verificationCode}`);

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

                    console.log(`PIN criado para o utilizador ${user.email}.`);
                    res.status(200).json({ message: 'PIN criado com sucesso!' });
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



// Rotas de diagnóstico==============================================

app.get('/diagnostico/bd', (req, res) => {
    const info = {
        ambiente: isRender ? 'Render' : 'Local',
        bdCaminho: DB_PATH,
        bdExiste: fs.existsSync(DB_PATH),
        timestamp: new Date().toISOString()
    };
    res.json(info);
});

// Rota de teste
app.get('/api/test', (req, res) => {
    res.json({
        message: '✅ API VetConnect a funcionar!',
        database: 'SQLite conectada',
        hosting: isRender ? 'Render' : 'Local',
        timestamp: new Date().toISOString()
    });
});



// Rotas de backup/restore==============================================

// Rota SECRETA para fazer backup da BD (apenas em produção)
app.get('/admin/backup', (req, res) => {
    // Segurança básica - apenas em produção
    if (!isRender) {
        return res.status(403).json({
            error: 'Backup apenas disponível em produção',
            ambiente: 'development'
        });
    }

    try {
        // Verifica se a BD existe
        if (!fs.existsSync(DB_PATH)) {
            return res.status(404).json({
                error: 'Base de dados não encontrada',
                caminho: DB_PATH
            });
        }

        // Lê a BD como buffer
        const dbBuffer = fs.readFileSync(DB_PATH);
        const dbBase64 = dbBuffer.toString('base64');
        const dbSize = dbBuffer.length;

        // Informações sobre a BD
        db.get("SELECT COUNT(*) as total FROM users", (err, row) => {
            const userCount = row ? row.total : 0;

            res.json({
                status: 'success',
                message: 'Backup da base de dados criado com sucesso',
                database_size: dbSize,
                database_base64: dbBase64,
                statistics: {
                    total_users: userCount,
                    backup_timestamp: new Date().toISOString(),
                    environment: 'production'
                },
                instructions: 'Guarde o campo "database_base64" para restaurar posteriormente'
            });
        });

    } catch (error) {
        console.error('Erro ao criar backup:', error);
        res.status(500).json({
            error: 'Erro ao criar backup',
            details: error.message
        });
    }
});

// Rota para restaurar BD (CUIDADO: sobrescreve BD atual!)
app.post('/admin/restore', (req, res) => {
    if (!isRender) {
        return res.status(403).json({
            error: 'Restore apenas em produção',
            ambiente: 'development'
        });
    }

    const { database_base64 } = req.body;

    if (!database_base64) {
        return res.status(400).json({
            error: 'Campo "database_base64" é obrigatório'
        });
    }

    try {
        // Converte base64 para buffer
        const dbBuffer = Buffer.from(database_base64, 'base64');

        // Faz backup da BD atual (se existir)
        if (fs.existsSync(DB_PATH)) {
            const backupPath = `${DB_PATH}.backup-${Date.now()}`;
            fs.copyFileSync(DB_PATH, backupPath);
            console.log(`Backup da BD atual criado: ${backupPath}`);
        }

        // Escreve a nova BD
        fs.writeFileSync(DB_PATH, dbBuffer);

        console.log('Base de dados restaurada com sucesso');
        console.log(`Tamanho: ${dbBuffer.length} bytes`);

        res.json({
            status: 'success',
            message: 'Base de dados restaurada com sucesso',
            restored_size: dbBuffer.length,
            timestamp: new Date().toISOString(),
            warning: 'A BD anterior foi substituída. Reinicie o serviço para carregar os novos dados.'
        });

    } catch (error) {
        console.error('Erro ao restaurar backup:', error);
        res.status(500).json({
            error: 'Erro ao restaurar backup',
            details: error.message
        });
    }
});



//Rotas de health==============================================
app.get('/api/health', (req, res) => {
    const uptime = process.uptime();
    const isWakingUp = uptime < 30;

    res.json({
        status: 'healthy',
        uptime: Math.round(uptime),
        performance: isWakingUp ? 'warming_up' : 'optimal',
        message: isWakingUp
            ? 'API está a aquecer (primeiro acesso após inatividade)'
            : 'API está em velocidade normal',
        timestamp: new Date().toISOString(),
        note_for_evaluation: 'Render Free Tier has cold starts. First request may take 20-50 seconds.'
    });
});


// Fechar a base de dados quando o servidor terminar
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Conexão com a base de dados fechada.');
        process.exit(0);
    });
});



// Rota principal==============================================

app.get('/', (req, res) => {
    res.json({
        message: 'API VetConnect está a funcionar!',
        status: 'OK',
        ambiente: isRender ? 'PRODUÇÃO (Render)' : 'DESENVOLVIMENTO',
        bd: DB_PATH,
        hosting: isRender ? 'Render (sistema efémero)' : 'Local',
        endpoints: {
            auth: {
                criar: 'POST /usuarios',
                verificar: 'POST /usuarios/verificar',
                criarPin: 'POST /usuarios/criar-pin',
                login: 'POST /usuarios/login'
            },
            dados: {
                usuarios: 'GET /usuarios',
            },
            diagnostico: {
                bd: 'GET /diagnostico/bd',
            },
            backup: {
                backup: 'GET /admin/backup (apenas produção)',
                restore: 'POST /admin/restore (apenas produção)'
            }
        },
        timestamp: new Date().toISOString()
    });
});



// Inicialização do servidor==============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor VetConnect a correr em http://localhost:${PORT}`);
    console.log(`BD: ${DB_PATH}`);
    console.log(`Hospedagem: ${isRender ? 'Render' : 'Local'}`);
    console.log('NOTA: Se estiver no Render Free Tier, o primeiro acesso após inatividade');
    console.log('pode demorar 20-50 segundos enquanto o servidor "acorda".');
    console.log(`Timestamp de arranque: ${new Date().toISOString()}`);
});

// Fechar a base de dados quando o servidor terminar
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Conexão com a base de dados fechada.');
        process.exit(0);
    });
});