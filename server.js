const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());



// Configuração PostgreSQL para Render==============================================

const isRender = process.env.RENDER === 'true';

// Configurar pool de conexões PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isRender ? { rejectUnauthorized: false } : false
});

console.log(`Ambiente: ${isRender ? 'PRODUÇÃO (Render + PostgreSQL)' : 'DESENVOLVIMENTO/LOCAL'}`);

// Testar conexão e inicializar BD
async function initDatabase() {
    try {
        // Testar conexão
        await pool.query('SELECT NOW()');
        console.log('Conectado à base de dados PostgreSQL.');

        // Criar tabela se não existir
        await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,  
        nome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        tipo TEXT NOT NULL,
        dataRegisto TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  
        verificado BOOLEAN DEFAULT false, 
        codigoVerificacao TEXT,
        pin TEXT
      )
    `);

        console.log('Tabela users pronta (ou já existia).');

        // Verificar se há utilizadores
        const result = await pool.query('SELECT COUNT(*) FROM users');
        console.log(`Total de utilizadores na BD: ${result.rows[0].count}`);

    } catch (err) {
        console.error('Erro ao inicializar a base de dados:', err.message);
        console.error('Verifica a variável DATABASE_URL no Render');
    }
}

// Inicializar BD quando o servidor começa
initDatabase();


// Rotas de utilizador==============================================

// POST /usuarios -> Criar um novo utilizador
app.post('/usuarios', async (req, res) => {
    try {
        const { nome, email, tipo } = req.body;

        if (!nome || !email || !tipo) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        // Verificar se o utilizador já existe
        const existingUser = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Utilizador com este email já existe' });
        }

        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

        // Inserir novo utilizador
        const result = await pool.query(
            `INSERT INTO users (nome, email, tipo, verificado, codigoVerificacao) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id, dataRegisto`,
            [nome, email, tipo, false, verificationCode]
        );

        console.log(`Utilizador ${email} criado. Código: ${verificationCode}`);

        const userResponse = {
            id: result.rows[0].id,
            nome,
            email,
            tipo,
            dataRegisto: result.rows[0].dataregisto || new Date(),  
            verificado: false
        };

        res.status(201).json({
            user: userResponse,
            message: "Utilizador criado, aguardando verificação.",
            verificationCode: verificationCode
        });

    } catch (error) {
        console.error('Erro ao criar utilizador:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// Rota para verificar o código
app.post('/usuarios/verificar', async (req, res) => {
    try {
        const { email, codigoVerificacao } = req.body;

        if (!email || !codigoVerificacao) {
            return res.status(400).json({ message: 'Email e código são obrigatórios' });
        }

        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Utilizador não encontrado' });
        }

        const user = result.rows[0];

        if (user.codigoverificacao !== codigoVerificacao) {  // 🟢 lowercase
            return res.status(400).json({ message: 'Código de verificação inválido' });
        }

        await pool.query(
            'UPDATE users SET codigoVerificacao = NULL, verificado = true WHERE email = $1',
            [email]
        );

        console.log(`Utilizador ${email} verificado com sucesso.`);
        res.status(200).json({ message: 'Verificação bem-sucedida!' });

    } catch (error) {
        console.error('Erro na verificação:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

// Rota para criar o PIN
app.post('/usuarios/criar-pin', async (req, res) => {
    try {
        const { nome, pin } = req.body;

        if (!nome || !pin) {
            return res.status(400).json({ message: 'Nome e PIN são obrigatórios' });
        }
        if (String(pin).length !== 6) {
            return res.status(400).json({ message: 'O PIN deve ter 6 dígitos' });
        }

        const result = await pool.query(
            'SELECT * FROM users WHERE nome = $1',
            [nome]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Utilizador não encontrado' });
        }

        const user = result.rows[0];
        const salt = await bcrypt.genSalt(10);
        const hashedPin = await bcrypt.hash(String(pin), salt);

        await pool.query(
            'UPDATE users SET pin = $1 WHERE nome = $2',
            [hashedPin, nome]
        );

        console.log(`PIN criado para o utilizador ${user.email}.`);
        res.status(200).json({ message: 'PIN criado com sucesso!' });

    } catch (error) {
        console.error('Erro ao criar o PIN:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

// Rota de Login
app.post('/usuarios/login', async (req, res) => {
    try {
        const { email, pin } = req.body;

        if (!email || !pin) {
            return res.status(400).json({ message: 'Email e PIN são obrigatórios' });
        }

        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0 || !result.rows[0].pin) {
            return res.status(401).json({ message: 'Email ou PIN incorretos' });
        }

        const user = result.rows[0];
        const isPinCorrect = await bcrypt.compare(String(pin), user.pin);

        if (!isPinCorrect) {
            return res.status(401).json({ message: 'Email ou PIN incorretos' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email },
            'seu_segredo_super_secreto',
            { expiresIn: '24h' }
        );

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

    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

// GET /usuarios -> Obter todos os utilizadores
app.get('/usuarios', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, nome, email, tipo, dataRegisto, verificado FROM users'
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar utilizadores:', error);
        res.status(500).json({ error: 'Erro ao buscar utilizadores' });
    }
});

// GET /usuarios/:id -> Obter um utilizador específico
app.get('/usuarios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT id, nome, email, tipo, dataRegisto, verificado FROM users WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Utilizador não encontrado' });
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao buscar utilizador:', error);
        res.status(500).json({ error: 'Erro ao buscar utilizador' });
    }
});

// PUT /usuarios/:id -> Atualizar um utilizador
app.put('/usuarios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, email, tipo } = req.body;

        const result = await pool.query(
            'UPDATE users SET nome = $1, email = $2, tipo = $3 WHERE id = $4 RETURNING id',
            [nome, email, tipo, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Utilizador não encontrado' });
        }

        res.status(200).json({ message: 'Utilizador atualizado com sucesso' });
    } catch (error) {
        console.error('Erro ao atualizar utilizador:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// DELETE /usuarios/:id -> Eliminar um utilizador
app.delete('/usuarios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'DELETE FROM users WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Utilizador não encontrado' });
        }

        res.status(200).json({ message: 'Utilizador eliminado com sucesso' });
    } catch (error) {
        console.error('Erro ao eliminar utilizador:', error);
        res.status(500).json({ error: 'Erro ao eliminar utilizador' });
    }
});



// Rotas de diagnóstico==============================================

app.get('/diagnostico/bd', async (req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*) as total FROM users');
        const info = {
            ambiente: isRender ? 'Render + PostgreSQL' : 'Local',
            total_utilizadores: parseInt(result.rows[0].total),
            timestamp: new Date().toISOString(),
            status: 'conectado'
        };
        res.json(info);
    } catch (error) {
        res.json({
            ambiente: isRender ? 'Render' : 'Local',
            error: 'Não foi possível conectar à BD',
            timestamp: new Date().toISOString()
        });
    }
});

// Rota de teste
app.get('/api/test', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({
            message: 'API VetConnect a funcionar!',
            database: 'PostgreSQL conectada',
            hosting: isRender ? 'Render' : 'Local',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            message: 'API funciona mas BD não responde',
            error: error.message
        });
    }
});



// Rotas de health==============================================

app.get('/api/health', async (req, res) => {
    const uptime = process.uptime();
    const isWakingUp = uptime < 30;

    try {
        await pool.query('SELECT 1');
        res.json({
            status: 'healthy',
            database: 'connected',
            uptime: Math.round(uptime),
            performance: isWakingUp ? 'warming_up' : 'optimal',
            message: isWakingUp
                ? 'API está a aquecer (primeiro acesso após inatividade)'
                : 'API está em velocidade normal',
            timestamp: new Date().toISOString(),
            note_for_evaluation: 'Render Free Tier has cold starts. First request may take 20-50 seconds.'
        });
    } catch (error) {
        res.json({
            status: 'degraded',
            database: 'disconnected',
            uptime: Math.round(uptime),
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});



// Rota principal==============================================

app.get('/', async (req, res) => {
    try {
        const dbResult = await pool.query('SELECT COUNT(*) as total FROM users');

        res.json({
            message: 'API VetConnect está a funcionar!',
            status: 'OK',
            ambiente: isRender ? 'PRODUÇÃO (Render + PostgreSQL)' : 'DESENVOLVIMENTO',
            database: 'PostgreSQL',
            total_utilizadores: parseInt(dbResult.rows[0].total),
            endpoints: {
                auth: {
                    criar: 'POST /usuarios',
                    verificar: 'POST /usuarios/verificar',
                    criarPin: 'POST /usuarios/criar-pin',
                    login: 'POST /usuarios/login'
                },
                dados: {
                    usuarios: 'GET /usuarios',
                    usuario_id: 'GET /usuarios/:id',
                    atualizar: 'PUT /usuarios/:id',
                    eliminar: 'DELETE /usuarios/:id'
                },
                diagnostico: {
                    bd: 'GET /diagnostico/bd',
                    health: 'GET /api/health',
                    test: 'GET /api/test'
                }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.json({
            message: 'API funciona mas BD pode estar offline',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});



// Inicialização do servidor==============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor VetConnect a correr em http://localhost:${PORT}`);
    console.log(`Database: PostgreSQL ${isRender ? '(Render)' : '(Local)'}`);
    console.log('NOTA: Dados são agora PERSISTENTES entre deploys!');
    console.log(`Timestamp de arranque: ${new Date().toISOString()}`);
});

// Fechar conexão com a BD quando o servidor terminar
process.on('SIGINT', async () => {
    console.log('A fechar conexões com a base de dados...');
    await pool.end();
    console.log('Conexões fechadas.');
    process.exit(0);
});