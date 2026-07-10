// src/utils/hashPassword.js
import bcrypt from 'bcryptjs';

const hashPassword = async (password) => {
    return await bcrypt.hash(password, 10);
};

const comparePassword = async (password, hash) => {
    return await bcrypt.compare(password, hash);
};

export { hashPassword, comparePassword };