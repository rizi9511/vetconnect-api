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

// CONFIGURAÇÃO MULTER PARA UPLOADS==============================================

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


// CONFIGURAÇÃO POSTGRESQL PARA RENDER==============================================

// verifica se está a correr no Render
const isRender = process.env.RENDER === 'true';

// cria pool de conexões com PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // URL da BD das variáveis de ambiente do Render
    ssl: isRender ? { rejectUnauthorized: false } : false // SSL só no Render
});



// INICIALIZAÇÃO BD==============================================

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
                telemovel TEXT,
                tipo TEXT NOT NULL,
                dataRegisto TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                verificado BOOLEAN DEFAULT false,
                codigoVerificacao TEXT,
                pin TEXT,
                nacionalidade TEXT,
                sexo TEXT,
                cc TEXT,
                dataNascimento DATE,
                morada TEXT
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
            CREATE TABLE IF NOT EXISTS tipos_exame(
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL,
                descricao TEXT
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS exames (
                id SERIAL PRIMARY KEY,
                animalId INTEGER NOT NULL REFERENCES animais(id) ON DELETE CASCADE,
                tipo_exame_id INTEGER REFERENCES tipos_exame(id),
                dataExame DATE NOT NULL,
                clinicaId INTEGER REFERENCES clinicas(id), 
                veterinarioId INTEGER REFERENCES veterinarios(id),
                resultado TEXT,  
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
                especie TEXT
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vacinas (
                id SERIAL PRIMARY KEY,
                animalId INTEGER NOT NULL REFERENCES animais(id) ON DELETE CASCADE,
                tipo TEXT NOT NULL,
                tipo_vacina_id INTEGER REFERENCES tipos_vacina(id), -- REFERÊNCIA AO TIPO
                data_agendada TIMESTAMP NOT NULL, 
                dataAplicacao DATE, -- QUANDO FOI REALMENTE APLICADA (PODE SER NULO INICIALMENTE)
                dataProxima DATE,
                clinicaId INTEGER REFERENCES clinicas(id),
                veterinarioId INTEGER REFERENCES veterinarios(id),
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
                    INSERT INTO clinicas(nome) VALUES
            ('Animal Clinic'),
            ('Bichomix - Hospital Veterinário'),
            ('Hospital Veterinário de Lisboa'),
            ('Centro Veterinário de Tomar'),
            ('VetLuz'),
            ('Hospital Veterinário de Alfragide')
                    RETURNING id-- retorna os IDs das clínicas inseridas
            `);

            // insere veterinários
            await pool.query(`
                    INSERT INTO veterinarios(nome, clinicaId) VALUES
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
                    INSERT INTO tipos_vacina(nome, descricao) VALUES
            ('Raiva', 'Vacina anual contra raiva'),
            ('Polivalente (V8/V10)', 'Proteção múltipla para cães'),
            ('Tripla Felina', 'Proteção contra doenças felinas'),
            ('Leishmaniose', 'Prevenção contra leishmaniose'),
            ('Tosse do Canil', 'Prevenção da traqueobronquite'),
            ('Giardia', 'Contra parasita intestinal'),
            ('Leptospirose', 'Contra bactéria Leptospira'),
            ('PIF', 'Peritonite Infeciosa Felina')
                `);

            }

            // verifica se já existe tabela de exames
            const examesExistentes = await pool.query('SELECT COUNT(*) FROM tipos_exame');
            if (parseInt(examesExistentes.rows[0].count) === 0) {
                await pool.query(`
                    INSERT INTO tipos_exame (nome, descricao) VALUES
                    ('Ecografia', 'Exame de imagem por ultrassons'),
                    ('Ressonância Magnética', 'Imagem detalhada por ressonância'),
                    ('Raio-X', 'Exame radiológico'),
                    ('Análise Sanguínea', 'Exame de sangue completo'),
                    ('Análise de Urina', 'Exame de urina'),
                    ('Análise de Fezes', 'Exame de fezes'),
                    ('Citologia', 'Exame de células'),
                    ('Biópsia', 'Retirada de amostra de tecido'),
                    ('Eletrocardiograma', 'Exame cardíaco'),
                    ('Endoscopia', 'Exame interno por câmara'),
                    ('Tomografia Computorizada', 'TC ou CAT scan'),
                    ('Ultrassonografia', 'Exame por ultrassom'),
                    ('Teste de Alergias', 'Teste a alergénios'),
                    ('Exame Oftalmológico', 'Exame aos olhos'),
                    ('Exame Dentário', 'Exame à dentição')
                `);
            }

            console.log('Dados de exemplo inseridos');
        }



    } catch (err) {
        console.error('Erro ao inserir dados exemplo:', err);
    }
}



// MIDDLEWARE DE AUTENTICAÇÃO==============================================


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



// ROTAS DE UTILIZADOR==============================================

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
            `INSERT INTO users(nome, email, telemovel, tipo, verificado, codigoVerificacao) 
        VALUES($1, $2, $3, $4, $5, $6) RETURNING id, dataRegisto`,
            [nome, email, telemovel, tipo, false, verificationCode] // false - não verificado inicialmente
        );

        // na consola mostra o código de verificação que funciona como um SMS simulado
        console.log(`Utilizador ${nome} criado.Código: ${verificationCode}`);

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


// POST /usuarios/verificar -> rota para verificar o código
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
        res.status(200).json({ message: 'Verificação bem-sucedida', userId: user.id });


    } catch (error) {
        console.error('Erro na verificação:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});


// POST /usuarios/criar-pin -> rota para criar o PIN
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
        res.status(200).json({ message: 'PIN criado com sucesso', userId: user.id });

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
            telemovel: user.telemovel,
            nacionalidade: user.nacionalidade,
            sexo: user.sexo,
            cc: user.cc,
            dataNascimento: user.datanascimento,
            morada: user.morada,
            tipo: user.tipo,
            dataRegisto: user.dataregisto,
            verificado: user.verificado
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
            'SELECT id, nome, email, telemovel, tipo, dataRegisto, verificado, nacionalidade, sexo, cc, dataNascimento, morada FROM users WHERE id = $1',
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
        console.log(`Código de recuperação para ${user.nome}(${email}): ${codigoRecuperacao}`);
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
        console.log(`PIN alterado para o utilizador ${user.nome}(ID: ${userId})`);

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
        const { token } = req;
        const userId = req.user.id;

        // Obter data de expiração do token
        const decoded = jwt.decode(token);
        const expiresAt = new Date(decoded.exp * 1000); // converter timestamp UNIX

        // Adicionar token à blacklist
        await pool.query(
            `INSERT INTO invalidated_tokens(token, expires_at, user_id) 
                VALUES($1, $2, $3)`,
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



// ROTAS DE ANIMAIS==============================================

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
                VALUES($1, $2, $3, $4, $5, $6, $7)
                RETURNING * `,
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

// PUT /animais/:id -> atualiza um animal
app.put('/animais/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, especie, raca, dataNascimento, numeroChip } = req.body;
        const userId = req.user.id;

        // Validação básica
        if (!nome || !especie) {
            return res.status(400).json({
                error: 'Nome e espécie são obrigatórios'
            });
        }

        // Verifica se o animal existe e pertence ao utilizador
        const animalCheck = await pool.query(
            'SELECT id, tutorId, nome FROM animais WHERE id = $1',
            [parseInt(id)]
        );

        if (animalCheck.rows.length === 0) {
            return res.status(404).json({
                error: 'Animal não encontrado'
            });
        }

        const animal = animalCheck.rows[0];

        // Verifica permissões
        if (animal.tutorid !== userId) {
            return res.status(403).json({
                error: 'Não autorizado a editar este animal'
            });
        }

        // Atualiza o animal
        const result = await pool.query(`
            UPDATE animais 
            SET nome = $1,
                especie = $2,
                raca = COALESCE($3, raca),
                dataNascimento = COALESCE($4, dataNascimento),
                numeroChip = COALESCE($5, numeroChip)
            WHERE id = $6
            RETURNING *
        `, [nome, especie, raca, dataNascimento, numeroChip, parseInt(id)]);

        console.log(`Animal ID ${id} atualizado por utilizador ${userId}`);

        res.status(200).json({
            success: true,
            message: 'Animal atualizado com sucesso',
            animal: result.rows[0]
        });

    } catch (error) {
        console.error('Erro ao atualizar animal:', error);
        res.status(500).json({
            error: 'Erro no servidor',
            details: error.message
        });
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

            // usa sempre a URL do Render quando disponível
            const baseUrl = process.env.RENDER_EXTERNAL_URL || `https://${req.get('host')}`;
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



// ROTAS DE CONSULTAS==============================================

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
                SELECT c.*, cli.nome as clinicanome, vet.nome as veterinarionome, a.nome as animalnome, a.especie as animalespecie  
                FROM consultas c
                JOIN clinicas cli ON c.clinicaId = cli.id
                JOIN veterinarios vet ON c.veterinarioId = vet.id
                LEFT JOIN animais a ON c.animalId = a.id 
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

// ROTAS DE VACINAS==============================================

// GET /vacinas -> obtem todas as vacinas
app.get('/vacinas', authenticateToken, async (req, res) => {
    try {
        
        const userId = req.user.id; 

        const result = await pool.query(`
            SELECT v.*, a.nome as animal_nome, c.nome as clinicaNome, vet.nome as veterinarioNome
            FROM vacinas v
            JOIN animais a ON v.animalId = a.id
            LEFT JOIN clinicas c ON v.clinicaId = c.id
            LEFT JOIN veterinarios vet ON v.veterinarioId = vet.id
            WHERE a.tutorId = $1
            ORDER BY v.data_agendada DESC
        `, [userId]);

        res.status(200).json({
            success: true,
            count: result.rows.length,
            vacinas: result.rows
        });

    } catch (error) {
        console.error('Erro ao obter todas as vacinas do utilizador:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// GET /vacinas/proximas -> obtem vacinas nos próximos 7 dias
app.get('/vacinas/proximas', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // vacinas que precisam ser aplicadas (próximas 7 dias)
        const result = await pool.query(`
        SELECT v.*, a.nome as animal_nome, a.especie, tv.descricao, c.nome as clinicaNome, vet.nome as veterinarioNome
                FROM vacinas v
                JOIN animais a ON v.animalId = a.id
                LEFT JOIN tipos_vacina tv ON v.tipo_vacina_id = tv.id
                LEFT JOIN clinicas c ON v.clinicaId = c.id
                LEFT JOIN veterinarios vet ON v.veterinarioId = vet.id
                WHERE a.tutorId = $1 
                AND v.estado = 'agendada' 
                AND v.data_agendada BETWEEN CURRENT_TIMESTAMP AND CURRENT_TIMESTAMP + INTERVAL '7 days'
            ORDER BY v.data_agendada ASC
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

// GET /animais/:animalId/vacinas/agendadas -> obter vacinas agendadas de um animal
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
        const result = await pool.query(`
            SELECT v.*, tv.descricao, c.nome as clinicaNome, vet.nome as veterinarioNome
                FROM vacinas v
                LEFT JOIN tipos_vacina tv ON v.tipo_vacina_id = tv.id
                LEFT JOIN clinicas c ON v.clinicaId = c.id
                LEFT JOIN veterinarios vet ON v.veterinarioId = vet.id
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
        const { animalId, tipo_vacina_id, data_agendada, clinicaId, veterinarioId, observacoes } = req.body;
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

        // insere a vacina agendada
        const result = await pool.query(
            `INSERT INTO vacinas
            (animalId, tipo, tipo_vacina_id, data_agendada clinicaId, veterinarioId, observacoes, estado)
                VALUES($1, $2, $3, $4, $5, $6, $7, 'agendada')
                RETURNING * `,
            [animalId, tipoVacina.nome, tipo_vacina_id, data_agendada, clinicaId, veterinarioId, observacoes]
        );

        const vacinaAgendada = result.rows[0];

        // procura dados do animal para a resposta
        const animal = animalCheck.rows[0];

        res.status(201).json({
            success: true,
            message: 'Vacina agendada com sucesso'
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
        const { tipo_vacina_id, dataAplicacao, clinicaId, veterinarioId, observacoes } = req.body;
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
        UPDATE vacinasSET tipo_vacina_id = COALESCE($1, tipo_vacina_id),
            dataAplicacao = COALESCE($2, dataAplicacao),
            clinicaId = COALESCE($3, clinicaId),
            veterinarioId = COALESCE($4, veterinarioId),
            observacoes = COALESCE($5, observacoes)
        WHERE id = $6
        RETURNING *
        `, [tipo_vacina_id, dataAplicacao, clinicaId, veterinarioId, observacoes, parseInt(id)]);


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

        console.log(`Vacina cancelada: ${vacina.tipo} para ${vacina.animal_nome}(ID: ${id}) por utilizador ${userId}`);

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

// GET /vacinas/tipos -> obtém todos os tipos de vacinas disponíveis
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



// ROTAS DE EXAMES==============================================

// GET /exames/tipos -> obtém todos os tipos de exame
app.get('/exames/tipos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tipos_exame ORDER BY nome');
        res.status(200).json({
            success: true,
            tipos: result.rows,
            count: result.rows.length
        });
    } catch (error) {
        console.error('Erro ao obter tipos de exame:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// POST /exames -> cria novo exame
app.post('/exames', authenticateToken, async (req, res) => {
    try {
        const { animalId, tipo_exame_id, dataExame, clinicaId, veterinarioId, resultado, observacoes } = req.body;

        const userId = req.user.id;

        if (!animalId || !tipo_exame_id || !dataExame || !clinicaId || !veterinarioId) {
            return res.status(400).json({
                error: 'animalId, tipo_exame_id, dataExame, clinicaId e veterinarioId são obrigatórios'
            });
        }

        // verifica se animal pertence ao user
        const animalCheck = await pool.query(
            'SELECT id FROM animais WHERE id = $1 AND tutorId = $2',
            [animalId, userId]
        );
        if (animalCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Animal não encontrado ou não autorizado' });
        }

        // verifica tipo de exame
        const tipoCheck = await pool.query(
            'SELECT id, nome FROM tipos_exame WHERE id = $1',
            [tipo_exame_id]
        );
        if (tipoCheck.rows.length === 0) {
            return res.status(400).json({ error: 'Tipo de exame não encontrado' });
        }

        // verifica se clínica existe
        const clinicaCheck = await pool.query(
            'SELECT nome FROM clinicas WHERE id = $1',
            [clinicaId]
        );
        if (clinicaCheck.rows.length === 0) {
            return res.status(400).json({ error: 'Clínica não encontrada' });
        }

        // Verifica se veterinário existe
        const vetCheck = await pool.query(
            'SELECT nome FROM veterinarios WHERE id = $1 AND clinicaId = $2',
            [veterinarioId, clinicaId]
        );
        if (vetCheck.rows.length === 0) {
            return res.status(400).json({
                error: 'Veterinário não encontrado ou não pertence a esta clínica'
            });
        }

        // insere exame
        const result = await pool.query(`
            INSERT INTO exames
            (animalId, tipo_exame_id, dataExame, clinicaId, veterinarioId, resultado, observacoes)
            VALUES($1, $2, $3, $4, $5, $6, $7) 
            RETURNING *,
            (SELECT nome FROM tipos_exame WHERE id = $2) as tipo_nome,
        (SELECT nome FROM clinicas WHERE id = $4) as clinica_nome,
    (SELECT nome FROM veterinarios WHERE id = $5) as veterinario_nome
        `, [animalId, tipo_exame_id, dataExame, clinicaId, veterinarioId, resultado, observacoes]);


        const exame = result.rows[0];
        exame.tipo_nome = tipoCheck.rows[0].nome;

        // renomeia campos para corresponder à aplicação
        const exameResponse = {
            id: exame.id,
            animalid: exame.animalid,
            tipo_exame_id: exame.tipo_exame_id,
            tipo_nome: exame.tipo_nome,
            dataexame: exame.dataexame,
            clinicaid: exame.clinicaid,
            clinicanome: exame.clinica_nome,
            veterinarioid: exame.veterinarioid,
            veterinarionome: exame.veterinario_nome,
            resultado: exame.resultado,
            observacoes: exame.observacoes,
            fotourl: exame.fotourl,
            dataregisto: exame.dataregisto
        };

        res.status(201).json({
            success: true,
            message: 'Exame criado com sucesso',
            exame: exameResponse
        });


    } catch (error) {
        console.error('Erro ao criar exame:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// POST /exames/:id/foto -> adiciona foto ao exame
app.post('/exames/:id/foto', authenticateToken, upload.single('foto'), async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        if (!req.file) {
            return res.status(400).json({ error: 'Nenhuma imagem enviada' });
        }

        // Verifica se exame existe e pertence ao user
        const exameCheck = await pool.query(`
            SELECT e.*, a.tutorId 
            FROM exames e
            JOIN animais a ON e.animalId = a.id
            WHERE e.id = $1
    `, [id]);

        if (exameCheck.rows.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Exame não encontrado' });
        }

        if (exameCheck.rows[0].tutorid !== userId) {
            fs.unlinkSync(req.file.path);
            return res.status(403).json({ error: 'Não autorizado' });
        }

        // Cria URL da foto
        const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://${req.get('host')}`;
        const fotoUrl = `${baseUrl}/uploads/${req.file.filename}`;

        // Atualiza exame
        await pool.query(
            'UPDATE exames SET fotoUrl = $1 WHERE id = $2',
            [fotoUrl, id]
        );

        res.status(200).json({
            success: true,
            message: 'Foto adicionada com sucesso',
            fotoUrl: fotoUrl
        });

    } catch (error) {
        console.error('Erro ao adicionar foto:', error);
        if (req.file && req.file.path) {
            try { fs.unlinkSync(req.file.path); } catch { }
        }
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// PUT /exames/:id -> atualiza um exame existente
app.put('/exames/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { dataExame, clinicaId, veterinarioId, resultado, observacoes, tipo_exame_id } = req.body;
        const userId = req.user.id;

        // Validação básica
        if (!dataExame) {
            return res.status(400).json({
                error: 'dataExame é obrigatória'
            });
        }

        // Verifica se o exame existe e pertence ao utilizador
        const exameCheck = await pool.query(`
            SELECT e.*, a.tutorId 
            FROM exames e
            JOIN animais a ON e.animalId = a.id
            WHERE e.id = $1
        `, [parseInt(id)]);

        if (exameCheck.rows.length === 0) {
            return res.status(404).json({
                error: 'Exame não encontrado'
            });
        }

        const exame = exameCheck.rows[0];

        // Verifica permissões
        if (exame.tutorid !== userId) {
            return res.status(403).json({
                error: 'Não autorizado a editar este exame'
            });
        }

        // Verifica se o tipo de exame existe (se foi fornecido)
        let tipoNome = exame.tipo_exame_id;
        if (tipo_exame_id) {
            const tipoCheck = await pool.query(
                'SELECT nome FROM tipos_exame WHERE id = $1',
                [tipo_exame_id]
            );
            if (tipoCheck.rows.length === 0) {
                return res.status(400).json({
                    error: 'Tipo de exame não encontrado'
                });
            }
            tipoNome = tipoCheck.rows[0].nome;
        }

        // Verifica se clínica existe (se foi fornecida)
        if (clinicaId) {
            const clinicaCheck = await pool.query(
                'SELECT nome FROM clinicas WHERE id = $1',
                [clinicaId]
            );
            if (clinicaCheck.rows.length === 0) {
                return res.status(400).json({
                    error: 'Clínica não encontrada'
                });
            }
        }

        // Verifica se veterinário existe (se foi fornecido)
        if (veterinarioId) {
            const clinicaIdToCheck = clinicaId || exame.clinicaid;
            const vetCheck = await pool.query(
                'SELECT nome FROM veterinarios WHERE id = $1 AND clinicaId = $2',
                [veterinarioId, clinicaIdToCheck]
            );
            if (vetCheck.rows.length === 0) {
                return res.status(400).json({
                    error: 'Veterinário não encontrado ou não pertence a esta clínica'
                });
            }
        }

        // atualiza o exame
        const result = await pool.query(`
            UPDATE exames 
            SET dataExame = $1,
                clinicaId = COALESCE($2, clinicaId),
                veterinarioId = COALESCE($3, veterinarioId),
                resultado = COALESCE($4, resultado),
                observacoes = COALESCE($5, observacoes),
                tipo_exame_id = COALESCE($6, tipo_exame_id)
            WHERE id = $7
            RETURNING *,
                (SELECT nome FROM tipos_exame WHERE id = exames.tipo_exame_id) as tipo_nome,
                (SELECT nome FROM clinicas WHERE id = exames.clinicaId) as clinica_nome,
                (SELECT nome FROM veterinarios WHERE id = exames.veterinarioId) as veterinario_nome
        `, [dataExame, clinicaId, veterinarioId, resultado, observacoes, tipo_exame_id, parseInt(id)]);

        const updatedExame = result.rows[0];

        // renomeia campos para corresponder à aplicação
        const exameResponse = {
            id: updatedExame.id,
            animalid: updatedExame.animalid,
            tipo_exame_id: updatedExame.tipo_exame_id,
            tipo_nome: updatedExame.tipo_nome,
            dataexame: updatedExame.dataexame,
            clinicaid: updatedExame.clinicaid,
            clinicanome: updatedExame.clinica_nome,
            veterinarioid: updatedExame.veterinarioid,
            veterinarionome: updatedExame.veterinario_nome,
            resultado: updatedExame.resultado,
            observacoes: updatedExame.observacoes,
            fotourl: updatedExame.fotourl,
            dataregisto: updatedExame.dataregisto
        };

        console.log(`Exame ID ${id} atualizado por utilizador ${userId}`);

        res.status(200).json({
            success: true,
            message: 'Exame atualizado com sucesso',
            exame: result.rows[0]
        });

    } catch (error) {
        console.error('Erro ao atualizar exame:', error);
        res.status(500).json({
            error: 'Erro no servidor',
            details: error.message
        });
    }
});

// GET /animais/:animalId/exames -> obtém exames de um animal
app.get('/animais/:animalId/exames', authenticateToken, async (req, res) => {
    try {
        const { animalId } = req.params;
        const userId = req.user.id;

        // Verifica permissões
        const animalCheck = await pool.query(
            'SELECT id FROM animais WHERE id = $1 AND tutorId = $2',
            [animalId, userId]
        );
        if (animalCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Não autorizado' });
        }

        // Obtém exames
        const result = await pool.query(`
            SELECT 
                e.*,
                te.nome as tipo_nome,
                te.descricao as tipo_descricao,
                c.nome as clinicanome,
                v.nome as veterinarionome
            FROM exames e
            LEFT JOIN tipos_exame te ON e.tipo_exame_id = te.id
            LEFT JOIN clinicas c ON e.clinicaId = c.id
            LEFT JOIN veterinarios v ON e.veterinarioId = v.id
            WHERE e.animalId = $1
            ORDER BY e.dataExame DESC
        `, [animalId]);

        // transforma os resultados para corresponder à aplicação
        const examesFormatados = result.rows.map(exame => ({
            id: exame.id,
            animalid: exame.animalid,
            tipo_exame_id: exame.tipo_exame_id,
            tipo_nome: exame.tipo_nome,
            dataexame: exame.dataexame,
            clinicaid: exame.clinicaid,
            clinicanome: exame.clinica_nome,
            veterinarioid: exame.veterinarioid,
            veterinarionome: exame.veterinario_nome,
            resultado: exame.resultado,
            observacoes: exame.observacoes,
            fotourl: exame.fotourl,
            dataregisto: exame.dataregisto
        }));

        res.status(200).json({
            success: true,
            exames: result.rows,
            count: result.rows.length
        });

    } catch (error) {
        console.error('Erro ao obter exames:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// DELETE /exames/:id -> apaga um exame
app.delete('/exames/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // verifica se o exame existe e pertence ao utilizador
        const exameCheck = await pool.query(`
            SELECT e.*, a.tutorId, e.fotoUrl
            FROM exames e
            JOIN animais a ON e.animalId = a.id
            WHERE e.id = $1
        `, [parseInt(id)]);

        if (exameCheck.rows.length === 0) {
            return res.status(404).json({
                error: 'Exame não encontrado'
            });
        }

        const exame = exameCheck.rows[0];

        // verifica permissões
        if (exame.tutorid !== userId) {
            return res.status(403).json({
                error: 'Não autorizado a apagar este exame'
            });
        }

        // se tiver foto, apaga o ficheiro
        if (exame.fotourl) {
            try {
                const filename = exame.fotourl.split('/uploads/')[1];
                const filePath = path.join(__dirname, 'uploads', filename);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (fileError) {
                console.error('Erro ao apagar ficheiro da foto:', fileError);
            }
        }

        // apaga o exame
        await pool.query('DELETE FROM exames WHERE id = $1', [parseInt(id)]);

        console.log(`Exame ID ${id} apagado por utilizador ${userId}`);

        res.status(200).json({
            success: true,
            message: 'Exame apagado com sucesso'
        });

    } catch (error) {
        console.error('Erro ao apagar exame:', error);
        res.status(500).json({
            error: 'Erro no servidor',
            details: error.message
        });
    }
});



// ROTA PRINCIPAL==============================================
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
                    atualizar_animal: 'PUT /animais/:id',
                    upload_foto: 'POST /animais/:animalId/foto'
                },
                vacinas: {
                    vacinas: 'GET /vacinas',
                    vacinas_proximas: 'GET /vacinas/proximas',
                    atualizar_vacina: 'PUT /vacinas/:id',
                    cancelar_vacina: 'DELETE /vacinas/:id',
                    tipos_vacinas: 'GET /vacinas/tipos',
                    agendar_vacina: 'POST /vacinas/agendar',
                    vacinas_agendadas_animal: 'GET /animais/:animalId/vacinas/agendadas',
                    marcar_realizada: 'POST /vacinas/:id/realizada'
                },
                exames: {
                    tipos_exames: 'GET /exames/tipos',
                    criar_exame: 'POST /exames',
                    upload_foto_exame: 'POST /exames/:exameId/foto',
                    exames_animal: 'GET /animais/:animalId/exames',
                    atualizar_exame: 'PUT /exames/:id',
                    apagar_exame: 'DELETE /exames/:id'
                }
            },

            timestamp: new Date().toISOString()
        });

        // se a BD falhar
    } catch (error) {
        res.status(500).json({
            api_status: 'offline',
            message: 'API funciona mas base de dados pode estar offline',
            timestamp: new Date().toISOString(),
        });
    }
});



// INICIALIZAÇÃO DO SERVIDOR==============================================

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



// CLEANUP DO SERVIDOR==============================================
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

        if (!pool) return;
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
        console.error('Erro na limpeza:', err);
    }
}


// executa limpeza a cada hora (3600000 ms)
setInterval(cleanupExpiredTokens, 3600000);