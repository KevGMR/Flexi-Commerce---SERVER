require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // use STARTTLS instead of SSL
  auth: {
    user: process.env.MAILER_ADDRESS,
    pass: process.env.MAILER_PASS,
  },
  tls: {
    rejectUnauthorized: true,
  },
  connectionTimeout: 10000,
  socketTimeout: 10000,
});

transporter.sendMail({
  from: `FLEXI-POS ${process.env.MAILER_ADDRESS}`,
  to: process.env.MAILER_ADDRESS, // Send to yourself
  subject: 'FLEXI-POS Email Test',
  html: '<h1>Success!</h1><p>Email configuration is working correctly.</p>',
}, (err, info) => {
  if (err) {
    console.error('❌ Email test failed:', err.message);
  } else {
    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
  }
});