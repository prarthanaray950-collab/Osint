const axios = require('axios');

const RELAY = process.env.RELAY_API_URL || 'https://relay-wzlz.onrender.com';
const KEY   = process.env.RELAY_API_KEY  || '';

const SEARCH_TYPES = {
  phone:     { name: 'Phone Analysis',     endpoint: '/api/search/phone',     credits: 2 },
  vehicle:   { name: 'Vehicle Analysis',   endpoint: '/api/search/vehicle',   credits: 2 },
  telegram:  { name: 'Telegram Analysis',  endpoint: '/api/search/telegram',  credits: 3 },
  ip:        { name: 'IP Analysis',        endpoint: '/api/search/ip',        credits: 1 },
  gst:       { name: 'GST Analysis',       endpoint: '/api/search/gst',       credits: 2 },
  instagram: { name: 'Instagram Analysis', endpoint: '/api/search/instagram', credits: 3 },
  imei:      { name: 'IMEI/Device',        endpoint: '/api/search/imei',      credits: 2 },
};

const relaySearch = async (type, query, apiKey) => {
  const config = SEARCH_TYPES[type];
  if (!config) throw new Error('Unknown search type');

  const headers = {
    'Content-Type': 'application/json',
    'X-Api-Key':    apiKey || KEY,
  };

  const response = await axios.post(
    `${RELAY}${config.endpoint}`,
    { query },
    { headers, timeout: 60000 }
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
