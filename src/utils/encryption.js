// src/utils/encryption.js
import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'your-secret-key-min-32-characters-long';

// ============ ENCRYPT ============
const encrypt = (text) => {
  if (!text) return '';
  try {
    return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
  } catch (error) {
    console.error('Encryption error:', error);
    return text;
  }
};

// ============ DECRYPT ============
const decrypt = (ciphertext) => {
  if (!ciphertext) return '';
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error('Decryption error:', error);
    return ciphertext;
  }
};

export { encrypt, decrypt };