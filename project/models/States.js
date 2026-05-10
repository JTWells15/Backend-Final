const mongoose = require('mongoose');

const stateSchema = new mongoose.Schema({
  stateCode: {
    type: String,
    required: true,
    unique: true
  },
  funfacts: [{
    type: String
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('State', stateSchema);