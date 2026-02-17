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
                animalId INTEGER REFERENCES animais(id) ON DELETE CASCADE, 
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
                descricao TEXT
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



// MIDDLEWARE==============================================
//ALTERAÇÃO APÓS ENTREGA (TROCA DAS ROTAS)

// MIDDLEWARE DE DEBUG
app.use((req, res, next) => {
    // Verificar se debug está ativo -> ?debug=true na URL, ignora autenticação
    if (process.env.DEBUG_MODE === 'true' && req.query.debug === 'true') {
        console.log(`🔧 DEBUG ATIVADO: ${req.method} ${req.path}`);
        
        // Cria user fake com poderes de veterinário
        req.user = { 
            id: 999, 
            email: 'debug@teste.com',
            tipo: 'veterinario'  // Veterinário vê tudo
        };
        req.token = 'debug-token';
        
        // Guardar referência para o método original
        const originalJson = res.json;
        
        // Interceptar a resposta para adicionar aviso
        res.json = function(data) {
            if (data && typeof data === 'object') {
                data.aviso = '🔧 Modo debug ativo';
            }
            return originalJson.call(this, data);
        };
        
        return next(); // Continua para as rotas
    }
    next();
});

// MIDDLEWARE DE AUTENTICAÇÃO 
function authenticateToken(req, res, next) {
    // SE JÁ TEM USER DO DEBUG (ID 999), PASSA DIRETO SEM VERIFICAR TOKEN
    if (req.user && req.user.id === 999) {
        console.log(`🔧 DEBUG: a ignorar autenticação para ${req.path}`);
        return next();
    }
    
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

// POST /utilizadores -> cria um novo utilizador
app.post('/utilizadores', async (req, res) => {
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


// POST /utilizadores/verificar -> rota para verificar o código
app.post('/utilizadores/verificar', async (req, res) => {
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


// POST /utilizadores/criar-pin -> rota para criar o PIN
app.post('/utilizadores/criar-pin', async (req, res) => {
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
app.post('/utilizadores/login', async (req, res) => {
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
// GET /utilizadores -> obter todos os utilizadores 
app.get('/utilizadores', authenticateToken, async (req, res) => {
    try {
        console.log(`Utilizador ${req.user.id} (${req.user.tipo}) acedeu à lista de utilizadores.`);
        
        // Vou assumir que qualquer user autenticado pode ver (mas limitamos os campos)
        const result = await pool.query(
            'SELECT id, nome, email, tipo, dataRegisto, verificado FROM users ORDER BY nome'
        );
        
        res.status(200).json({
            success: true,
            count: result.rows.length,
            utilizadores: result.rows
        });
    } catch (error) {
        console.error('Erro ao procurar utilizadores:', error);
        res.status(500).json({ error: 'Erro ao procurar utilizadores' });
    }
});

// GET /utilizadores/:id -> obter um utilizador específico
app.get('/utilizadores/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params; // Obter ID dos parâmetros da rota
        const userIdFromToken = req.user.id; // ID do utilizador autenticado

        // Verificar permissões - o utilizador só pode ver os seus próprios dados
        // A menos que seja um veterinário ou admin (se existir esse tipo)
        if (parseInt(id) !== userIdFromToken && req.user.tipo !== 'veterinario') {
            return res.status(403).json({ 
                error: 'Acesso negado. Só pode visualizar os seus próprios dados.' 
            });
        }

        const result = await pool.query(
            'SELECT id, nome, email, telemovel, tipo, dataRegisto, verificado, nacionalidade, sexo, cc, dataNascimento, morada FROM users WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Utilizador não encontrado' });
        }

        console.log(`Utilizador ID ${userIdFromToken} acedeu aos dados do utilizador ID ${id}`);

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao procurar utilizador:', error);
        res.status(500).json({ error: 'Erro ao procurar utilizador' });
    }
});

// PUT /utilizadores/:id -> atualizar um utilizador
app.put('/utilizadores/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params; // ID do utilizador a ser atualizado
        const userIdFromToken = req.user.id; // ID do utilizador autenticado
        
        // Dados que podem ser atualizados (expandidos para incluir mais campos)
        const { 
            nome, 
            email, 
            telemovel,
            nacionalidade, 
            sexo, 
            cc, 
            dataNascimento, 
            morada 
        } = req.body;

        // IMPEDIR que o utilizador mude o próprio tipo ou outros campos sensíveis
        // Estes campos só devem ser alterados por administradores (se existir essa funcionalidade)

        // Verificar permissões - apenas o próprio utilizador pode atualizar os seus dados
        if (parseInt(id) !== userIdFromToken) {
            return res.status(403).json({ 
                error: 'Acesso negado. Só pode atualizar os seus próprios dados.' 
            });
        }

        // Validação básica - pelo menos um campo para atualizar
        if (!nome && !email && !telemovel && !nacionalidade && !sexo && !cc && !dataNascimento && !morada) {
            return res.status(400).json({ 
                error: 'Pelo menos um campo deve ser fornecido para atualização' 
            });
        }

        // Verificar se o utilizador existe
        const userExists = await pool.query(
            'SELECT id FROM users WHERE id = $1',
            [id]
        );

        if (userExists.rows.length === 0) {
            return res.status(404).json({ error: 'Utilizador não encontrado' });
        }

        // Se estiver a tentar atualizar o email, verificar se já existe
        if (email) {
            const emailCheck = await pool.query(
                'SELECT id FROM users WHERE email = $1 AND id != $2',
                [email, id]
            );

            if (emailCheck.rows.length > 0) {
                return res.status(400).json({ 
                    error: 'Email já está em uso por outro utilizador' 
                });
            }
        }

        // Se estiver a tentar atualizar o telemóvel, verificar se já existe
        if (telemovel) {
            const phoneCheck = await pool.query(
                'SELECT id FROM users WHERE telemovel = $1 AND id != $2',
                [telemovel, id]
            );

            if (phoneCheck.rows.length > 0) {
                return res.status(400).json({ 
                    error: 'Telemóvel já está em uso por outro utilizador' 
                });
            }

            // Validar formato do telemóvel
            const telemovelRegex = /^\+?[0-9]{9,15}$/;
            if (!telemovelRegex.test(telemovel)) {
                return res.status(400).json({
                    error: 'Número de telemóvel inválido'
                });
            }
        }

        // Construir query dinâmica baseada nos campos fornecidos
        const updateFields = [];
        const queryParams = [];
        let paramCounter = 1;

        if (nome) {
            updateFields.push(`nome = $${paramCounter++}`);
            queryParams.push(nome);
        }
        if (email) {
            updateFields.push(`email = $${paramCounter++}`);
            queryParams.push(email);
        }
        if (telemovel) {
            updateFields.push(`telemovel = $${paramCounter++}`);
            queryParams.push(telemovel);
        }
        if (nacionalidade !== undefined) {
            updateFields.push(`nacionalidade = $${paramCounter++}`);
            queryParams.push(nacionalidade);
        }
        if (sexo !== undefined) {
            updateFields.push(`sexo = $${paramCounter++}`);
            queryParams.push(sexo);
        }
        if (cc !== undefined) {
            updateFields.push(`cc = $${paramCounter++}`);
            queryParams.push(cc);
        }
        if (dataNascimento !== undefined) {
            updateFields.push(`dataNascimento = $${paramCounter++}`);
            queryParams.push(dataNascimento);
        }
        if (morada !== undefined) {
            updateFields.push(`morada = $${paramCounter++}`);
            queryParams.push(morada);
        }

        // Adicionar ID no final dos parâmetros
        queryParams.push(id);

        const query = `
            UPDATE users 
            SET ${updateFields.join(', ')} 
            WHERE id = $${paramCounter}
            RETURNING id, nome, email, telemovel, tipo, nacionalidade, sexo, cc, dataNascimento, morada
        `;

        const result = await pool.query(query, queryParams);

        // Log para auditoria
        console.log(`Utilizador ID ${userIdFromToken} atualizou os seus próprios dados (${Object.keys(req.body).join(', ')})`);

        res.status(200).json({ 
            success: true,
            message: 'Utilizador atualizado com sucesso',
            user: result.rows[0]
        });

    } catch (error) {
        console.error('Erro ao atualizar utilizador:', error);
        res.status(500).json({ 
            error: 'Erro no servidor',
            details: error.message 
        });
    }
});


// POST /utilizadores/alterar-pin -> altera o PIN do utilizador autenticado
app.post('/utilizadores/alterar-pin', authenticateToken, async (req, res) => {
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

// POST /utilizadores/logout -> invalida o token do utilizador
app.post('/utilizadores/logout', authenticateToken, async (req, res) => {
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

        // Inserir animal
        const insertResult = await pool.query(
            `INSERT INTO animais
             (tutorId, nome, especie, raca, dataNascimento, numeroChip, codigoUnico)
             VALUES($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [tutorId, nome, especie, raca, dataNascimento, numeroChip, codigoUnico]
        );

        const novoAnimalId = insertResult.rows[0].id;

        // Buscar animal completo com dados do tutor
        const animalResult = await pool.query(
            `SELECT a.*, 
                    u.nome as tutorNome, 
                    u.email as tutorEmail,
                    u.telemovel as tutorTelemovel
             FROM animais a
             JOIN users u ON a.tutorId = u.id
             WHERE a.id = $1`,
            [novoAnimalId]
        );

        const novoAnimal = animalResult.rows[0];

        console.log(`Animal criado: ${nome} (ID: ${novoAnimalId}) para tutor ${tutorId}`);

        res.status(201).json({
            success: true,
            message: 'Animal criado com sucesso',
            animal: novoAnimal
        });

    } catch (error) {
        console.error('Erro ao criar animal:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// GET /utilizadores/:userId/animais -> obtem animais de um tutor
app.get('/utilizadores/:userId/animais', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;

        // Verificar se o utilizador tem permissão
        if (parseInt(userId) !== req.user.id && req.user.tipo !== 'veterinario') {
            return res.status(403).json({ error: 'Não autorizado' });
        }

        // Buscar animais com dados do tutor
        const result = await pool.query(
            `SELECT a.*, 
                    u.nome as tutorNome, 
                    u.email as tutorEmail,
                    u.telemovel as tutorTelemovel
             FROM animais a
             JOIN users u ON a.tutorId = u.id
             WHERE a.tutorId = $1 
             ORDER BY a.nome`,
            [userId]
        );

        console.log(`Utilizador ${req.user.id} acedeu aos ${result.rows.length} animais do tutor ${userId}`);

        res.status(200).json({
            success: true,
            count: result.rows.length,
            animais: result.rows
        });

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
        const updateResult = await pool.query(
            `UPDATE animais 
             SET nome = $1,
                 especie = $2,
                 raca = COALESCE($3, raca),
                 dataNascimento = COALESCE($4, dataNascimento),
                 numeroChip = COALESCE($5, numeroChip)
             WHERE id = $6
             RETURNING id`,
            [nome, especie, raca, dataNascimento, numeroChip, parseInt(id)]
        );

        // Buscar animal completo com dados do tutor
        const animalResult = await pool.query(
            `SELECT a.*, 
                    u.nome as tutorNome, 
                    u.email as tutorEmail,
                    u.telemovel as tutorTelemovel
             FROM animais a
             JOIN users u ON a.tutorId = u.id
             WHERE a.id = $1`,
            [updateResult.rows[0].id]
        );

        const animalAtualizado = animalResult.rows[0];

        console.log(`Animal ID ${id} atualizado por utilizador ${userId}`);

        res.status(200).json({
            success: true,
            message: 'Animal atualizado com sucesso',
            animal: animalAtualizado
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
        // o corpo do pedido corresponde ao modelo NovaConsulta do android
        const { animalId, clinicaId, veterinarioId, data, motivo } = req.body;
        const userId = req.user.id;

        // validacao dos campos obrigatorios
        if (!animalId || !clinicaId || !veterinarioId || !data) {
            return res.status(400).json({
                error: 'todos os campos sao obrigatorios: animalId, clinicaId, veterinarioId, data'
            });
        }

        // extrai a data e a hora da string iso (ex: "2024-08-15T10:00:00")
        const fullDate = new Date(data);
        
        // verifica se a data é valida
        if (isNaN(fullDate.getTime())) {
            return res.status(400).json({
                error: 'formato de data invalido. use iso 8601 (ex: 2024-08-15T10:00:00)'
            });
        }

        const dataSql = fullDate.toISOString().split('T')[0]; // "2024-08-15" 
        const horaSql = fullDate.toTimeString().split(' ')[0]; // "10:00:00"

        // verifica se a data da consulta nao e no passado
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        
        if (fullDate < hoje) {
            return res.status(400).json({
                error: 'a data da consulta nao pode ser no passado'
            });
        }

        // verifica se o animal pertence ao utilizador
        const animalCheck = await pool.query(
            'SELECT id, nome, tutorId FROM animais WHERE id = $1',
            [animalId]
        );

        if (animalCheck.rows.length === 0) {
            return res.status(404).json({ error: 'animal nao encontrado' });
        }

        if (animalCheck.rows[0].tutorid !== userId) {
            console.log(`tentativa nao autorizada: user ${userId} tentou marcar consulta para animal ${animalId} de outro tutor`);
            return res.status(403).json({ 
                error: 'nao autorizado. este animal nao lhe pertence' 
            });
        }

        // verifica se o veterinario pertence a clinica selecionada
        const veterinarioCheck = await pool.query(
            'SELECT id, nome, clinicaId FROM veterinarios WHERE id = $1 AND clinicaId = $2',
            [veterinarioId, clinicaId]
        );

        if (veterinarioCheck.rows.length === 0) {
            return res.status(400).json({
                error: 'veterinario nao encontrado ou nao pertence a clinica selecionada'
            });
        }

        // verifica se a clinica existe
        const clinicaCheck = await pool.query(
            'SELECT id, nome FROM clinicas WHERE id = $1',
            [clinicaId]
        );

        if (clinicaCheck.rows.length === 0) {
            return res.status(404).json({ error: 'clinica nao encontrada' });
        }

        // verifica se ja existe uma consulta marcada para o mesmo veterinario na mesma data e hora
        const consultaConflito = await pool.query(
            `SELECT * FROM consultas 
             WHERE veterinarioId = $1 
             AND data = $2 
             AND hora = $3 
             AND estado != 'cancelada'`,
            [veterinarioId, dataSql, horaSql]
        );

        if (consultaConflito.rows.length > 0) {
            return res.status(409).json({
                error: 'ja existe uma consulta marcada para este veterinario no mesmo horario'
            });
        }

        // insercao na base de dados
        const insertResult = await pool.query(
            `INSERT INTO consultas 
             (userId, animalId, clinicaId, veterinarioId, data, hora, motivo, estado) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'marcada')
             RETURNING id`,
            [userId, animalId, clinicaId, veterinarioId, dataSql, horaSql, motivo]
        );

        const novaConsultaId = insertResult.rows[0].id;

        // busca a consulta completa para devolver a app
        const finalResult = await pool.query(`
            SELECT c.*, 
                   cli.nome as clinicanome, 
                   vet.nome as veterinarionome, 
                   a.nome as animalnome,
                   a.especie as animalespecie
            FROM consultas c
            JOIN clinicas cli ON c.clinicaId = cli.id
            JOIN veterinarios vet ON c.veterinarioId = vet.id
            LEFT JOIN animais a ON c.animalId = a.id
            WHERE c.id = $1
        `, [novaConsultaId]);

        const consultaCriada = finalResult.rows[0];

        // log da operacao
        console.log(`consulta marcada - id: ${novaConsultaId}, user: ${userId}, animal: ${consultaCriada.animalnome}, data: ${consultaCriada.data}`);

        // responde com o objeto completo
        res.status(201).json({
            success: true,
            message: 'consulta marcada com sucesso',
            consulta: consultaCriada
        });

    } catch (error) {
        console.error('erro ao marcar consulta:', error);
        res.status(500).json({ 
            error: 'erro no servidor',
            message: 'nao foi possivel marcar a consulta. tente novamente.'
        });
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

// GET /consultas/user/:userId -> consultas de um utilizador 
app.get('/consultas/user/:userId', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const requestingUser = req.user; // Utilizador que faz o pedido (do token)

        // VERIFICAÇÃO DE PERMISSÃO CRÍTICA
        // 1. O utilizador só pode ver as suas próprias consultas
        // 2. Veterinários podem ver consultas de qualquer utilizador
        if (parseInt(userId) !== requestingUser.id && requestingUser.tipo !== 'veterinario') {
            console.warn(`Tentativa de acesso não autorizado: Utilizador ${requestingUser.id} tentou aceder consultas do utilizador ${userId}`);
            return res.status(403).json({ 
                error: 'Acesso não autorizado. Só pode ver as suas próprias consultas.' 
            });
        }

        const result = await pool.query(`
            SELECT c.*, 
                   cli.nome as clinicanome, 
                   vet.nome as veterinarionome, 
                   a.nome as animalnome,
                   a.especie as animalespecie
            FROM consultas c
            JOIN clinicas cli ON c.clinicaId = cli.id
            JOIN veterinarios vet ON c.veterinarioId = vet.id
            LEFT JOIN animais a ON c.animalId = a.id
            WHERE c.userId = $1
            ORDER BY c.data DESC, c.hora DESC
        `, [userId]);

        console.log(`Utilizador ${requestingUser.id} (${requestingUser.tipo}) acedeu às consultas do utilizador ${userId} - ${result.rows.length} consultas encontradas`);

        res.status(200).json({
            success: true,
            count: result.rows.length,
            consultas: result.rows
        });

    } catch (error) {
        console.error('Erro ao obter consultas:', error);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// DELETE /consultas/:id -> cancela uma consulta
app.delete('/consultas/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const userTipo = req.user.tipo;

        // Primeiro, verifica se a consulta existe e obtém detalhes para auditoria
        const consultaCheck = await pool.query(`
            SELECT c.id, c.userId, c.data, c.hora, 
                   a.nome as animal_nome,
                   cli.nome as clinica_nome
            FROM consultas c
            LEFT JOIN animais a ON c.animalId = a.id
            LEFT JOIN clinicas cli ON c.clinicaId = cli.id
            WHERE c.id = $1
        `, [id]);

        if (consultaCheck.rows.length === 0) {
            console.warn(`Tentativa de cancelar consulta inexistente ID ${id} por utilizador ${userId}`);
            return res.status(404).json({ error: 'Consulta não encontrada' });
        }

        const consulta = consultaCheck.rows[0];

        // VERIFICAÇÃO DE PERMISSÃO CRÍTICA
        // Apenas o dono da consulta pode cancelar (ou veterinários, se aplicável)
        if (consulta.userid !== userId && userTipo !== 'veterinario') {
            console.warn(`Tentativa de acesso não autorizado: Utilizador ${userId} (${userTipo}) tentou cancelar consulta ${id} do utilizador ${consulta.userid}`);
            
            // Log mais detalhado para auditoria
            console.warn(`   Detalhes da tentativa: Consulta ID ${id}, Data: ${consulta.data}, Animal: ${consulta.animal_nome || 'N/A'}`);
            
            return res.status(403).json({ 
                error: 'Não autorizado a cancelar esta consulta',
                message: 'Apenas o tutor que marcou a consulta pode cancelá-la'
            });
        }

        // Opcional: Verificar se a consulta já passou
        const dataConsulta = new Date(consulta.data);
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        
        if (dataConsulta < hoje) {
            return res.status(400).json({ 
                error: 'Não é possível cancelar consultas que já ocorreram',
                message: 'Consultas passadas não podem ser canceladas'
            });
        }

        // Opcional: Verificar se a consulta já foi realizada ou cancelada
        // Se tivesse um campo 'estado' na tabela consultas, verificaríamos aqui

        // Se a permissão estiver correta, apaga a consulta
        const result = await pool.query(
            'DELETE FROM consultas WHERE id = $1 RETURNING id',
            [id]
        );

        // LOG DE AUDITORIA DETALHADO
        console.log(`Consulta cancelada - ID: ${id}`);
        console.log(`Cancelada por: Utilizador ${userId} (${userTipo})`);
 

        // Resposta de sucesso
        res.status(200).json({
            success: true,
            message: 'Consulta cancelada com sucesso',
            consultaId: result.rows[0].id,
            detalhes: {
                data: consulta.data,
                hora: consulta.hora,
                clinica: consulta.clinica_nome,
                animal: consulta.animal_nome
            }
        });

    } catch (error) {
        console.error('Erro ao cancelar consulta:', error);
        res.status(500).json({ 
            error: 'Erro no servidor',
            message: 'Não foi possível cancelar a consulta. Tente novamente mais tarde.'
        });
    }
});

// PUT /consultas/:id -> atualiza uma consulta 
app.put('/consultas/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // 1. verificar se a consulta existe e pertence ao utilizador
        const originalConsultaQuery = await pool.query(
            'SELECT * FROM consultas WHERE id = $1',
            [id]
        );

        if (originalConsultaQuery.rows.length === 0) {
            return res.status(404).json({ error: 'consulta nao encontrada' });
        }

        const originalConsulta = originalConsultaQuery.rows[0];
        
        // verificacao de permissao - apenas o dono pode editar
        if (originalConsulta.userid !== userId) {
            console.log(`tentativa nao autorizada: user ${userId} tentou editar consulta ${id} do user ${originalConsulta.userid}`);
            return res.status(403).json({ error: 'acesso nao autorizado' });
        }

        // 2. obter dados para atualizar (do modelo da aplicacao)
        const { motivo, data, clinicaId, veterinarioId, observacoes } = req.body;

        // manter valores originais se nao forem fornecidos novos
        const novoMotivo = motivo !== undefined ? motivo : originalConsulta.motivo;
        const novaClinicaId = clinicaId !== undefined ? clinicaId : originalConsulta.clinicaid;
        const novoVeterinarioId = veterinarioId !== undefined ? veterinarioId : originalConsulta.veterinarioid;
        const novasObservacoes = observacoes !== undefined ? observacoes : originalConsulta.observacoes;

        let novaDataSql = originalConsulta.data;
        let novaHoraSql = originalConsulta.hora;

        // se uma nova data for fornecida, processa-la
        if (data) {
            const fullDate = new Date(data);
            
            // validar formato da data
            if (isNaN(fullDate.getTime())) {
                return res.status(400).json({
                    error: 'formato de data invalido. use iso 8601'
                });
            }

            // verificar se a data nao e no passado
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            
            if (fullDate < hoje) {
                return res.status(400).json({
                    error: 'a data da consulta nao pode ser no passado'
                });
            }

            novaDataSql = fullDate.toISOString().split('T')[0];
            novaHoraSql = fullDate.toTimeString().split(' ')[0];
        }

        // 3. validacoes se algo importante mudou
        const dataMudou = data && (novaDataSql !== originalConsulta.data || novaHoraSql !== originalConsulta.hora);
        const veterinarioMudou = veterinarioId && novoVeterinarioId !== originalConsulta.veterinarioid;
        const clinicaMudou = clinicaId && novaClinicaId !== originalConsulta.clinicaid;

        // se o veterinario mudou, verificar se pertence a nova clinica
        if (veterinarioMudou || clinicaMudou) {
            const veterinarioCheck = await pool.query(
                'SELECT id FROM veterinarios WHERE id = $1 AND clinicaId = $2',
                [novoVeterinarioId, novaClinicaId]
            );

            if (veterinarioCheck.rows.length === 0) {
                return res.status(400).json({
                    error: 'veterinario nao encontrado ou nao pertence a clinica selecionada'
                });
            }
        }

        // se o horario ou o veterinario mudaram, verificar conflitos
        if (dataMudou || veterinarioMudou) {
            const conflitoQuery = await pool.query(
                `SELECT id FROM consultas 
                 WHERE veterinarioId = $1 
                 AND data = $2 
                 AND hora = $3 
                 AND estado != 'cancelada' 
                 AND id != $4`,
                [novoVeterinarioId, novaDataSql, novaHoraSql, id]
            );

            if (conflitoQuery.rows.length > 0) {
                return res.status(409).json({ 
                    error: 'horario indisponivel para este veterinario' 
                });
            }
        }

        // 4. executar a atualizacao
        await pool.query(
            `UPDATE consultas SET
                motivo = $1,
                data = $2,
                hora = $3,
                clinicaId = $4,
                veterinarioId = $5,
                observacoes = $6
             WHERE id = $7`,
            [novoMotivo, novaDataSql, novaHoraSql, novaClinicaId, novoVeterinarioId, novasObservacoes, id]
        );

        // 5. devolver a consulta completa e atualizada
        const finalResult = await pool.query(`
            SELECT c.*, 
                   cli.nome as clinicanome, 
                   vet.nome as veterinarionome, 
                   a.nome as animalnome,
                   a.especie as animalespecie
            FROM consultas c
            JOIN clinicas cli ON c.clinicaId = cli.id
            JOIN veterinarios vet ON c.veterinarioId = vet.id
            LEFT JOIN animais a ON c.animalId = a.id
            WHERE c.id = $1
        `, [id]);

        console.log(`consulta ${id} atualizada pelo utilizador ${userId}`);

        res.status(200).json({
            success: true,
            message: 'consulta atualizada com sucesso',
            consulta: finalResult.rows[0]
        });

    } catch (error) {
        console.error('erro ao atualizar consulta:', error);
        res.status(500).json({ 
            error: 'erro no servidor',
            details: error.message 
        });
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

// POST /vacinas/agendar -> agenda nova vacina (compativel)
app.post('/vacinas/agendar', authenticateToken, async (req, res) => {
    try {
        const { animalId, tipo_vacina_id, data_agendada, clinicaId, veterinarioId, observacoes } = req.body;
        const userId = req.user.id;

        // validacao dos campos obrigatorios
        if (!animalId || !tipo_vacina_id || !data_agendada) {
            return res.status(400).json({
                error: 'animalId, tipo_vacina_id e data_agendada sao obrigatorios'
            });
        }

        // verifica se o animal pertence ao utilizador
        const animalCheck = await pool.query(
            'SELECT id, nome, especie, dataNascimento FROM animais WHERE id = $1 AND tutorId = $2',
            [animalId, userId]
        );

        if (animalCheck.rows.length === 0) {
            return res.status(404).json({ 
                error: 'animal nao encontrado ou nao pertence ao utilizador' 
            });
        }

        const animal = animalCheck.rows[0];

        // verifica se o tipo de vacina existe
        const tipoVacinaResult = await pool.query(
            'SELECT id, nome, descricao FROM tipos_vacina WHERE id = $1',
            [tipo_vacina_id]
        );

        if (tipoVacinaResult.rows.length === 0) {
            return res.status(404).json({ 
                error: 'tipo de vacina nao encontrado' 
            });
        }

        const tipoVacina = tipoVacinaResult.rows[0];

        // valida a data agendada
        const dataAgendadaObj = new Date(data_agendada);
        const hoje = new Date();

        if (isNaN(dataAgendadaObj.getTime())) {
            return res.status(400).json({
                error: 'formato de data invalido'
            });
        }

        if (dataAgendadaObj < hoje) {
            return res.status(400).json({
                error: 'a data agendada nao pode ser no passado'
            });
        }

        // se clinicaId foi fornecido, verifica se existe
        if (clinicaId) {
            const clinicaCheck = await pool.query(
                'SELECT id, nome FROM clinicas WHERE id = $1',
                [clinicaId]
            );
            if (clinicaCheck.rows.length === 0) {
                return res.status(404).json({ 
                    error: 'clinica nao encontrada' 
                });
            }
        }

        // se veterinarioId foi fornecido, verifica se existe
        if (veterinarioId) {
            const vetCheck = await pool.query(
                'SELECT id, nome FROM veterinarios WHERE id = $1',
                [veterinarioId]
            );
            if (vetCheck.rows.length === 0) {
                return res.status(404).json({ 
                    error: 'veterinario nao encontrado' 
                });
            }
        }

        // insere a vacina agendada
        const result = await pool.query(
            `INSERT INTO vacinas 
             (animalId, tipo, tipo_vacina_id, data_agendada, clinicaId, veterinarioId, observacoes, estado, notificado)
             VALUES($1, $2, $3, $4, $5, $6, $7, 'agendada', false)
             RETURNING *`,
            [animalId, tipoVacina.nome, tipo_vacina_id, data_agendada, clinicaId, veterinarioId, observacoes]
        );

        const vacinaAgendada = result.rows[0];

        // log da operacao
        console.log(`vacina agendada - id: ${vacinaAgendada.id}, animal: ${animal.nome}, data: ${data_agendada}`);

        // devolve a resposta completa que a app espera
        res.status(201).json({
            success: true,
            message: 'vacina agendada com sucesso',
            vacina: vacinaAgendada,
            animal: {
                id: animal.id,
                nome: animal.nome,
                especie: animal.especie
            },
            tipo_vacina: {
                id: tipoVacina.id,
                nome: tipoVacina.nome,
                descricao: tipoVacina.descricao
            }
        });

    } catch (error) {
        console.error('erro ao agendar vacina:', error);
        res.status(500).json({ 
            error: 'erro no servidor',
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
        UPDATE vacinas SET tipo_vacina_id = COALESCE($1, tipo_vacina_id),
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

// post /vacinas/:id/realizada -> marca vacina como realizada
app.post('/vacinas/:id/realizada', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        // obtem os dados do body conforme enviado pela app
        const { dataAplicacao, lote, veterinarioId, observacoes } = req.body;
        const userId = req.user.id;

        // verificar se a vacina existe e pertence ao utilizador
        const vacinaCheck = await pool.query(`
            SELECT v.*, a.tutorId, a.nome as animal_nome 
            FROM vacinas v 
            JOIN animais a ON v.animalId = a.id 
            WHERE v.id = $1
        `, [parseInt(id)]);

        if (vacinaCheck.rows.length === 0) {
            return res.status(404).json({ 
                error: 'vacina nao encontrada' 
            });
        }

        const vacina = vacinaCheck.rows[0];

        // verificacao de permissao - apenas o tutor pode marcar como realizada
        if (vacina.tutorid !== userId) {
            console.log(`tentativa nao autorizada: user ${userId} tentou marcar vacina ${id} do user ${vacina.tutorid}`);
            return res.status(403).json({ 
                error: 'nao autorizado' 
            });
        }

        // verificar se a vacina ja foi realizada
        if (vacina.estado === 'realizada') {
            return res.status(400).json({
                error: 'vacina ja foi marcada como realizada anteriormente'
            });
        }

        // validar a data de aplicacao se for fornecida
        let dataAplicacaoSql = dataAplicacao;
        if (dataAplicacao) {
            const dataObj = new Date(dataAplicacao);
            if (isNaN(dataObj.getTime())) {
                return res.status(400).json({
                    error: 'formato de data de aplicacao invalido'
                });
            }
        }

        // se veterinarioId foi fornecido, verificar se existe
        if (veterinarioId) {
            const vetCheck = await pool.query(
                'SELECT id, nome FROM veterinarios WHERE id = $1',
                [veterinarioId]
            );
            if (vetCheck.rows.length === 0) {
                return res.status(404).json({
                    error: 'veterinario nao encontrado'
                });
            }
        }

        // preparar as observacoes, adicionando o lote se ele existir
        let observacoesFinais = observacoes || vacina.observacoes || '';
        
        if (lote) {
            // adiciona informacao do lote as observacoes
            const prefixo = observacoesFinais ? '\n' : '';
            observacoesFinais = `lote: ${lote}${prefixo}${observacoesFinais}`;
        }

        // query corrigida com os parametros corretos
        const result = await pool.query(`
            UPDATE vacinas 
            SET estado = 'realizada',
                dataAplicacao = COALESCE($1, CURRENT_DATE),
                veterinarioId = COALESCE($2, veterinarioId),
                observacoes = $3
            WHERE id = $4
            RETURNING *`,
            // parametros na ordem correta
            [
                dataAplicacaoSql,     // $1 - dataAplicacao
                veterinarioId,        // $2 - veterinarioId
                observacoesFinais,    // $3 - observacoes
                parseInt(id)          // $4 - id
            ]
        );

        const vacinaAtualizada = result.rows[0];

        console.log(`vacina ${id} marcada como realizada - animal: ${vacina.animal_nome}, user: ${userId}`);

        // devolver a vacina atualizada
        res.status(200).json({
            success: true,
            mensagem: 'vacina marcada como realizada com sucesso',
            vacina: vacinaAtualizada
        });

    } catch (error) {
        console.error('erro ao marcar vacina como realizada:', error);
        res.status(500).json({ 
            error: 'erro no servidor', 
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

        // validacao basica
        if (!dataExame) {
            return res.status(400).json({
                error: 'dataExame e obrigatoria'
            });
        }

        // verifica se o exame existe e pertence ao utilizador
        const exameCheck = await pool.query(`
            SELECT e.*, a.tutorId 
            FROM exames e
            JOIN animais a ON e.animalId = a.id
            WHERE e.id = $1
        `, [parseInt(id)]);

        if (exameCheck.rows.length === 0) {
            return res.status(404).json({
                error: 'exame nao encontrado'
            });
        }

        const exame = exameCheck.rows[0];

        // verifica permissoes
        if (exame.tutorid !== userId) {
            console.log(`tentativa nao autorizada: user ${userId} tentou editar exame ${id} do user ${exame.tutorid}`);
            return res.status(403).json({
                error: 'nao autorizado a editar este exame'
            });
        }

        // verifica se o tipo de exame existe (se foi fornecido)
        let tipoNome = exame.tipo_exame_id;
        if (tipo_exame_id) {
            const tipoCheck = await pool.query(
                'SELECT nome FROM tipos_exame WHERE id = $1',
                [tipo_exame_id]
            );
            if (tipoCheck.rows.length === 0) {
                return res.status(400).json({
                    error: 'tipo de exame nao encontrado'
                });
            }
            tipoNome = tipoCheck.rows[0].nome;
        }

        // verifica se clinica existe (se foi fornecida)
        if (clinicaId) {
            const clinicaCheck = await pool.query(
                'SELECT nome FROM clinicas WHERE id = $1',
                [clinicaId]
            );
            if (clinicaCheck.rows.length === 0) {
                return res.status(400).json({
                    error: 'clinica nao encontrada'
                });
            }
        }

        // verifica se veterinario existe (se foi fornecido)
        if (veterinarioId) {
            const clinicaIdToCheck = clinicaId || exame.clinicaid;
            const vetCheck = await pool.query(
                'SELECT nome FROM veterinarios WHERE id = $1 AND clinicaId = $2',
                [veterinarioId, clinicaIdToCheck]
            );
            if (vetCheck.rows.length === 0) {
                return res.status(400).json({
                    error: 'veterinario nao encontrado ou nao pertence a esta clinica'
                });
            }
        }

        // valida a data do exame
        const dataExameObj = new Date(dataExame);
        if (isNaN(dataExameObj.getTime())) {
            return res.status(400).json({
                error: 'formato de data invalido'
            });
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

        // mapeamento para o formato que a app espera
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

        console.log(`exame ${id} atualizado por utilizador ${userId}`);

        // CORRECAO: enviar o objeto mapeado
        res.status(200).json({
            success: true,
            message: 'exame atualizado com sucesso',
            exame: exameResponse
        });

    } catch (error) {
        console.error('erro ao atualizar exame:', error);
        res.status(500).json({
            error: 'erro no servidor',
            details: error.message
        });
    }
});

// GET /animais/:animalId/exames -> obtem exames de um animal 
app.get('/animais/:animalId/exames', authenticateToken, async (req, res) => {
    try {
        const { animalId } = req.params;
        const userId = req.user.id;

        // verifica permissoes - o animal pertence ao utilizador
        const animalCheck = await pool.query(
            'SELECT id, nome FROM animais WHERE id = $1 AND tutorId = $2',
            [animalId, userId]
        );
        
        if (animalCheck.rows.length === 0) {
            return res.status(403).json({ 
                error: 'nao autorizado ou animal nao encontrado' 
            });
        }

        // query para obter exames com todos os dados relacionados
        const result = await pool.query(`
            SELECT 
                e.id,
                e.animalid,
                e.tipo_exame_id,
                e.dataexame,
                e.clinicaid,
                e.veterinarioid,
                e.resultado,
                e.observacoes,
                e.fotourl,
                e.dataregisto,
                te.nome as tipo_nome,
                te.descricao as tipo_descricao,
                c.nome as clinicanome,
                v.nome as veterinarionome
            FROM exames e
            LEFT JOIN tipos_exame te ON e.tipo_exame_id = te.id
            LEFT JOIN clinicas c ON e.clinicaId = c.id
            LEFT JOIN veterinarios v ON e.veterinarioId = v.id
            WHERE e.animalId = $1
            ORDER BY e.dataExame DESC, e.dataregisto DESC
        `, [animalId]);

        // mapeamento para o formato que a app espera
        const examesFormatados = result.rows.map(exame => ({
            id: exame.id,
            animalid: exame.animalid,
            tipo_exame_id: exame.tipo_exame_id,
            tipo_nome: exame.tipo_nome,
            tipo_descricao: exame.tipo_descricao,
            dataexame: exame.dataexame,
            clinicaid: exame.clinicaid,
            clinicanome: exame.clinicanome,
            veterinarioid: exame.veterinarioid,
            veterinarionome: exame.veterinarionome,
            resultado: exame.resultado,
            observacoes: exame.observacoes,
            fotourl: exame.fotourl,
            dataregisto: exame.dataregisto
        }));

        console.log(`utilizador ${userId} acedeu a ${examesFormatados.length} exames do animal ${animalId}`);

        // CORRECAO: enviar o array mapeado
        res.status(200).json({
            success: true,
            exames: examesFormatados,
            count: examesFormatados.length
        });

    } catch (error) {
        console.error('erro ao obter exames:', error);
        res.status(500).json({ 
            error: 'erro no servidor',
            details: error.message 
        });
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
        const [usersCount, animaisCount, consultasCount, vacinasCount, examesCount] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM users'),
            pool.query('SELECT COUNT(*) FROM animais'),
            pool.query('SELECT COUNT(*) FROM consultas'),
            pool.query('SELECT COUNT(*) FROM vacinas'),
            pool.query('SELECT COUNT(*) FROM exames')
        ]);

        res.json({
            api_status: 'online',
            message: 'API VetConnect esta a funcionar',
            database: 'PostgreSQL conectada',

            stats: {
                utilizadores: parseInt(usersCount.rows[0].count),
                animais: parseInt(animaisCount.rows[0].count),
                consultas: parseInt(consultasCount.rows[0].count),
                vacinas: parseInt(vacinasCount.rows[0].count),
                exames: parseInt(examesCount.rows[0].count)
            },

            endpoints: {
                auth: {
                    criar: 'POST /utilizadores',
                    verificar: 'POST /utilizadores/verificar',
                    criar_pin: 'POST /utilizadores/criar-pin',
                    login: 'POST /utilizadores/login',
                    alterar_pin: 'POST /utilizadores/alterar-pin',
                    logout: 'POST /utilizadores/logout'
                },
                utilizadores: {
                    listar: 'GET /utilizadores',
                    obter: 'GET /utilizadores/:id',
                    atualizar: 'PUT /utilizadores/:id'
                },
                animais: {
                    criar: 'POST /animais',
                    listar_do_tutor: 'GET /utilizadores/:userId/animais',
                    obter: 'GET /animais/:animalId',
                    atualizar: 'PUT /animais/:id',
                    upload_foto: 'POST /animais/:animalId/foto'
                },
                clinicas: {
                    listar: 'GET /clinicas'
                },
                veterinarios: {
                    listar: 'GET /veterinarios',
                    listar_por_clinica: 'GET /clinicas/:clinicaId/veterinarios'
                },
                consultas: {
                    marcar: 'POST /consultas',
                    listar_do_utilizador: 'GET /consultas/user/:userId',
                    atualizar: 'PUT /consultas/:id',
                    cancelar: 'DELETE /consultas/:id'
                },
                vacinas: {
                    tipos: 'GET /vacinas/tipos',
                    listar: 'GET /vacinas',
                    proximas: 'GET /vacinas/proximas',
                    agendar: 'POST /vacinas/agendar',
                    atualizar: 'PUT /vacinas/:id',
                    cancelar: 'DELETE /vacinas/:id',
                    marcar_realizada: 'POST /vacinas/:id/realizada',
                    listar_agendadas_animal: 'GET /animais/:animalId/vacinas/agendadas'
                },
                exames: {
                    tipos: 'GET /exames/tipos',
                    criar: 'POST /exames',
                    listar_do_animal: 'GET /animais/:animalId/exames',
                    atualizar: 'PUT /exames/:id',
                    apagar: 'DELETE /exames/:id',
                    upload_foto: 'POST /exames/:id/foto'
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