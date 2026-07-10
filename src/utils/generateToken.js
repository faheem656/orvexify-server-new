// src/utils/generateToken.js
const jwt = require('jsonwebtoken');
require('dotenv').config();

// ❌ REMOVE this function — conflict create kar raha hai
// const generateToken = (userId, email) => { ... }

// ✅ Sirf yeh rakho
const generateVerificationCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

module.exports = { generateVerificationCode };