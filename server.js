const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Dados em memória
let users = [];
let veterinarios = [];
let nextUserId = 1;

// ----------------------------------------------------------------
// INÍCIO - Rotas CRUD para /usuarios (para corresponder ao Android)
// ----------------------------------------------------------------

// GET /usuarios -> Obter todos os utilizadores
app.get('/usuarios', (req, res) => {
    // Exclui a password da resposta por segurança
    const usersWithoutPassword = users.map(u => {
        const { password, ...user } = u;
        return user;
    });
    res.status(200).json(usersWithoutPassword);
});

// GET /usuarios/:id -> Obter um utilizador por ID
app.get('/usuarios/:id', (req, res) => {
    const userId = parseInt(req.params.id);
    const user = users.find(u => u.id === userId);

    if (!user) {
        return res.status(404).json({ error: 'Utilizador não encontrado' });
    }
    const { password, ...userResponse } = user;
    res.status(200).json(userResponse);
});
 
// POST /usuarios -> Criar um novo utilizador e gerar um código de verificação
app.post('/usuarios', async (req, res) => {
    try {
        const { nome, email, password, tipo } = req.body;

        if (!nome || !email || !password || !tipo) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        const userExists = users.find(u => u.email === email);
        if (userExists) {
            return res.status(400).json({ error: 'Utilizador com este email já existe' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Gera um código de verificação aleatório de 6 dígitos
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

        const newUser = {
            id: nextUserId++,
            nome,
            email,
            password: hashedPassword,
            tipo,
            dataRegisto: new Date(),
            // Importante: Na vida real, o utilizador só seria "ativo" após verificação
            verificado: false, 
            codigoVerificacao: verificationCode // Guarda o código com o utilizador
        };
        users.push(newUser);

        console.log(`✅ Utilizador ${email} criado. Código de verificação: ${verificationCode}`);

        // Remove dados sensíveis da resposta
        const { password: _, ...userResponse } = newUser; 

        // Devolve o utilizador E o código de verificação
        res.status(201).json({
            user: userResponse,
            message: "Utilizador criado, aguardando verificação."
        });

    } catch (error) {
        console.error('Erro ao criar utilizador:', error);
        res.status(500).json({ error: 'Erro no servidor ao criar utilizador' });
    }
});
    

// PUT /usuarios/:id -> Atualizar um utilizador
app.put('/usuarios/:id', (req, res) => {
    const userId = parseInt(req.params.id);
    const userIndex = users.findIndex(u => u.id === userId);

    if (userIndex === -1) {
        return res.status(404).json({ error: 'Utilizador não encontrado para atualizar' });
    }

    const { nome, email, tipo } = req.body;
    const originalUser = users[userIndex];

    // Mantém a password original e atualiza os outros campos
    const updatedUser = {
        ...originalUser,
        nome: nome || originalUser.nome,
        email: email || originalUser.email,
        tipo: tipo || originalUser.tipo
    };
    users[userIndex] = updatedUser;

    const { password, ...userResponse } = updatedUser;
    res.status(200).json(userResponse);
});

// DELETE /usuarios/:id -> Deletar um utilizador
app.delete('/usuarios/:id', (req, res) => {
    const userId = parseInt(req.params.id);
    const initialLength = users.length;
    users = users.filter(u => u.id !== userId);

    if (users.length === initialLength) {
        return res.status(404).json({ error: 'Utilizador não encontrado para deletar' });
    }

    res.status(204).send(); // Sucesso, sem conteúdo
});


// ----------------------------------------------------------------
// FIM - Rotas CRUD para /usuarios
// ----------------------------------------------------------------


// Rotas de Autenticação (Mantidas para uso futuro)
app.post('/api/auth/register', async (req, res) => { /* ...código original... */ });
app.post('/api/auth/login', async (req, res) => { /* ...código original... */ });

// Lista pública de veterinários
app.get('/api/veterinarios', (req, res) => {
    res.json(veterinarios);
});

// Rota de teste para a raiz, para confirmar que o servidor está online
app.get('/', (req, res) => {
    res.json({ 
        message: '🎉 A API VetConnect está a funcionar!',
        status: 'OK',
        teste_android: 'GET /usuarios'
    });
});


// =======================================================
// ROTA DE HISTÓRICO (para corresponder ao Android)
// =======================================================

// Dados em memória para o histórico (simples, para teste)
let historico = [
    { id: 1, data: "2024-05-19", descricao: "Consulta de rotina - dados do servidor" },
    { id: 2, data: "2024-04-10", descricao: "Vacinação anual - dados do servidor" },
    { id: 3, data: "2024-03-22", descricao: "Análises de sangue - dados do servidor" }
];

// GET /historico -> Devolve a lista de histórico
app.get('/historico', (req, res) => {
    console.log("✅ Pedido GET recebido com sucesso para /historico");
    res.status(200).json(historico);
});
    

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor VetConnect a correr em http://localhost:${PORT}`);
});
