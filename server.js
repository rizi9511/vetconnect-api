const express = require('express'); // framework web para Node.js
const cors = require('cors'); // middleware para permitir CORS
const bcrypt = require('bcryptjs'); // biblioteca para hashing de passwords/PINs
const jwt = require('jsonwebtoken'); // biblioteca para criação e verificação de JSON Web Tokens
const { Pool } = require('pg'); // cliente PostgreSQL para Node.js
require('dotenv').config(); // carrega variáveis de ambiente de um ficheiro .env
const app = express(); // cria aplicação Express
const multer = require('multer'); // middleware para upload de ficheiros
const path = require('path'); // módulo para manipulação de caminhos de ficheiros
const fs = require('fs'); // módulo para manipulação do sistema de ficheiros

// middleware
app.use(cors()); // permite requisições de diferentes origens (CORS)
app.use(express.json()); // converte JSON do corpo das requisições para objetos JavaScript



// configuração multer para uploads==============================================
// configura onde guardar as imagens
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // pasta onde as imagens serão guardadas
        const uploadPath = './uploads';

        // cria pasta se não existir
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true }); // cria pasta recursivamente
        }

        cb(null, uploadPath); // define o destino
    },
    filename: function (req, file, cb) {
        // nome único para evitar conflitos
        const uniqueName = Date.now() + '-' + Math.random().toString(36).substring(7) + path.extname(file.originalname); // ex: 1623434873-abc1234.jpg
        cb(null, uniqueName); // define o nome do ficheiro
    }
});

// configura o middleware de upload
const upload = multer({
    storage: storage, // onde guardar os ficheiros
    limits: { // limites de upload
        fileSize: 5 * 1024 * 1024, // limite de 5MB
    },
    fileFilter: function (req, file, cb) { // filtro para tipos de ficheiros
        // aceita apenas imagens
        const allowedTypes = /jpeg|jpg|png|gif/; // tipos permitidos
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase()); // verifica extensão
        const mimetype = allowedTypes.test(file.mimetype); // verifica mimetype - tipo real do ficheiro

        // se for imagem, aceita
        if (mimetype && extname) {
            cb(null, true);
        } else {
            cb(new Error('Apenas imagens são permitidas (JPEG, JPG, PNG, GIF)'));
        }
    }
});

// serve ficheiros estáticos 
app.use('/uploads', express.static('./uploads'));


// configuração PostgreSQL para Render==============================================

// verifica se está a correr no Render
const isRender = process.env.RENDER === 'true';

// cria pool de conexões com PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // URL da BD das variáveis de ambiente do Render
    ssl: isRender ? { rejectUnauthorized: false } : false // SSL só no Render
});



// inicialização da BD==============================================

