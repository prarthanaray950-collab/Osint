const axios = require('axios');

const RELAY = process.env.RELAY_API_URL || 'https://relay-wzlz.onrender.com';

// Add session management
let sessionToken = null;
let accountId = null;

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

// NEW: Login function
const login = async (username, password) => {
  try {
    const response = await axios.post(
      `${RELAY}/api/v1/auth/login`,
      { account_id: username, password: password },
      { timeout: 90000 }
    );
    
    if (response.data.status === 'success') {
      sessionToken = response.data.api_key;
      accountId = response.data.account_id;
      return { success: true, data: response.data };
    }
    return { success: false, error: response.data.message };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// UPDATED: relaySearch function
const relaySearch = async (type, query, apiKey = null) => {
  const config = SEARCH_TYPES[type];
  if (!config) throw new Error('Unknown search type');

  // Use provided apiKey or session token
  const authKey = apiKey || sessionToken;
  if (!authKey) throw new Error('Not authenticated. Please login first.');

  try {
    const response = await axios.post(
      `${RELAY}${config.endpoint}`,
      { query },
      {
        headers: { 
          'Content-Type': 'application/json', 
          'X-API-Key': authKey  // The Python code uses X-API-Key header
        },
        timeout: 90000,
      }
    );

    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      throw new Error('Session expired. Please login again.');
    }
    throw error;
  }
};

// NEW: Register function
const register = async (username, password) => {
  try {
    const response = await axios.post(
      `${RELAY}/api/v1/auth/register`,
      { username, password },
      { timeout: 90000 }
    );
    return response.data;
  } catch (error) {
    throw error;
  }
};

// NEW: Check balance
const checkBalance = async () => {
  if (!sessionToken) throw new Error('Not authenticated');
  
  const response = await axios.get(
    `${RELAY}/api/v1/balance`,
    {
      headers: { 'X-API-Key': sessionToken },
      timeout: 90000,
    }
  );
  
  return response.data;
};

const relayStatus = async () => {
  try {
    const r = await axios.get(`${RELAY}/api/status`, { timeout: 8000 });
    return r.data;
  } catch {
    return { status: 'offline' };
  }
};

module.exports = { 
  SEARCH_TYPES, 
  relaySearch, 
  relayStatus,
  login,        // NEW
  register,     // NEW
  checkBalance  // NEW
};
