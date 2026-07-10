// src/config/email.js
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const sendEmail = async (to, subject, html) => {
    try {
        const info = await transporter.sendMail({
            from: `"Orvexify" <${process.env.EMAIL_FROM}>`,
            to,
            subject,
            html,
        });
        console.log('Email sent:', info.messageId);
        return { success: true, info };
    } catch (error) {
        console.error('Email error:', error);
        return { success: false, error: error.message };
    }
};

export { sendEmail };