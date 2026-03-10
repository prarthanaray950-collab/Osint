const nodemailer = require('nodemailer');

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Try multiple transport configs in order — Render blocks some ports but not all
function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_PASS;

  if (!user || !pass) {
    throw new Error('GMAIL_USER and GMAIL_PASS must be set in .env');
  }

  // Port 465 (SSL) — most likely to work on Render
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // SSL
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout:   8000,
    socketTimeout:     10000,
  });
}

// Try port 465 first, fall back to 587 if it fails
async function sendWithFallback(mailOptions) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_PASS;

  const configs = [
    // Port 465 - SSL
    { host: 'smtp.gmail.com', port: 465, secure: true,  auth: { user, pass }, connectionTimeout: 10000, socketTimeout: 10000 },
    // Port 587 - STARTTLS
    { host: 'smtp.gmail.com', port: 587, secure: false, auth: { user, pass }, connectionTimeout: 10000, socketTimeout: 10000,
      tls: { rejectUnauthorized: false } },
    // Port 2525 - some hosts allow this as alternative
    { host: 'smtp.gmail.com', port: 2525, secure: false, auth: { user, pass }, connectionTimeout: 10000, socketTimeout: 10000,
      tls: { rejectUnauthorized: false } },
  ];

  let lastError;
  for (const config of configs) {
    try {
      console.log(`[Email] Trying SMTP port ${config.port}...`);
      const transporter = nodemailer.createTransport(config);
      const result = await Promise.race([
        transporter.sendMail(mailOptions),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Port ${config.port} timed out`)), 12000)
        ),
      ]);
      console.log(`[Email] Sent successfully via port ${config.port}`);
      return result;
    } catch (err) {
      console.error(`[Email] Port ${config.port} failed:`, err.message);
      lastError = err;
    }
  }

  throw new Error(`All SMTP ports failed. Last error: ${lastError.message}\n` +
    'Your host likely blocks outbound SMTP. Consider using Resend.com (free, no config needed).');
}

const sendOTPEmail = async (email, otp, name = 'User') => {
  const html = `
  <!DOCTYPE html>
  <html>
  <head><meta charset="UTF-8"/></head>
  <body style="margin:0;padding:0;background:#f4f4f0;font-family:'Segoe UI',Arial,sans-serif">
    <div style="max-width:520px;margin:40px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
      <div style="background:linear-gradient(135deg,#0F172A,#1E3A5F);padding:36px 32px;text-align:center">
        <div style="font-size:1.6rem;font-weight:700;color:white;letter-spacing:2px">INTELGRID</div>
        <div style="font-size:0.75rem;color:rgba(255,255,255,0.5);letter-spacing:3px;margin-top:4px">OSINT INTELLIGENCE PLATFORM</div>
      </div>
      <div style="padding:40px 32px">
        <p style="color:#374151;font-size:0.95rem;margin:0 0 8px">Hello <strong>${name}</strong>,</p>
        <p style="color:#6B7280;font-size:0.875rem;line-height:1.7;margin:0 0 28px">Your email verification code for IntelGrid is:</p>
        <div style="background:#F8FAFC;border:2px dashed #CBD5E1;border-radius:10px;padding:24px;text-align:center;margin-bottom:28px">
          <div style="font-size:2.4rem;font-weight:700;letter-spacing:10px;color:#0F172A;font-family:monospace">${otp}</div>
          <div style="font-size:0.75rem;color:#9CA3AF;margin-top:8px">Valid for 10 minutes</div>
        </div>
        <p style="color:#9CA3AF;font-size:0.78rem;line-height:1.6;margin:0">
          If you did not request this, ignore this email. Do not share this OTP with anyone.
        </p>
      </div>
      <div style="background:#F8FAFC;padding:20px 32px;border-top:1px solid #E5E7EB;text-align:center">
        <p style="color:#9CA3AF;font-size:0.72rem;margin:0">© 2025 IntelGrid. For authorized use only.</p>
      </div>
    </div>
  </body>
  </html>`;

  await sendWithFallback({
    from:    `"IntelGrid" <${process.env.GMAIL_USER}>`,
    to:      email,
    subject: `${otp} — IntelGrid Verification Code`,
    html,
  });
};

const sendWelcomeEmail = async (email, name) => {
  const html = `
  <!DOCTYPE html>
  <html>
  <body style="margin:0;padding:0;background:#f4f4f0;font-family:'Segoe UI',Arial,sans-serif">
    <div style="max-width:520px;margin:40px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
      <div style="background:linear-gradient(135deg,#0F172A,#1E3A5F);padding:36px 32px;text-align:center">
        <div style="font-size:1.6rem;font-weight:700;color:white;letter-spacing:2px">INTELGRID</div>
      </div>
      <div style="padding:40px 32px">
        <h2 style="color:#0F172A;font-size:1.3rem;margin:0 0 16px">Welcome to IntelGrid, ${name}!</h2>
        <p style="color:#6B7280;font-size:0.875rem;line-height:1.7;margin:0 0 20px">
          Your account is now active. You have been credited with <strong>5 free search credits</strong> to get started.
        </p>
        <div style="background:#F0F9FF;border-left:4px solid #0284C7;padding:14px 16px;border-radius:0 8px 8px 0;margin-bottom:24px">
          <p style="margin:0;font-size:0.845rem;color:#0C4A6E">
            <strong>Remember:</strong> IntelGrid is for authorized intelligence gathering only.
            Misuse will result in permanent account suspension.
          </p>
        </div>
        <a href="${process.env.BASE_URL}/dashboard.html"
           style="display:inline-block;background:#0F172A;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:0.875rem;font-weight:500">
          Go to Dashboard →
        </a>
      </div>
    </div>
  </body>
  </html>`;

  await sendWithFallback({
    from:    `"IntelGrid" <${process.env.GMAIL_USER}>`,
    to:      email,
    subject: 'Welcome to IntelGrid — Account Activated',
    html,
  });
};

module.exports = { generateOTP, sendOTPEmail, sendWelcomeEmail };
