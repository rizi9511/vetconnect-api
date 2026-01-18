const express = require('express'); //Framework web para Node.js
const cors = require('cors'); //Middleware para permitir CORS
const bcrypt = require('bcryptjs'); //Biblioteca para hashing de passwords/PINs
const jwt = require('jsonwebtoken'); //Biblioteca para criação e verificação de JSON Web Tokens
const { Pool } = require('pg'); //Cliente PostgreSQL para Node.js

const app = express(); //Criar aplicação Express

// Middleware
app.use(cors()); // Permitir requisições de diferentes origens (CORS)
app.use(express.json()); // Converte JSON do corpo das requisições para objetos JavaScript



// Configuração PostgreSQL para Render==============================================

// Verificar se está a correr no Render
const isRender = process.env.RENDER === 'true';

// Criar pool de conexões com PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // URL da BD das variáveis de ambiente do Render
    ssl: isRender ? { rejectUnauthorized: false } : false // SSL só no Render
});

// Testar conexão e inicializar BD
async function initDatabase() {
    try {
        // Testar conexão
        await pool.query('SELECT NOW()');
        console.log('Conectado à base de dados PostgreSQL');

        // Criar tabela se não existir
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
        // Contar utilizadores na BD
        const result = await pool.query('SELECT COUNT(*) FROM users');
        console.log(`Total de utilizadores na BD: ${result.rows[0].count}`);

    } catch (err) {
        console.error('Erro ao inicializar a base de dados:', err.message);
        console.error('Verificar a conexão com a base de dados');
    }
}

// Inicializar BD quando o servidor começa
initDatabase();



// Rotas de utilizador==============================================

