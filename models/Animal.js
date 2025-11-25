// models/Animal.js
const mongoose = require('mongoose');

const animalSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    especie: { type: String, required: true },
    raca: String,
    idade: Number,
    peso: Number,
    historicoMedico: String,
    foto: String,
    tutor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    dataRegisto: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Animal', animalSchema);