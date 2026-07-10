// src/utils/generateToken.js
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// ✅ Sirf yeh rakho
const generateVerificationCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

export { generateVerificationCode };