// POST /usuarios -> Criar um novo utilizador
app.post('/usuarios', async (req, res) => {
    try {
        const { nome, email, telemovel, tipo } = req.body;

        // Validar campos obrigatórios
        if (!nome || !email || !telemovel || !tipo) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        // validar o número de telemóvel 
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

        // Se existir, retornar erro
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Utilizador com este email já existe' });
        }

        // verificar se o número de telemóvel já existe
        const existingPhone = await pool.query(
            'SELECT * FROM users WHERE telemovel = $1',
            [telemovel]
        );

        // Se existir, retornar erro
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

        // Na consola mostra o código de verificação que funciona como um SMS simulado
        console.log(`Utilizador ${nome} criado. Código: ${verificationCode}`);

        // Responder com os dados do utilizador (sem o código de verificação)
        const userResponse = {
            id: result.rows[0].id,
            nome,
            email,
            telemovel,
            tipo,
            dataRegisto: result.rows[0].dataregisto || new Date(),
            verificado: false
        };

        // Retorna resposta
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


// Rota para verificar o código
app.post('/usuarios/verificar', async (req, res) => {
    try {
        const { email, codigoVerificacao } = req.body;

        if (!email || !codigoVerificacao) {
            return res.status(400).json({ message: 'Email e código são obrigatórios' });
        }

        // Procurar utilziador pelo email
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        // Se não encontrar, retorna erro
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Utilizador não encontrado' });
        }

        // Identifica o user
        const user = result.rows[0];

        // Compara o código inserido com o armazenado
        if (user.codigoverificacao !== codigoVerificacao) {
            return res.status(400).json({ message: 'Código de verificação inválido' });
        }

        // Atualiza o utilizador para verificado e remove o código
        await pool.query(
            'UPDATE users SET codigoVerificacao = NULL, verificado = true WHERE email = $1',
            [email]
        );

        // Resposta de sucesso
        console.log(`Utilizador ${user.nome} verificado com sucesso.`);
        res.status(200).json({ message: 'Verificação bem-sucedida' });

    } catch (error) {
        console.error('Erro na verificação:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});


// Rota para criar o PIN
app.post('/usuarios/criar-pin', async (req, res) => {
    try {
        const { email, pin } = req.body;

        if (!email || !pin) {
            return res.status(400).json({ message: 'Email e PIN são obrigatórios' });
        }
        if (String(pin).length !== 6) {
            return res.status(400).json({ message: 'O PIN deve ter 6 dígitos' });
        }

        // Procurar utilizador pelo email
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        // Se não encontrar, retorna erro
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Utilizador não encontrado' });
        }

        const user = result.rows[0];

        // Hash do PIN antes de armazenar
        const salt = await bcrypt.genSalt(10); // Gerar salt
        const hashedPin = await bcrypt.hash(String(pin), salt); // Hash do PIN

        // Atualizar o PIN do utilizador na BD
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

// Rota de Login
app.post('/usuarios/login', async (req, res) => {
    try {
        const { email, pin } = req.body;

        if (!email || !pin) {
            return res.status(400).json({ message: 'Email e PIN são obrigatórios' });
        }

        // Procurar utilizador pelo email
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        // Se não encontrar ou não tiver PIN, retorna erro
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

// GET /usuarios -> Obter todos os utilizadores
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

// GET /usuarios/:id -> Obter um utilizador específico
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

// PUT /usuarios/:id -> Atualizar um utilizador
app.put('/usuarios/:id', async (req, res) => {
    try {
        const { id } = req.params; // Obter ID dos parâmetros da rota
        const { nome, email, tipo } = req.body; // Obter dados do corpo da requisição

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

// DELETE /usuarios/:id -> Eliminar um utilizador
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



// Rota para Marcar Consulta==============================================

async function setupConsultaTables() {
    try {
        // cria as tabelas se não existirem (clinicas, veterinarios e consultas)
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

        // verifica se já existem clínicas para não inserir dados duplicados
        const clinicasExistentes = await pool.query('SELECT COUNT(*) FROM clinicas'); // conta clínicas existentes
        if (parseInt(clinicasExistentes.rows[0].count) === 0) { // converte para inteiro e verifica se é 0
            console.log('Base de dados de consultas vazia. A inserir dados de exemplo...');

            // inserir clínicas de exemplo
            await pool.query(`
                INSERT INTO clinicas (nome) VALUES 
                ('Animal Clinic'), 
                ('Bichomix - Hospital Veterinário'), 
                ('Hospital Veterinário de Lisboa'),
                ('Centro Veterinário de Tomar'),
                ('VetLuz'),
                ('Hospital Veterinário de Alfragide')
            `);

            // insere veterinários de exemplo ligados às clínicas pelo ID
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
            console.log('Dados de exemplo para consultas inseridos com sucesso.');
        }

    } catch (err) {
        console.error('Erro ao configurar tabelas de consulta:', err.message);
    }
}

// inicialização das tabelas
initDatabase()
    .then(() => {
        return setupConsultaTables();
    })
    .then(() => {
        console.log('Todas as tabelas inicializadas com sucesso.');
    })
    .catch(err => {
        console.error('Erro na inicialização:', err);
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

// POST /consultas -> marcar nova consulta
app.post('/consultas', async (req, res) => {
    try {
        const { userId, animalId, clinicaId, veterinarioId, data, hora, motivo } = req.body;

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
        if (!userId || !clinicaId || !veterinarioId || !data || !hora) {
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

// GET /consultas/:userId -> consultas de um utilizador
app.get('/consultas/user/:userId', async (req, res) => {
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

// DELETE /consultas/:id -> cancelar uma consulta
app.delete('/consultas/:id', async (req, res) => {
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



// Rota principal e diagnóstico==============================================

app.get('/', async (req, res) => {
    try {
        // testa BD primeiro
        await pool.query('SELECT 1');

        // conta users
        const dbResult = await pool.query('SELECT COUNT(*) as total FROM users'); 
        const totalUsers = parseInt(dbResult.rows[0].total);

        // conta clinicas
        const clinicasResult = await pool.query('SELECT COUNT(*) as total FROM clinicas');
        const consultasResult = await pool.query('SELECT COUNT(*) as total FROM consultas');

        // conta consultas
        const totalClinicas = parseInt(clinicasResult.rows[0].total);
        const totalConsultas = parseInt(consultasResult.rows[0].total);

        res.json({
            // status da API
            api_status: 'online',
            message: 'API VetConnect está a funcionar',

            // informação do sistema
            ambiente: isRender ? 'PRODUÇÃO (Render + PostgreSQL)' : 'DESENVOLVIMENTO',
            database: 'PostgreSQL conectada',
            total_utilizadores: totalUsers,

            // Endpoints disponíveis
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
                consultas: {
                    clinicas: 'GET /clinicas',
                    veterinarios: 'GET /veterinarios',
                    veterinarios_clinica: 'GET /clinicas/:clinicaId/veterinarios',
                    marcar_consulta: 'POST /consultas',
                    consultas_utilizador: 'GET /consultas/user/:userId',
                    cancelar_consulta: 'DELETE /consultas/:id'
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
            suggestion: 'Verificar a conexão com a base de dados'
        });
    }
});



// Inicialização do servidor==============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor VetConnect na porta ${PORT}`);
    console.log(`Database: PostgreSQL ${isRender ? '(Render)' : '(Local)'}`);
    console.log(`Iniciado: ${new Date().toISOString()}`);
});

// Cleanup do servidor==============================================
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