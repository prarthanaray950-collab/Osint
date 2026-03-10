// Mailjet — sends over HTTPS, works perfectly on Render free tier
const https = require('https');

const MAILJET_API_KEY    = process.env.MAILJET_API_KEY;
const MAILJET_SECRET_KEY = process.env.MAILJET_SECRET_KEY;
const FROM_EMAIL         = process.env.MAILJET_FROM_EMAIL || 'darkboxessupport@gmail.com';
const FROM_NAME          = process.env.MAILJET_FROM_NAME  || 'IntelGrid';

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

async function sendEmail(toEmail, toName, subject, html) {
  if (!MAILJET_API_KEY || !MAILJET_SECRET_KEY) {
    throw new Error('MAILJET_API_KEY and MAILJET_SECRET_KEY must be set in environment variables.');
  }

  const payload = JSON.stringify({
    Messages: [{
      From:     { Email: FROM_EMAIL, Name: FROM_NAME },
      To:       [{ Email: toEmail, Name: toName || toEmail }],
      Subject:  subject,
      HTMLPart: html,
    }]
  });

  const auth = Buffer.from(`${MAILJET_API_KEY}:${MAILJET_SECRET_KEY}`).toString('base64');

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.mailjet.com',
      path:     '/v3.1/send',
      method:   'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const parsed = JSON.parse(data);
          const status = parsed.Messages?.[0]?.Status;
          if (status === 'success') {
            resolve(parsed);
          } else {
            reject(new Error(`Mailjet rejected: ${JSON.stringify(parsed.Messages?.[0])}`));
          }
        } else {
          let msg = data;
          try { msg = JSON.parse(data)?.ErrorMessage || data; } catch {}
          reject(new Error(`Mailjet HTTP ${res.statusCode}: ${msg}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Mailjet request timed out')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
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

  await sendEmail(email, name, `${otp} — IntelGrid Verification Code`, html);
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
        <a href="${process.env.BASE_URL}/dashboard.html"
           style="display:inline-block;background:#0F172A;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:0.875rem;font-weight:500">
          Go to Dashboard →
        </a>
      </div>
    </div>
  </body>
  </html>`;

  await sendEmail(email, name, 'Welcome to IntelGrid — Account Activated', html);
};

module.exports = { generateOTP, sendOTPEmail, sendWelcomeEmail };
