const axios = require('axios');

const RELAY = process.env.RELAY_API_URL || 'https://relay-wzlz.onrender.com';
const KEY   = process.env.RELAY_API_KEY  || '';

// NOTE: The relay bot exposes /api/v1/search/* — NOT /api/search/*
// The original code was missing /v1 causing 404 on every search call.
const SEARCH_TYPES = {
  phone:     { name: 'Phone Analysis',        endpoint: '/api/v1/search/phone',     credits: 2 },
  vehicle:   { name: 'Vehicle Analysis',      endpoint: '/api/v1/search/vehicle',   credits: 2 },
  telegram:  { name: 'Telegram Analysis',     endpoint: '/api/v1/search/telegram',  credits: 3 },
  ip:        { name: 'IP Analysis',           endpoint: '/api/v1/search/ip',        credits: 1 },
  gst:       { name: 'GST Analysis',          endpoint: '/api/v1/search/gst',       credits: 2 },
  instagram: { name: 'Instagram Analysis',    endpoint: '/api/v1/search/instagram', credits: 3 },
  imei:      { name: 'IMEI / Device',         endpoint: '/api/v1/search/imei',      credits: 2 },
  family:    { name: 'Family Network',        endpoint: '/api/v1/search/family',    credits: 2 },
  aadhar:    { name: 'Aadhar Comprehensive',  endpoint: '/api/v1/search/aadhar',    credits: 3 },
  upi:       { name: 'UPI Intelligence',      endpoint: '/api/v1/search/upi',       credits: 2 },
  email:     { name: 'Email Intelligence',    endpoint: '/api/v1/search/email',     credits: 2 },
  ifsc:      { name: 'IFSC Code Lookup',      endpoint: '/api/v1/search/ifsc',      credits: 1 },
  leak:      { name: 'Advanced OSINT / Leak', endpoint: '/api/v1/search/leak',      credits: 3 },
  pakistan:  { name: 'Pakistan DB',           endpoint: '/api/v1/search/pakistan',  credits: 2 },
};

const relaySearch = async (type, query, apiKey) => {
  const config = SEARCH_TYPES[type];
  if (!config) throw new Error(`Unknown search type: ${type}`);
  const key = apiKey || KEY;
  if (!key) throw new Error('RELAY_API_KEY is not configured');
  const headers = { 'Content-Type': 'application/json', 'X-Api-Key': key };
  const response = await axios.post(
    `${RELAY}${config.endpoint}`,
    { query },
    { headers, timeout: 90000 }
  );
  return response.data;
};

const relayStatus = async () => {
  try {
    const r = await axios.get(`${RELAY}/api/v1/status`, { timeout: 10000 });
    return r.data;
  } catch {
    return { status: 'offline' };
  }
};

module.exports = { SEARCH_TYPES, relaySearch, relayStatus };
