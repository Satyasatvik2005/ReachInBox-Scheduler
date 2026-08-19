import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: Number(process.env.SMTP_PORT) || 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false
  }
});

export const sendEmail = async (to: string, subject: string, body: string) => {
  const info = await transporter.sendMail({
    from: `"ReachInbox Test" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text: body,
  });
  console.log('Message sent: %s', info.messageId);
  return info;
};
