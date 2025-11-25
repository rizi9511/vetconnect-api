// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    tipo: { type: String, enum: ['tutor', 'veterinario'], required: true },
    telefone: String,
    morada: String,
    dataRegisto: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);