// testa conexão e inicializa BD
async function initDatabase() {
    try {
        // testa conexão
        await pool.query('SELECT NOW()');
        console.log('Conectado à base de dados PostgreSQL');

        // cria tabelas se não existir
        await pool.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,  
                    nome TEXT NOT NULL,
                    email TEXT UNIQUE NOT NULL,
                    telemovel TEXT NOT NULL,
                    tipo TEXT NOT NULL,
                    dataRegisto TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  
                    verificado BOOLEAN DEFAULT false, 
                    codigoVerificacao TEXT,
                    pin TEXT
                )
            `);
        await pool.query(`
                CREATE TABLE IF NOT EXISTS clinicas (
                    id SERIAL PRIMARY KEY,
                    nome TEXT NOT NULL
                )
            `);
        await pool.query(`
                CREATE TABLE IF NOT EXISTS veterinarios (
                    id SERIAL PRIMARY KEY,
                    nome TEXT NOT NULL,
                    clinicaId INTEGER REFERENCES clinicas(id) ON DELETE CASCADE -- se a clinica for apagada os veterinários tambem são
                )
            `);
        await pool.query(`
                CREATE TABLE IF NOT EXISTS consultas (
                    id SERIAL PRIMARY KEY,
                    userId INTEGER REFERENCES users(id) ON DELETE CASCADE, -- se o user for apagado as consultas também são
                    animalId INTEGER, 
                    clinicaId INTEGER REFERENCES clinicas(id),
                    veterinarioId INTEGER REFERENCES veterinarios(id),
                    data DATE NOT NULL,
                    hora TIME NOT NULL,
                    motivo TEXT,
                    estado TEXT DEFAULT 'marcada',  -- marcada (default), realizada, cancelada
                    dataMarcacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
        await pool.query(`
                CREATE TABLE IF NOT EXISTS animais (
                    id SERIAL PRIMARY KEY,
                    tutorId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    nome TEXT NOT NULL,
                    especie TEXT,
                    raca TEXT,
                    dataNascimento DATE,
                    fotoUrl TEXT,
                    numeroChip TEXT,
                    codigoUnico TEXT UNIQUE,
                    dataRegisto TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
        await pool.query(`
                CREATE TABLE IF NOT EXISTS receitas (
                    id SERIAL PRIMARY KEY,
                    animalId INTEGER NOT NULL REFERENCES animais(id) ON DELETE CASCADE,
                    dataPrescricao DATE NOT NULL,
                    medicamento TEXT NOT NULL,
                    dosagem TEXT,
                    frequencia TEXT,
                    duracao TEXT,
                    veterinario TEXT,
                    observacoes TEXT,
                    dataRegisto TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
        await pool.query(`
                CREATE TABLE IF NOT EXISTS exames (
                    id SERIAL PRIMARY KEY,
                    animalId INTEGER NOT NULL REFERENCES animais(id) ON DELETE CASCADE,
                    tipo TEXT NOT NULL,
                    dataExame DATE NOT NULL,
                    resultado TEXT,
                    laboratorio TEXT,
                    veterinario TEXT,
                    ficheiroUrl TEXT,
                    observacoes TEXT,
                    dataRegisto TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
        await pool.query(`
                CREATE TABLE IF NOT EXISTS invalidated_tokens (
                    id SERIAL PRIMARY KEY,
                    token TEXT NOT NULL,
                    expires_at TIMESTAMP NOT NULL,
                    invalidated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
                )
            `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tipos_vacina (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL,
                descricao TEXT,
                especie TEXT,
                periodicidade TEXT
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vacinas (
                id SERIAL PRIMARY KEY,
                animalId INTEGER NOT NULL REFERENCES animais(id) ON DELETE CASCADE,
                tipo TEXT NOT NULL,
                tipo_vacina_id INTEGER REFERENCES tipos_vacina(id), -- REFERÊNCIA AO TIPO
                data_agendada TIMESTAMP NOT NULL, -- DATA E HORA AGENDADAS PELO UTILIZADOR
                dataAplicacao DATE, -- QUANDO FOI REALMENTE APLICADA (PODE SER NULO INICIALMENTE)
                dataProxima DATE, -- PRÓXIMA VACINAÇÃO (CALCULADA BASEADO NA PERIODICIDADE)
                veterinario TEXT,
                lote TEXT,
                observacoes TEXT,
                estado TEXT DEFAULT 'agendada', -- 'agendada', 'realizada', 'cancelada'
                notificado BOOLEAN DEFAULT false, -- PARA CONTROLAR NOTIFICAÇÕES
                dataRegisto TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // insere dados exemplo
        await seedDatabase();
        console.log('Todas as tabelas criadas/verificadas');

    } catch (err) {
        console.error('Erro ao inicializar a base de dados:', err.message);
    }
}

// função para inserir dados de exemplo
async function seedDatabase() {
    try {

        // verifica se já existem clínicas para não inserir dados duplicados
        const clinicasExistentes = await pool.query('SELECT COUNT(*) FROM clinicas'); // conta clínicas existentes
        if (parseInt(clinicasExistentes.rows[0].count) === 0) { // converte para inteiro e verifica se é 0
            console.log('Base de dados de consultas vazia. A inserir dados de exemplo...');

            // insere clínicas
            const clinicasResult = await pool.query(`
                    INSERT INTO clinicas (nome) VALUES 
                    ('Animal Clinic'), 
                    ('Bichomix - Hospital Veterinário'), 
                    ('Hospital Veterinário de Lisboa'),
                    ('Centro Veterinário de Tomar'),
                    ('VetLuz'),
                    ('Hospital Veterinário de Alfragide')
                    RETURNING id -- retorna os IDs das clínicas inseridas
                `);

            // insere veterinários
            await pool.query(`
                    INSERT INTO veterinarios (nome, clinicaId) VALUES
                    ('Dr. João Silva', 1),    
                    ('Dra. Ana Costa', 1),    
                    ('Dr. Rui Pedro', 2),     
                    ('Dra. Sofia Marques', 2),
                    ('Dr. Carlos Mendes', 3),
                    ('Dra. Beatriz Reis', 3),
                    ('Dr. Miguel Santos', 4),
                    ('Dra. Inês Oliveira', 4),
                    ('Dr. Tiago Fernandes', 5),
                    ('Dra. Catarina Rodrigues', 5),
                    ('Dr. Pedro Almeida', 6),
                    ('Dra. Mariana Sousa', 6)
                `);

            // verifica se já existem tipos de vacina
            const vacinasExistentes = await pool.query('SELECT COUNT(*) FROM tipos_vacina');
            if (parseInt(vacinasExistentes.rows[0].count) === 0) {
                console.log('Inserindo tipos de vacina de exemplo...');

                // insere tipos de vacina de exemplo
                await pool.query(`
                    INSERT INTO tipos_vacina (nome, descricao, especie, periodicidade) VALUES
                    ('Raiva', 'Vacina anual contra raiva', 'Cão/Gato', 'Anual'),
                    ('Polivalente (V8/V10)', 'Proteção múltipla para cães', 'Cão', 'Anual'),
                    ('Tripla Felina', 'Proteção contra doenças felinas', 'Gato', 'Anual'),
                    ('Leishmaniose', 'Prevenção contra leishmaniose', 'Cão', 'Anual'),
                    ('Tosse do Canil', 'Prevenção da traqueobronquite', 'Cão', 'Anual'),
                    ('Giardia', 'Contra parasita intestinal', 'Cão/Gato', 'Anual'),
                    ('Leptospirose', 'Contra bactéria Leptospira', 'Cão', 'Anual'),
                    ('PIF', 'Peritonite Infeciosa Felina', 'Gato', 'Anual')
                `);

            }
            console.log('Dados de exemplo inseridos');
        }
    } catch (err) {
        console.error('Erro ao inserir dados exemplo:', err);
    }
}



// middleware de autenticação==============================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token de autenticação necessário' });
    }

    // Verificar primeiro se está na blacklist
    pool.query('SELECT * FROM invalidated_tokens WHERE token = $1', [token])
        .then(result => {
            if (result.rows.length > 0) {
                return res.status(403).json({ error: 'Token revogado. Faça login novamente.' });
            }

            // Se não está na blacklist, verificar normalmente
            jwt.verify(token, process.env.JWT_SECRET || 'dev_secret', (err, user) => {
                if (err) {
                    return res.status(403).json({ error: 'Token inválido ou expirado' });
                }

                // Anexar token ao request para uso posterior
                req.token = token;
                req.user = user;
                next();
            });
        })
        .catch(err => {
            console.error('Erro ao verificar token na blacklist:', err);
            return res.status(500).json({ error: 'Erro interno do servidor' });
        });
}



// rotas de utilizador==============================================

// POST /usuarios -> cria um novo utilizador
app.post('/usuarios', async (req, res) => {
    try {
        const { nome, email, telemovel, tipo } = req.body;

        // Valida campos obrigatórios
        if (!nome || !email || !telemovel || !tipo) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        // valida o número de telemóvel 
        const telemovelRegex = /^\+?[0-9]{9,15}$/; // Exemplo: +351912345678 ou 912345678
        if (!telemovelRegex.test(telemovel)) {
            return res.status(400).json({
                error: 'Número de telemóvel inválido'
            });
        }

        // verificar se o email já existe
        const existingUser = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        // se existir, retornar erro
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Utilizador com este email já existe' });
        }

        // verificar se o número de telemóvel já existe
        const existingPhone = await pool.query(
            'SELECT * FROM users WHERE telemovel = $1',
            [telemovel]
        );

        // se existir, retorna erro
        if (existingPhone.rows.length > 0) {
            return res.status(400).json({
                error: 'Utilizador com este telemóvel já existe'
            });
        }

        // Gerar código de verificação de 6 dígitos random
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

        // Inserir novo utilizador
        const result = await pool.query(
            `INSERT INTO users (nome, email, telemovel, tipo, verificado, codigoVerificacao) 
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, dataRegisto`,
            [nome, email, telemovel, tipo, false, verificationCode] // false - não verificado inicialmente
        );

        // na consola mostra o código de verificação que funciona como um SMS simulado
        console.log(`Utilizador ${nome} criado. Código: ${verificationCode}`);

        // responde com os dados do utilizador
        const userResponse = {
            id: result.rows[0].id,
            nome,
            email,
            telemovel,
            tipo,
            dataRegisto: result.rows[0].dataregisto || new Date(),
            verificado: false
        };

        // retorna resposta
        res.status(201).json({
            user: userResponse,
            message: "Utilizador criado - a aguardar verificação",
            verificationCode: verificationCode
        });

    } catch (error) {
        console.error('Erro ao criar utilizador:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});


// rota para verificar o código
app.post('/usuarios/verificar', async (req, res) => {
    try {
        const { email, codigoVerificacao } = req.body;

        if (!email || !codigoVerificacao) {
            return res.status(400).json({ message: 'Email e código são obrigatórios' });
        }

        // procura utilziador pelo email
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        // se não encontrar, retorna erro
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Utilizador não encontrado' });
        }

        // identifica o user
        const user = result.rows[0];

        // compara o código inserido com o armazenado
        if (user.codigoverificacao !== codigoVerificacao) {
            return res.status(400).json({ message: 'Código de verificação inválido' });
        }

        // atualiza o utilizador para verificado e remove o código
        await pool.query(
            'UPDATE users SET codigoVerificacao = NULL, verificado = true WHERE email = $1',
            [email]
        );

        // resposta de sucesso
        console.log(`Utilizador ${user.nome} verificado com sucesso.`);
        res.status(200).json({ message: 'Verificação bem-sucedida' });

    } catch (error) {
        console.error('Erro na verificação:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});


// rota para criar o PIN
app.post('/usuarios/criar-pin', async (req, res) => {
    try {
        const { email, pin } = req.body;

        if (!email || !pin) {
            return res.status(400).json({ message: 'Email e PIN são obrigatórios' });
        }
        if (String(pin).length !== 6) {
            return res.status(400).json({ message: 'O PIN deve ter 6 dígitos' });
        }

        // procura utilizador pelo email
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        // se não encontrar, retorna erro
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Utilizador não encontrado' });
        }

        const user = result.rows[0];

        // Hash do PIN antes de armazenar
        const salt = await bcrypt.genSalt(10); // Gerar salt
        const hashedPin = await bcrypt.hash(String(pin), salt); // Hash do PIN

        // atualiza o PIN do utilizador na BD
        await pool.query(
            'UPDATE users SET pin = $1 WHERE email = $2',
            [hashedPin, email]
        );

        console.log(`PIN criado para o utilizador ${user.nome}.`);
        res.status(200).json({ message: 'PIN criado com sucesso' });

    } catch (error) {
        console.error('Erro ao criar o PIN:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

// rota de Login
app.post('/usuarios/login', async (req, res) => {
    try {
        const { email, pin } = req.body;

        if (!email || !pin) {
            return res.status(400).json({ message: 'Email e PIN são obrigatórios' });
        }

        // procura utilizador pelo email
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        // se não encontrar ou não tiver PIN, retorna erro
        if (result.rows.length === 0 || !result.rows[0].pin) {
            return res.status(401).json({ message: 'Email ou PIN incorretos' });
        }

        const user = result.rows[0];

        // Comparar o PIN inserido com o hash armazenado
        const isPinCorrect = await bcrypt.compare(String(pin), user.pin);

        if (!isPinCorrect) {
            return res.status(401).json({ message: 'PIN incorreto' });
        }

        // Gerar JWT para autenticação
        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET, // Chave secreta do JWT nas variáveis de ambiente
            { expiresIn: '3h' } // Loginválido por 3 horas
        );

        // Responder com o token e dados do utilizador
        const userResponse = {
            id: user.id,
            nome: user.nome,
            email: user.email,
            tipo: user.tipo
        };

        res.status(200).json({
            message: 'Login bem-sucedido',
            token: token,
            user: userResponse
        });

    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

// CRUD de utilizadores

// GET /usuarios -> obter todos os utilizadores
app.get('/usuarios', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, nome, email, tipo, dataRegisto, verificado FROM users' // Excluir campos sensíveis como PIN e código de verificação
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Erro ao procurar utilizadores:', error);
        res.status(500).json({ error: 'Erro ao procurar utilizadores' });
    }
});

// GET /usuarios/:id -> obter um utilizador específico
app.get('/usuarios/:id', async (req, res) => {
    try {
        const { id } = req.params; // Obter ID dos parâmetros da rota
        const result = await pool.query(
            'SELECT id, nome, email, tipo, dataRegisto, verificado FROM users WHERE id = $1', // Excluir campos sensíveis
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Utilizador não encontrado' });
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao procurar utilizador:', error);
        res.status(500).json({ error: 'Erro ao procurar utilizador' });
    }
});

// PUT /usuarios/:id -> atualizar um utilizador
app.put('/usuarios/:id', async (req, res) => {
    try {
        const { id } = req.params; // Obter ID dos parâmetros da rota
        const { nome, email, tipo } = req.body; // Obter dados do corpo da requisição

        if (!nome || !email || !tipo) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        // Verificar se o email já pertence a outro utilizador
        const emailCheck = await pool.query(
            'SELECT id FROM users WHERE email = $1 AND id != $2',
            [email, id]
        );

        if (emailCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Email já está em uso por outro utilizador' });
        }

        const result = await pool.query(
            'UPDATE users SET nome = $1, email = $2, tipo = $3 WHERE id = $4 RETURNING id', // Excluir campos sensíveis
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

// DELETE /usuarios/:id -> eliminar um utilizador
app.delete('/usuarios/:id', async (req, res) => {
    try {
        const { id } = req.params; // Obter ID dos parâmetros da rota
        const result = await pool.query(
            'DELETE FROM users WHERE id = $1 RETURNING id', // Excluir campos sensíveis
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

// POST /usuarios/recuperar-pin
app.post('/usuarios/recuperar-pin', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email é obrigatório' });
        }

        // Verificar se o utilizador existe
        const result = await pool.query(
            'SELECT id, nome FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            // Por segurança, não revelar que o email não existe
            return res.status(200).json({
                message: 'Se o email existir, receberá um código de recuperação'
            });
        }

        const user = result.rows[0];

        // gerar um código de recuperação de 6 dígitos
        const codigoRecuperacao = Math.floor(100000 + Math.random() * 900000).toString();

        // guarda o código na BD 
        await pool.query(
            'UPDATE users SET codigoVerificacao = $1 WHERE id = $2',
            [codigoRecuperacao, user.id]
        );

        // simula envio
        console.log(`Código de recuperação para ${user.nome} (${email}): ${codigoRecuperacao}`);
        res.status(200).json({
            message: 'Código de recuperação enviado',
            codigoRecuperacao: codigoRecuperacao // codigo na consola da API
        });

    } catch (error) {
        console.error('Erro na recuperação:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// POST /usuarios/redefinir-pin
app.post('/usuarios/redefinir-pin', async (req, res) => {
    try {
        const { email, codigoRecuperacao, novoPin } = req.body;

        if (!email || !codigoRecuperacao || !novoPin) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        if (String(novoPin).length !== 6) {
            return res.status(400).json({ error: 'O PIN deve ter 6 dígitos' });
        }

        // Verificar código de recuperação
        const result = await pool.query(
            'SELECT id, codigoVerificacao FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Utilizador não encontrado' });
        }

        const user = result.rows[0];

        if (user.codigoverificacao !== codigoRecuperacao) {
            return res.status(400).json({ error: 'Código de recuperação inválido' });
        }

        // Hash do novo PIN
        const salt = await bcrypt.genSalt(10);
        const hashedPin = await bcrypt.hash(String(novoPin), salt);

        // Atualizar PIN e limpar código de recuperação
        await pool.query(
            'UPDATE users SET pin = $1, codigoVerificacao = NULL WHERE id = $2',
            [hashedPin, user.id]
        );

        res.status(200).json({ message: 'PIN redefinido com sucesso' });

    } catch (error) {
        console.error('Erro ao redefinir PIN:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// POST /usuarios/alterar-pin -> altera o PIN do utilizador autenticado
app.post('/usuarios/alterar-pin', authenticateToken, async (req, res) => {
    try {
        const { pinAtual, novoPin } = req.body;
        const userId = req.user.id; // ID do utilizador autenticado (vem do token)

        // validação dos campos
        if (!pinAtual || !novoPin) {
            return res.status(400).json({
                error: 'PIN atual e novo PIN são obrigatórios'
            });
        }

        // verifica formato dos PINs (6 dígitos)
        if (String(pinAtual).length !== 6 || String(novoPin).length !== 6) {
            return res.status(400).json({
                error: 'Os PINs devem ter 6 dígitos'
            });
        }

        // Verificar se o novo PIN é diferente do atual
        if (pinAtual === novoPin) {
            return res.status(400).json({
                error: 'O novo PIN deve ser diferente do PIN atual'
            });
        }

        // procura utilizador e o seu PIN atual (hash)
        const result = await pool.query(
            'SELECT id, nome, pin FROM users WHERE id = $1',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Utilizador não encontrado' });
        }

        const user = result.rows[0];

        // Verificar se o utilizador já tem PIN definido
        if (!user.pin) {
            return res.status(400).json({
                error: 'Utilizador não tem PIN definido'
            });
        }

        // Comparar o PIN atual com o hash armazenado
        const isPinCorrect = await bcrypt.compare(String(pinAtual), user.pin);

        if (!isPinCorrect) {
            return res.status(401).json({
                error: 'PIN atual incorreto'
            });
        }

        // Hash do novo PIN
        const salt = await bcrypt.genSalt(10);
        const hashedNovoPin = await bcrypt.hash(String(novoPin), salt);

        // Atualizar PIN na base de dados
        await pool.query(
            'UPDATE users SET pin = $1 WHERE id = $2',
            [hashedNovoPin, userId]
        );

        // Log da alteração
        console.log(`PIN alterado para o utilizador ${user.nome} (ID: ${userId})`);

        // Resposta de sucesso
        res.status(200).json({
            success: true,
            message: 'PIN alterado com sucesso'
        });

    } catch (error) {
        console.error('Erro ao alterar PIN:', error);
        res.status(500).json({
            error: 'Erro no servidor',
            details: error.message
        });
    }
});

// POST /usuarios/logout -> invalida o token do utilizador
app.post('/usuarios/logout', authenticateToken, async (req, res) => {
    try {
        const token = req.token;
        const userId = req.user.id;

        // Obter data de expiração do token
        const decoded = jwt.decode(token);
        const expiresAt = new Date(decoded.exp * 1000); // converter timestamp UNIX

        // Adicionar token à blacklist
        await pool.query(
            `INSERT INTO invalidated_tokens (token, expires_at, user_id) 
                VALUES ($1, $2, $3)`,
            [token, expiresAt, userId]
        );

        console.log(`Token invalidado para utilizador ID: ${userId}`);

        res.status(200).json({
            success: true,
            message: 'Logout efetuado com sucesso'
        });

    } catch (error) {
        console.error('Erro no logout:', error);
        res.status(500).json({
            error: 'Erro no servidor',
            details: error.message
        });
    }
});



// rotas de animais==============================================

// POST /animais -> cria novo animal
app.post('/animais', authenticateToken, async (req, res) => {
    try {
        const { nome, especie, raca, dataNascimento, numeroChip } = req.body;
        const tutorId = req.user.id;

        if (!nome || !especie) {
            return res.status(400).json({ error: 'Nome e espécie são obrigatórios' });
        }

        // Gerar código único VT-XXXXXX
        const codigoUnico = 'VT-' + Math.floor(100000 + Math.random() * 900000);

        const result = await pool.query(
            `INSERT INTO animais 
                (tutorId, nome, especie, raca, dataNascimento, numeroChip, codigoUnico)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *`,
            [tutorId, nome, especie, raca, dataNascimento, numeroChip, codigoUnico]
        );

        res.status(201).json(result.rows[0]);

    } catch (error) {
        console.error('Erro ao criar animal:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// GET /usuarios/:userId/animais -> obtem animais de um tutor
app.get('/usuarios/:userId/animais', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;

        // Verificar se o usuário tem permissão
        if (parseInt(userId) !== req.user.id && req.user.tipo !== 'veterinario') {
            return res.status(403).json({ error: 'Não autorizado' });
        }

        const result = await pool.query(
            `SELECT * FROM animais 
                WHERE tutorId = $1 
                ORDER BY nome`,
            [userId]
        );

        res.status(200).json(result.rows);

    } catch (error) {
        console.error('Erro ao obter animais:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// GET /animais/:animalId -> obtem detalhes de um animal
app.get('/animais/:animalId', authenticateToken, async (req, res) => {
    try {
        const { animalId } = req.params;

        const result = await pool.query(
            `SELECT a.*, u.nome as tutorNome, u.email as tutorEmail
                FROM animais a
                JOIN users u ON a.tutorId = u.id
                WHERE a.id = $1`,
            [animalId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Animal não encontrado' });
        }

        // Verificar permissões
        const animal = result.rows[0];
        if (animal.tutorid !== req.user.id && req.user.tipo !== 'veterinario') {
            return res.status(403).json({ error: 'Não autorizado' });
        }

        res.status(200).json(animal);

    } catch (error) {
        console.error('Erro ao obter animal:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// POST /animais/:animalId/foto -> upload de foto do animal
app.post('/animais/:animalId/foto', authenticateToken, upload.single('foto'),  // 'foto' é o nome do campo que o Android vai enviar
    async (req, res) => {
        try {
            const { animalId } = req.params; // obtem o ID do animal dos parâmetros da rota

            // verifica se recebeu um ficheiro
            if (!req.file) {
                return res.status(400).json({
                    error: 'Nenhuma imagem enviada',
                    details: 'Por favor, envie uma imagem no campo "foto"'
                });
            }

            // verifica se o animal existe
            const animalCheck = await pool.query(
                'SELECT tutorId, nome FROM animais WHERE id = $1', // obtem tutorId para verificar permissões
                [animalId]
            );

            if (animalCheck.rows.length === 0) {
                // se animal não existe, apaga a imagem que foi enviada
                fs.unlinkSync(req.file.path);
                return res.status(404).json({
                    error: 'Animal não encontrado',
                    animalId: animalId
                });
            }

            // obtem dados do animal
            const animal = animalCheck.rows[0];

            // verifica permissões (tutor ou veterinário)
            if (animal.tutorid !== req.user.id && req.user.tipo !== 'veterinario') {
                // se não tem permissão, apaga a imagem
                fs.unlinkSync(req.file.path);
                return res.status(403).json({
                    error: 'Não autorizado',
                    details: 'Apenas o tutor pode atualizar esta foto'
                });
            }

            // obtem URL base (Render ou local)
            const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://${req.get('host')}`;
            const fotoUrl = `${baseUrl}/uploads/${req.file.filename}`;

            // atualiza a foto do animal na BD
            await pool.query(
                'UPDATE animais SET fotoUrl = $1 WHERE id = $2', // atualiza fotoUrl
                [fotoUrl, animalId]
            );

            // log da atualização
            console.log(`Foto atualizada para animal ${animal.nome} (ID: ${animalId}): ${fotoUrl}`);

            // responde com sucesso
            res.status(200).json({
                success: true,
                message: 'Foto atualizada com sucesso',
                fotoUrl: fotoUrl,
                filename: req.file.filename,
                animal: {
                    id: animalId,
                    nome: animal.nome
                }
            });

            // em caso de erro
        } catch (error) {
            console.error('Erro ao atualizar foto:', error);
            //tenta apagar o ficheiro
            if (req.file && req.file.path && fs.existsSync(req.file.path)) {
                try {
                    fs.unlinkSync(req.file.path); // apaga ficheiro
                    // se der erro ao apagar
                } catch (unlinkError) {
                    console.error('Erro ao apagar ficheiro:', unlinkError);
                }
            }

            res.status(500).json({
                error: 'Erro no servidor',
                details: error.message
            });
        }
    }
);



// rotas de documentos==============================================

// POST /documentos -> cria documento (receita, vacina ou exame)
app.post('/documentos', authenticateToken, async (req, res) => {
    try {
        const { tipo, animalId, dados } = req.body;

        if (!tipo || !animalId || !dados) {
            return res.status(400).json({ error: 'Tipo, animalId e dados são obrigatórios' });
        }

        let result;
        switch (tipo) {
            case 'receita':
                result = await pool.query(
                    `INSERT INTO receitas 
                        (animalId, dataPrescricao, medicamento, dosagem, frequencia, duracao, veterinario, observacoes)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        RETURNING *`,
                    [animalId, dados.dataPrescricao, dados.medicamento, dados.dosagem,
                        dados.frequencia, dados.duracao, dados.veterinario, dados.observacoes]
                );
                break;

            case 'vacina':
                result = await pool.query(
                    `INSERT INTO vacinas 
                        (animalId, tipo, dataAplicacao, dataProxima, veterinario, lote, observacoes)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        RETURNING *`,
                    [animalId, dados.tipo, dados.dataAplicacao, dados.dataProxima,
                        dados.veterinario, dados.lote, dados.observacoes]
                );
                break;

            case 'exame':
                result = await pool.query(
                    `INSERT INTO exames 
                        (animalId, tipo, dataExame, resultado, laboratorio, veterinario, ficheiroUrl, observacoes)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        RETURNING *`,
                    [animalId, dados.tipo, dados.dataExame, dados.resultado,
                        dados.laboratorio, dados.veterinario, dados.ficheiroUrl, dados.observacoes]
                );
                break;

            default:
                return res.status(400).json({ error: 'Tipo de documento inválido' });
        }

        res.status(201).json({
            message: 'Documento criado com sucesso',
            documento: result.rows[0],
            tipo: tipo
        });

    } catch (error) {
        console.error('Erro ao criar documento:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// GET /animais/:animalId/documentos -> obtem todos os documentos de um animal
app.get('/animais/:animalId/documentos', authenticateToken, async (req, res) => {
    try {
        const { animalId } = req.params;

        // verifica permissões
        const animalCheck = await pool.query(
            'SELECT tutorId FROM animais WHERE id = $1',
            [animalId]
        );

        // se animal não existe
        if (animalCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Animal não encontrado' });
        }

        // verifica se o user é o tutor ou veterinário
        if (animalCheck.rows[0].tutorid !== req.user.id && req.user.tipo !== 'veterinario') {
            return res.status(403).json({ error: 'Não autorizado' });
        }

        // procura todos os documentos
        const [receitas, vacinas, exames] = await Promise.all([
            pool.query('SELECT * FROM receitas WHERE animalId = $1 ORDER BY dataPrescricao DESC', [animalId]),
            pool.query('SELECT * FROM vacinas WHERE animalId = $1 ORDER BY dataAplicacao DESC', [animalId]),
            pool.query('SELECT * FROM exames WHERE animalId = $1 ORDER BY dataExame DESC', [animalId])
        ]);

        res.status(200).json({
            receitas: receitas.rows,
            vacinas: vacinas.rows,
            exames: exames.rows
        });

    } catch (error) {
        console.error('Erro ao obter documentos:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// DELETE /documentos/:tipo/:id -> apaga um documento específico
app.delete('/documentos/:tipo/:id', authenticateToken, async (req, res) => {
    try {
        const { tipo, id } = req.params; // obtem tipo e id dos parâmetros da rota
        const userId = req.user.id; // obtem o ID do utilizador autenticado

        // valida tipo
        let tableName;
        switch (tipo) {
            case 'receitas': tableName = 'receitas'; break;
            case 'vacinas': tableName = 'vacinas'; break;
            case 'exames': tableName = 'exames'; break;
            default:
                return res.status(400).json({
                    error: 'Tipo de documento inválido',
                    tipos_validos: ['receitas', 'vacinas', 'exames']
                });
        }

        // verifica se o documento existe e se o user tem permissão
        const docQuery = `
                SELECT a.tutorId, d.* 
                FROM ${tableName} d
                JOIN animais a ON d.animalId = a.id
                WHERE d.id = $1
            `;
        const docResult = await pool.query(docQuery, [parseInt(id)]); // consulta o documento

        // se não encontrar o documento
        if (docResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Documento não encontrado',
                documento_id: id,
                tipo: tipo
            });
        }

        // obtem o documento
        const documento = docResult.rows[0];

        // verifica permissões: tutor 
        if (documento.tutorid !== userId) {
            return res.status(403).json({
                error: 'Não autorizado a apagar este documento',
                detalhes: 'Apenas o tutor pode apagar documentos'
            });
        }

        // Apagar o documento
        const deleteResult = await pool.query(
            `DELETE FROM ${tableName} WHERE id = $1 RETURNING id`,
            [parseInt(id)]
        );

        // Log da operação
        console.log(`Documento apagado: ${tipo} ID ${id} por utilizador ${userId}`);

        res.status(200).json({
            success: true,
            message: 'Documento apagado com sucesso',
            documento: {
                id: deleteResult.rows[0].id,
                tipo: tipo
            }
        });

    } catch (error) {
        console.error('Erro ao apagar documento:', error);
        res.status(500).json({
            error: 'Erro no servidor',
            detalhes: error.message
        });
    }
});



// rotas de consultas==============================================

// POST /consultas -> marca nova consulta
app.post('/consultas', authenticateToken, async (req, res) => {
    try {
        const { animalId, clinicaId, veterinarioId, data, hora, motivo } = req.body; // obtem dados do corpo da requisição
        const userId = req.user.id; // obtem o ID do utilizador autenticado

        // verifica se já existe uma consulta marcada para o mesmo veterinário na mesma data e hora
        const consultaConflito = await pool.query(
            `SELECT * FROM consultas 
                    WHERE veterinarioId = $1 
                    AND data = $2 
                    AND hora = $3 
                    AND estado != 'cancelada'`, // não conta consultas canceladas
            [veterinarioId, data, hora]
        );

        // se existir conflito, retorna erro
        if (consultaConflito.rows.length > 0) {
            return res.status(409).json({
                error: 'Já existe uma consulta marcada para este veterinário no mesmo horário'
            });
        }

        // validação dos campos obrigatórios
        if (!animalId || !clinicaId || !veterinarioId || !data || !hora) {
            return res.status(400).json({
                error: 'Todos os campos são obrigatórios'
            });
        }

        const dataConsulta = new Date(data); // converte a data para objeto Date
        const hoje = new Date(); // data atual
        hoje.setHours(0, 0, 0, 0); // zera horas para comparar só a data
        // verifica se a data da consulta não é no passado
        if (dataConsulta < hoje) {
            return res.status(400).json({
                error: 'A data da consulta não pode ser no passado'
            });
        }

        // verifica se o veterinário pertence à clínica selecionada
        const verificaVeterinario = await pool.query(
            'SELECT * FROM veterinarios WHERE id = $1 AND clinicaId = $2',
            [veterinarioId, clinicaId]
        );
        if (verificaVeterinario.rows.length === 0) {
            return res.status(400).json({
                error: 'Este veterinário não pertence à clínica selecionada'
            });
        }

        // verifica se o animal pertence ao utilizador
        const animalCheck = await pool.query(
            'SELECT tutorId FROM animais WHERE id = $1',
            [animalId]
        );

        if (animalCheck.rows.length === 0 || animalCheck.rows[0].tutorid !== userId) {
            return res.status(403).json({ error: 'Animal não encontrado ou não autorizado' });
        }

        // insere a nova consulta na BD
        const result = await pool.query(
            `INSERT INTO consultas
                (userId, animalId, clinicaId, veterinarioId, data, hora, motivo)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *`,
            [userId, animalId, clinicaId, veterinarioId, data, hora, motivo]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao marcar consulta:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// GET /clinicas -> obtem todas as clínicas
app.get('/clinicas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM clinicas ORDER BY LOWER(nome)'); // ordena alfabeticamente as clínicas
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Erro ao obter clínicas:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// GET /veterinarios -> obtem todos os veterinários
app.get('/veterinarios', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM veterinarios ORDER BY LOWER(nome)'); // ordena alfabeticamente os veterinários
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Erro ao obter veterinários:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// GET /clinicas/:clinicaId/veterinarios -> obtem veterinários de uma clínica específica
app.get('/clinicas/:clinicaId/veterinarios', async (req, res) => {
    try {
        const { clinicaId } = req.params; // obtem o ID da clínica dos parâmetros da rota
        const result = await pool.query(
            'SELECT * FROM veterinarios WHERE clinicaId = $1 ORDER BY LOWER(nome)', // ordena alfabeticamente os veterinários
            [clinicaId] // parâmetro da consulta
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Erro ao obter veterinários da clínica:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});


// GET /consultas/:userId -> consultas de um utilizador
app.get('/consultas/user/:userId', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params; // obtem o ID do utilizador dos parâmetros da rota
        const result = await pool.query(`
                SELECT c.*, cli.nome as clinicaNome, vet.nome as veterinarioNome
                FROM consultas c
                JOIN clinicas cli ON c.clinicaId = cli.id -- junta com clínicas para obter o nome
                JOIN veterinarios vet ON c.veterinarioId = vet.id -- junta com veterinários para obter o nome
                WHERE c.userId = $1 
                ORDER BY c.data, c.hora
            `, [userId]);

        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Erro ao obter consultas:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// DELETE /consultas/:id -> cancela uma consulta
app.delete('/consultas/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params; // obtem o ID da consulta dos parâmetros da rota
        const result = await pool.query(
            'DELETE FROM consultas WHERE id = $1 RETURNING id', // retorna o ID da consulta eliminada
            [id]
        );

        // se não encontrar a consulta, retorna erro
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Consulta não encontrada' });
        }

        res.status(200).json({
            message: 'Consulta cancelada com sucesso',
            consultaId: result.rows[0].id
        });
    } catch (error) {
        console.error('Erro ao cancelar consulta:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// rotas de vacinas==============================================
// GET /vacinas/proximas -> obtem vacinas nos próximos 7 dias
app.get('/vacinas/proximas', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // vacinas que precisam ser aplicadas (próximas 7 dias)
        const result = await pool.query(`
            SELECT v.*, a.nome as animal_nome, a.especie, tv.descricao,
                CASE 
                    WHEN v.data_agendada IS NOT NULL THEN 'agendada'
                    WHEN v.dataProxima IS NOT NULL THEN 'proxima'
                    ELSE 'outra'
                    END as categoria
                    FROM vacinas v
                    JOIN animais a ON v.animalId = a.id
                    LEFT JOIN tipos_vacina tv ON v.tipo_vacina_id = tv.id
                    WHERE a.tutorId = $1 
                    AND (
                        -- Vacinas agendadas para os próximos 7 dias
                        (v.estado = 'agendada' AND v.data_agendada BETWEEN CURRENT_TIMESTAMP AND CURRENT_TIMESTAMP + INTERVAL '7 days')
                        OR
                        -- Próximas vacinas baseadas em dataProxima
                        (v.dataProxima IS NOT NULL AND v.dataProxima BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days')
                )
            ORDER BY 
                CASE WHEN v.data_agendada IS NOT NULL THEN v.data_agendada ELSE v.dataProxima END ASC
        `, [userId]);

        // marca quais vacinas já foram notificadas
        const vacinasParaNotificar = result.rows.filter(v => !v.notificado);

        // atualiza status de notificação
        if (vacinasParaNotificar.length > 0) {
            const idsParaNotificar = vacinasParaNotificar.map(v => v.id);
            await pool.query(
                `UPDATE vacinas SET notificado = true WHERE id = ANY($1)`,
                [idsParaNotificar]
            );
        }

        // responde com os resultados
        res.status(200).json({
            success: true,
            count: result.rows.length,
            vacinas: result.rows,
            mensagem: result.rows.length > 0
                ? `Encontradas ${result.rows.length} vacinas próximas`
                : 'Nenhuma vacina próxima encontrada'
        });

    } catch (error) {
        console.error('Erro ao obter vacinas próximas:', error);
        res.status(500).json({
            error: 'Erro no servidor',
            detalhes: error.message
        });
    }
});

// rota para obter vacinas agendadas de um animal
app.get('/animais/:animalId/vacinas/agendadas', authenticateToken, async (req, res) => {
    try {
        const { animalId } = req.params;
        const userId = req.user.id;

        // verifica se o animal pertence ao utilizador
        const animalCheck = await pool.query(
            'SELECT id FROM animais WHERE id = $1 AND tutorId = $2',
            [animalId, userId]
        );

        // se não encontrar o animal ou não pertencer ao utilizador
        if (animalCheck.rows.length === 0) {
            return res.status(404).json({
                error: 'Animal não encontrado ou não autorizado'
            });
        }

        // obtem vacinas agendadas para o animal
        const result = await pool.query(
            `SELECT v.*, tv.descricao, tv.periodicidade
                FROM vacinas v
                LEFT JOIN tipos_vacina tv ON v.tipo_vacina_id = tv.id
                WHERE v.animalId = $1 
                AND v.estado = 'agendada'
                ORDER BY v.data_agendada ASC`,
            [animalId]
        );

        res.status(200).json({
            success: true,
            count: result.rows.length,
            vacinas: result.rows
        });

    } catch (error) {
        console.error('Erro ao obter vacinas agendadas:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});


// POST /vacinas/agendar -> agenda nova vacina
app.post('/vacinas/agendar', authenticateToken, async (req, res) => {
    try {
        const { animalId, tipo_vacina_id, data_agendada, observacoes } = req.body;
        const userId = req.user.id;

        // validação dos campos obrigatórios
        if (!animalId || !tipo_vacina_id || !data_agendada) {
            return res.status(400).json({
                error: 'animalId, tipo_vacina_id e data_agendada são obrigatórios'
            });
        }

        // verifica se o animal pertence ao utilizador
        const animalCheck = await pool.query(
            'SELECT id, nome FROM animais WHERE id = $1 AND tutorId = $2',
            [animalId, userId]
        );

        // se não encontrar o animal ou não pertencer ao utilizador
        if (animalCheck.rows.length === 0) {
            return res.status(404).json({
                error: 'Animal não encontrado ou não pertence ao utilizador'
            });
        }

        // obtem informações do tipo de vacina
        const tipoVacinaResult = await pool.query(
            'SELECT * FROM tipos_vacina WHERE id = $1',
            [tipo_vacina_id]
        );

        // se não encontrar o tipo de vacina
        if (tipoVacinaResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Tipo de vacina não encontrado'
            });
        }

        const tipoVacina = tipoVacinaResult.rows[0];

        // converte a data agendada para objeto Date
        const dataAgendadaObj = new Date(data_agendada);
        const hoje = new Date();

        // verifica se a data não é no passado
        if (dataAgendadaObj < hoje) {
            return res.status(400).json({
                error: 'A data agendada não pode ser no passado'
            });
        }

        // calcula data da próxima vacinação baseado na periodicidade
        let dataProxima = null;
        if (tipoVacina.periodicidade === 'Anual') {
            dataProxima = new Date(dataAgendadaObj);
            dataProxima.setFullYear(dataProxima.getFullYear() + 1);
        }

        // insere a vacina agendada
        const result = await pool.query(
            `INSERT INTO vacinas 
                (animalId, tipo, tipo_vacina_id, data_agendada, dataProxima, observacoes, estado)
                VALUES ($1, $2, $3, $4, $5, $6, 'agendada')
                RETURNING *`,
            [animalId, tipoVacina.nome, tipo_vacina_id, data_agendada, dataProxima, observacoes]
        );

        const vacinaAgendada = result.rows[0];

        // procura dados do animal para a resposta
        const animal = animalCheck.rows[0];

        res.status(201).json({
            success: true,
            message: 'Vacina agendada com sucesso',
            vacina: vacinaAgendada,
            animal: {
                id: animal.id,
                nome: animal.nome
            },
            tipo_vacina: tipoVacina
        });

    } catch (error) {
        console.error('Erro ao agendar vacina:', error);
        res.status(500).json({
            error: 'Erro no servidor',
            detalhes: error.message
        });
    }
});

// PUT /vacinas/:id -> atualiza data da vacina
app.put('/vacinas/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { dataAplicacao, dataProxima, observacoes } = req.body;
        const userId = req.user.id;

        // verifica se a vacina existe e pertence ao utilizador
        const vacinaCheck = await pool.query(`
            SELECT v.*, a.tutorId 
            FROM vacinas v
            JOIN animais a ON v.animalId = a.id
            WHERE v.id = $1
        `, [parseInt(id)]);

        // se não encontrar a vacina
        if (vacinaCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Vacina não encontrada' });
        }

        // obtem a vacina
        const vacina = vacinaCheck.rows[0];

        // verifica permissões
        if (vacina.tutorid !== userId && req.user.tipo !== 'veterinario') {
            return res.status(403).json({
                error: 'Não autorizado a atualizar esta vacina'
            });
        }

        // atualiza vacina
        const result = await pool.query(`
            UPDATE vacinas 
            SET dataAplicacao = COALESCE($1, dataAplicacao),
                dataProxima = COALESCE($2, dataProxima),
                observacoes = COALESCE($3, observacoes)
            WHERE id = $4
            RETURNING *
        `, [dataAplicacao, dataProxima, observacoes, parseInt(id)]);

        console.log(`Vacina ID ${id} atualizada por utilizador ${userId}`);

        // responde com sucesso
        res.status(200).json({
            success: true,
            mensagem: 'Vacina atualizada com sucesso',
            vacina: result.rows[0]
        });

        // em caso de erro
    } catch (error) {
        console.error('Erro ao atualizar vacina:', error);
        res.status(500).json({
            error: 'Erro no servidor',
            detalhes: error.message
        });
    }
});

// DELETE /vacinas/:id -> remove uma vacina agendada
app.delete('/vacinas/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // verifica se a vacina existe e pertence ao utilizador
        const vacinaCheck = await pool.query(`
            SELECT v.*, a.tutorId, a.nome as animal_nome
            FROM vacinas v
            JOIN animais a ON v.animalId = a.id
            WHERE v.id = $1
        `, [parseInt(id)]);

        if (vacinaCheck.rows.length === 0) {
            return res.status(404).json({
                error: 'Vacina não encontrada',
                vacina_id: id
            });
        }

        // obtem a vacina
        const vacina = vacinaCheck.rows[0];

        // verifica permissões
        if (vacina.tutorid !== userId) {
            return res.status(403).json({
                error: 'Não autorizado a cancelar esta vacina',
                detalhes: 'Apenas o tutor pode cancelar vacinas'
            });
        }

        // apaga a vacina
        const deleteResult = await pool.query(
            'DELETE FROM vacinas WHERE id = $1 RETURNING id, tipo, animalId',
            [parseInt(id)]
        );

        console.log(`Vacina cancelada: ${vacina.tipo} para ${vacina.animal_nome} (ID: ${id}) por utilizador ${userId}`);

        res.status(200).json({
            success: true,
            message: 'Vacina cancelada com sucesso',
            vacina: {
                id: deleteResult.rows[0].id,
                tipo: deleteResult.rows[0].tipo,
                animalId: deleteResult.rows[0].animalid
            }
        });

    } catch (error) {
        console.error('Erro ao cancelar vacina:', error);
        res.status(500).json({
            error: 'Erro no servidor',
            detalhes: error.message
        });
    }
});

// GET /vacinas/tipos -> obtém todos os tipos de vacinas disponíveis (DA BD!)
app.get('/vacinas/tipos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tipos_vacina ORDER BY nome');

        res.status(200).json({
            success: true,
            tipos: result.rows,
            count: result.rows.length
        });

    } catch (error) {
        console.error('Erro ao obter tipos de vacinas:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// Rota para marcar vacina como realizada
app.post('/vacinas/:id/realizada', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { dataAplicacao, lote, veterinario, observacoes } = req.body;
        const userId = req.user.id;

        // verifica se a vacina existe e pertence ao utilizador
        const vacinaCheck = await pool.query(`
            SELECT v.*, a.tutorId 
            FROM vacinas v
            JOIN animais a ON v.animalId = a.id
            WHERE v.id = $1
        `, [parseInt(id)]);

        if (vacinaCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Vacina não encontrada' });
        }

        const vacina = vacinaCheck.rows[0];

        if (vacina.tutorid !== userId) {
            return res.status(403).json({
                error: 'Não autorizado'
            });
        }

        // atualiza vacina como realizada
        const result = await pool.query(`
            UPDATE vacinas 
            SET estado = 'realizada',
                dataAplicacao = COALESCE($1, CURRENT_DATE),
                lote = COALESCE($2, lote),
                veterinario = COALESCE($3, veterinario),
                observacoes = COALESCE($4, observacoes)
            WHERE id = $5
            RETURNING *
        `, [dataAplicacao, lote, veterinario, observacoes, parseInt(id)]);

        console.log(`Vacina ID ${id} marcada como realizada por utilizador ${userId}`);

        res.status(200).json({
            success: true,
            mensagem: 'Vacina marcada como realizada',
            vacina: result.rows[0]
        });

    } catch (error) {
        console.error('Erro ao marcar vacina como realizada:', error);
        res.status(500).json({
            error: 'Erro no servidor',
            detalhes: error.message
        });
    }
});



// rota principal==============================================

app.get('/', async (req, res) => {
    try {

        const [usersCount, animaisCount, consultasCount] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM users'),
            pool.query('SELECT COUNT(*) FROM animais'),
            pool.query('SELECT COUNT(*) FROM consultas')
        ]);

        res.json({
            // status da API
            api_status: 'online',
            message: 'API VetConnect está a funcionar',

            // informação do sistema
            ambiente: isRender ? 'PRODUÇÃO (Render + PostgreSQL)' : 'DESENVOLVIMENTO',
            database: 'PostgreSQL conectada',

            stats: {
                utilizadores: parseInt(usersCount.rows[0].count),
                animais: parseInt(animaisCount.rows[0].count),
                consultas: parseInt(consultasCount.rows[0].count)
            },

            // endpoints disponíveis
            endpoints: {
                auth: {
                    criar: 'POST /usuarios',
                    verificar: 'POST /usuarios/verificar',
                    criarPin: 'POST /usuarios/criar-pin',
                    login: 'POST /usuarios/login',
                    alterarPin: 'POST /usuarios/alterar-pin',
                    logout: 'POST /usuarios/logout',
                    recuperarPin: 'POST /usuarios/recuperar-pin',
                    redefinirPin: 'POST /usuarios/redefinir-pin'
                },
                dados: {
                    usuarios: 'GET /usuarios',
                    usuario_id: 'GET /usuarios/:id',
                    atualizar: 'PUT /usuarios/:id',
                    eliminar: 'DELETE /usuarios/:id'
                },
                consultas: {
                    clinicas: 'GET /clinicas',
                    veterinarios: 'GET /veterinarios',
                    veterinarios_clinica: 'GET /clinicas/:clinicaId/veterinarios',
                    marcar_consulta: 'POST /consultas',
                    consultas_utilizador: 'GET /consultas/user/:userId',
                    cancelar_consulta: 'DELETE /consultas/:id'
                },
                animais: {
                    animais: 'POST /animais',
                    animais_utilizador: 'GET /usuarios/:userId/animais',
                    animal_id: 'GET /animais/:animalId',
                    upload_foto: 'POST /animais/:animalId/foto'
                },
                documentos: {
                    criar_documento: 'POST /documentos',
                    documentos_animal: 'GET /animais/:animalId/documentos'
                },
                vacinas: {
                    vacinas_proximas: 'GET /vacinas/proximas',
                    atualizar_vacina: 'PUT /vacinas/:id',
                    cancelar_vacina: 'DELETE /vacinas/:id',
                    tipos_vacinas: 'GET /vacinas/tipos',
                    agendar_vacina: 'POST /vacinas/agendar',
                    vacinas_agendadas_animal: 'GET /animais/:animalId/vacinas/agendadas',
                    marcar_realizada: 'POST /vacinas/:id/realizada'
                }
            },

            timestamp: new Date().toISOString()
        });

    } catch (error) {
        // se a BD falhar
        res.status(500).json({
            api_status: 'offline',
            message: 'API funciona mas base de dados pode estar offline',
            error: error.message,
            timestamp: new Date().toISOString(),
        });
    }
});



// inicialização do servidor==============================================
const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await initDatabase(); // inicializa a base de dados

        await cleanupExpiredTokens(); // limpa tokens expirados ao iniciar

        app.listen(PORT, () => {
            console.log(`Servidor na porta ${PORT}`);
            console.log(`PostgreSQL: ${isRender ? 'Render' : 'Local'}`);
            console.log(`Iniciado: ${new Date().toISOString()}`);
        });

    } catch (error) {
        console.error('Falha ao iniciar servidor:', error);
        process.exit(1);
    }
}

startServer();



// cleanup do servidor==============================================
async function cleanup() {
    console.log('A limpar recursos');
    try {
        await pool.end(); // Fecha pool de conexões
        console.log('Pool de conexões fechado');
    } catch (error) {
        // Já fechado ou erro
    }
}

process.on('SIGINT', cleanup);   // Ctrl+C
process.on('SIGTERM', cleanup);  // Render

// função para limpar tokens expirados da blacklist
async function cleanupExpiredTokens() {
    try {
        // conta quantos tokens expirados existem
        const countResult = await pool.query(
            'SELECT COUNT(*) as count FROM invalidated_tokens WHERE expires_at < NOW()'
        );
        
        const countToDelete = parseInt(countResult.rows[0].count);
        
        if (countToDelete > 0) {
            // apaga os registos
            await pool.query(
                'DELETE FROM invalidated_tokens WHERE expires_at < NOW()'
            );
            
            console.log(`Limpeza automática: ${countToDelete} tokens expirados removidos da blacklist`);
        }
    } catch (err) {
        console.error('Erro na limpeza de tokens expirados:', err);
    }
}

// executa limpeza a cada hora (3600000 ms)
setInterval(cleanupExpiredTokens, 3600000);