const express = require('express');
const cors = require('cors');
const app = express();

const PORT = process.env.PORT || 3000;

// Configuração CORS para permitir Android
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// ✅ Rota de Health Check (OBRIGATÓRIA para Render)
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'VetConnect API está funcionando! 🐾',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// 📍 Dados de exemplo (depois substitui por banco de dados)
let usuarios = [
    { 
        id: 1, 
        nome: "Dr. João Silva", 
        email: "joao@vetconnect.com", 
        tipo: "veterinario",
        especialidade: "Cirurgia"
    },
    { 
        id: 2, 
        nome: "Maria Santos", 
        email: "maria@cliente.com", 
        tipo: "cliente",
        pets: ["Rex", "Mimi"]
    }
];

// 🐕 Rotas para Usuários
app.get('/api/usuarios', (req, res) => {
    console.log('📦 Listando usuários...');
    res.json(usuarios);
});

app.get('/api/usuarios/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const usuario = usuarios.find(u => u.id === id);
    
    if (!usuario) {
        return res.status(404).json({ erro: "Usuário não encontrado" });
    }
    
    res.json(usuario);
});

app.post('/api/usuarios', (req, res) => {
    const { nome, email, tipo, especialidade, pets } = req.body;
    
    if (!nome || !email) {
        return res.status(400).json({ erro: "Nome e email são obrigatórios" });
    }
    
    const novoUsuario = {
        id: usuarios.length + 1,
        nome,
        email,
        tipo: tipo || "cliente",
        especialidade,
        pets: pets || []
    };
    
    usuarios.push(novoUsuario);
    console.log('✅ Usuário criado:', novoUsuario);
    res.status(201).json(novoUsuario);
});

// 🏥 Rotas para Veterinários (exemplo)
app.get('/api/veterinarios', (req, res) => {
    const veterinarios = usuarios.filter(u => u.tipo === "veterinario");
    res.json(veterinarios);
});

// 🚀 Iniciar servidor
app.listen(PORT, () => {
    console.log(`===================================`);
    console.log(`🚀 VetConnect API INICIADA!`);
    console.log(`📍 Porta: ${PORT}`);
    console.log(`🌐 Health: http://localhost:${PORT}/health`);
    console.log(`🐾 Pronta para o app Android!`);
    console.log(`===================================`);
});