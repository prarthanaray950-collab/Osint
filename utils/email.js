// Run this directly in Render Shell:
//   node diagnose-email.js
//
// It checks env vars, DNS, port connectivity, and auth — 
// and tells you exactly what's broken.

require('dotenv').config();
const net = require('net');
const dns = require('dns').promises;

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;

async function checkPort(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs);
    sock.connect(port, host, () => { clearTimeout(timer); sock.destroy(); resolve(true); });
    sock.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

async function main() {
  console.log('\n====== IntelGrid Email Diagnostics ======\n');

  // 1. Env vars
  console.log('1. Environment variables:');
  if (!GMAIL_USER || GMAIL_USER.includes('YOUR_')) {
    console.log('   ❌ GMAIL_USER not set');
  } else {
    console.log(`   ✅ GMAIL_USER = ${GMAIL_USER}`);
  }
  if (!GMAIL_PASS || GMAIL_PASS.includes('YOUR_')) {
    console.log('   ❌ GMAIL_PASS not set');
  } else {
    const masked = GMAIL_PASS.slice(0, 4) + '************';
    console.log(`   ✅ GMAIL_PASS = ${masked} (length: ${GMAIL_PASS.length})`);
    if (GMAIL_PASS.length !== 16) {
      console.log(`   ⚠️  App passwords are exactly 16 chars. Yours is ${GMAIL_PASS.length}. Spaces don't matter but length should be 16.`);
    }
  }

  // 2. DNS
  console.log('\n2. DNS resolution for smtp.gmail.com:');
  try {
    const addrs = await dns.lookup('smtp.gmail.com');
    console.log(`   ✅ Resolved to ${addrs.address}`);
  } catch (e) {
    console.log(`   ❌ DNS failed: ${e.message}`);
    console.log('   → Your server cannot resolve hostnames. Check network settings.');
    process.exit(1);
  }

  // 3. Port connectivity
  console.log('\n3. SMTP port connectivity:');
  const ports = [465, 587, 25, 2525];
  const openPorts = [];
  for (const port of ports) {
    const open = await checkPort('smtp.gmail.com', port);
    if (open) {
      console.log(`   ✅ Port ${port} — OPEN`);
      openPorts.push(port);
    } else {
      console.log(`   ❌ Port ${port} — BLOCKED`);
    }
  }

  if (openPorts.length === 0) {
    console.log('\n   🚨 ALL SMTP PORTS ARE BLOCKED on this server.');
    console.log('   → Render free tier blocks all outbound SMTP.');
    console.log('   → You MUST use an HTTP-based email service like:');
    console.log('      • Resend (resend.com) — free, 3000 emails/month');
    console.log('      • Brevo (brevo.com)  — free, 300 emails/day');
    console.log('      • Both are just an API key + one fetch() call, no extra npm package needed.');
    process.exit(0);
  }

  // 4. Try actual send
  console.log('\n4. Attempting SMTP auth on open ports...');
  const nodemailer = require('nodemailer');

  for (const port of openPorts) {
    const secure = port === 465;
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com', port, secure,
        auth: { user: GMAIL_USER, pass: GMAIL_PASS },
        connectionTimeout: 8000, socketTimeout: 8000,
        tls: { rejectUnauthorized: false },
      });
      await transporter.verify();
      console.log(`   ✅ Port ${port} — AUTH SUCCESS! Email should work.`);
      console.log('\n✅ Email is configured correctly. The issue may be elsewhere.\n');
      process.exit(0);
    } catch (e) {
      console.log(`   ❌ Port ${port} — Auth failed: ${e.message}`);
      if (e.message.includes('535') || e.message.includes('Username and Password')) {
        console.log('      → Wrong credentials. Make sure you\'re using a Gmail App Password,');
        console.log('        not your regular Gmail password.');
        console.log('        Generate one at: https://myaccount.google.com/apppasswords');
        console.log('        (Requires 2FA to be enabled on your Google account)');
      }
      if (e.message.includes('534') || e.message.includes('less secure')) {
        console.log('      → Google is blocking sign-in. You need an App Password.');
      }
    }
  }

  console.log('\n🚨 Could not authenticate with Gmail on any open port.');
  console.log('   Check your App Password and try again.\n');
}

main().catch(console.error);
