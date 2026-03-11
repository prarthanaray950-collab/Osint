const axios = require('axios');

const RELAY = process.env.RELAY_API_URL || 'https://relay-wzlz.onrender.com';

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

const relaySearch = async (type, query, apiKey) => {
  const config = SEARCH_TYPES[type];
  if (!config) throw new Error('Unknown search type');

  if (!apiKey) throw new Error('Relay API key is not configured. Contact admin.');

  const response = await axios.post(
    `${RELAY}${config.endpoint}`,
    { query },
    {
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
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

module.exports = { SEARCH_TYPES, relaySearch, relayStatus };
