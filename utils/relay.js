const axios = require('axios');

const RELAY = process.env.RELAY_API_URL || 'https://relay-wzlz.onrender.com';

// Session state
let sessionToken = null;
let accountId    = null;
let loginPromise = null; // prevents concurrent login races

const SEARCH_TYPES = {
  phone:     { name: 'Phone Analysis',     endpoint: '/api/v1/search/phone',     credits: 2 },
  family:    { name: 'Family Search',      endpoint: '/api/v1/search/family',    credits: 2 },
  aadhar:    { name: 'Aadhar Lookup',      endpoint: '/api/v1/search/aadhar',    credits: 3 },
  vehicle:   { name: 'Vehicle Analysis',   endpoint: '/api/v1/search/vehicle',   credits: 2 },
  telegram:  { name: 'Telegram Analysis',  endpoint: '/api/v1/search/telegram',  credits: 3 },
  imei:      { name: 'IMEI/Device',        endpoint: '/api/v1/search/imei',      credits: 2 },
  gst:       { name: 'GST Analysis',       endpoint: '/api/v1/search/gst',       credits: 2 },
  instagram: { name: 'Instagram Analysis', endpoint: '/api/v1/search/instagram', credits: 3 },
  ip:        { name: 'IP Analysis',        endpoint: '/api/v1/search/ip',        credits: 1 },
  ifsc:      { name: 'IFSC Lookup',        endpoint: '/api/v1/search/ifsc',      credits: 1 },
  email:     { name: 'Email Lookup',       endpoint: '/api/v1/search/email',     credits: 2 },
  upi:       { name: 'UPI Lookup',         endpoint: '/api/v1/search/upi',       credits: 2 },
  pakistan:  { name: 'Pakistan OSINT',     endpoint: '/api/v1/search/pakistan',  credits: 2 },
  leak:      { name: 'Data Leak Check',    endpoint: '/api/v1/search/leak',      credits: 3 },
};

// Login using RELAY_USERNAME + RELAY_PASSWORD from .env
const login = async (username, password) => {
  try {
    const response = await axios.post(
      `${RELAY}/api/v1/auth/login`,
      { account_id: username, password },
      { timeout: 90000 }
    );
    if (response.data.status === 'success') {
      sessionToken = response.data.api_key;
      accountId    = response.data.account_id;
      console.log('[Relay] Authenticated as', accountId);
      return { success: true, data: response.data };
    }
    return { success: false, error: response.data.message };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// FIX #1 — Ensure a valid session token exists before every search.
// Uses env credentials. Serialises concurrent calls so only one login fires.
const ensureAuthenticated = async () => {
  if (sessionToken) return;

  // Prevent multiple simultaneous login requests racing each other
  if (loginPromise) return loginPromise;

  const username = process.env.RELAY_USERNAME;
  const password = process.env.RELAY_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'Relay credentials not configured. Set RELAY_USERNAME and RELAY_PASSWORD in .env'
    );
  }

  loginPromise = login(username, password).finally(() => { loginPromise = null; });
  const result = await loginPromise;

  if (!result.success) {
    sessionToken = null;
    throw new Error('Relay login failed: ' + result.error);
  }
};

// FIX #1 + #5 — relaySearch no longer accepts a static apiKey param.
// It always uses the managed session, and auto-re-authenticates on 401.
const relaySearch = async (type, query) => {
  const config = SEARCH_TYPES[type];
  if (!config) throw new Error('Unknown search type');

  await ensureAuthenticated();

  try {
    const response = await axios.post(
      `${RELAY}${config.endpoint}`,
      { query },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': sessionToken,
        },
        timeout: 90000,
      }
    );
    return response.data;
  } catch (error) {
    // FIX #5 — token expired: clear it and retry once with a fresh login
    if (error.response?.status === 401) {
      console.warn('[Relay] Session expired — re-authenticating...');
      sessionToken = null;
      await ensureAuthenticated();

      const retry = await axios.post(
        `${RELAY}${config.endpoint}`,
        { query },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': sessionToken,
          },
          timeout: 90000,
        }
      );
      return retry.data;
    }
    throw error;
  }
};

// Register a new account on the Relay server
const register = async (username, password) => {
  const response = await axios.post(
    `${RELAY}/api/v1/auth/register`,
    { username, password },
    { timeout: 90000 }
  );
  return response.data;
};

// Check credit balance on the Relay server
const checkBalance = async () => {
  await ensureAuthenticated();
  const response = await axios.get(
    `${RELAY}/api/v1/balance`,
    {
      headers: { 'X-API-Key': sessionToken },
      timeout: 90000,
    }
  );
  return response.data;
};

// FIX #2 — correct health endpoint path
const relayStatus = async () => {
  try {
    const r = await axios.get(`${RELAY}/api/v1/health`, { timeout: 8000 });
    return r.data;
  } catch {
    return { status: 'offline' };
  }
};

// Warm up the session at server startup so the first search isn't delayed
const warmup = () => {
  ensureAuthenticated().catch(err =>
    console.warn('[Relay] Startup auth warning:', err.message)
  );
};

module.exports = {
  SEARCH_TYPES,
  relaySearch,
  relayStatus,
  login,
  register,
  checkBalance,
  warmup,
};
