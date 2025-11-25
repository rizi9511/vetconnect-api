// models/Consulta.js
const mongoose = require('mongoose');

const consultaSchema = new mongoose.Schema({
    animal: { type: mongoose.Schema.Types.ObjectId, ref: 'Animal', required: true },
    veterinario: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tutor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    dataConsulta: { type: Date, required: true },
    sintomas: String,
    diagnostico: String,
    tratamento: String,
    observacoes: String,
    estado: { type: String, enum: ['agendada', 'realizada', 'cancelada'], default: 'agendada' },
    dataCriacao: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Consulta', consultaSchema);