const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Health Check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'API funcionando',
        timestamp: new Date().toISOString()
    });
});

// Dados exemplo
let usuarios = [];

// Rotas
app.get('/api/usuarios', (req, res) => {
    res.json(usuarios);
});

app.post('/api/usuarios', (req, res) => {
    const { nome, email } = req.body;
    
    if (!nome || !email) {
        return res.status(400).json({ erro: "Dados incompletos" });
    }
    
    const novoUsuario = {
        id: usuarios.length + 1,
        nome,
        email
    };
    
    usuarios.push(novoUsuario);
    res.status(201).json(novoUsuario);
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});