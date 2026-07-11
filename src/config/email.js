// src/config/email.js
const nodemailer = require('nodemailer');
require('dotenv').config();

const sendEmail = async (to, subject, html) => {
    try {
        const port = parseInt(process.env.EMAIL_PORT) || 587;
        
        console.log('📧 Creating transporter:');
        console.log(`  - host: ${process.env.EMAIL_HOST}`);
        console.log(`  - port: ${port}`);
        console.log(`  - user: ${process.env.EMAIL_USER}`);

        const transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: port,
            secure: port === 465, // ✅ Port 465 = SSL, Port 587 = STARTTLS
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
            tls: {
                rejectUnauthorized: false,
                minVersion: 'TLSv1.2',
            },
            connectionTimeout: 30000,
            greetingTimeout: 30000,
        });

        await transporter.verify();
        console.log('✅ SMTP connection verified');

        const info = await transporter.sendMail({
            from: `"Orvexify" <${process.env.EMAIL_FROM}>`,
            to,
            subject,
            html,
        });
        console.log('✅ Email sent:', info.messageId);
        return { success: true, info };
    } catch (error) {
        console.error('❌ Email error:', error.message);
        if (error.code) console.error('  Code:', error.code);
        if (error.command) console.error('  Command:', error.command);
        return { success: false, error: error.message };
    }
};

module.exports = { sendEmail };