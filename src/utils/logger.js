const env = require('../config/env');

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = levels[env.LOG_LEVEL] || levels.info;

function log(level, message, data = null) {
  if (levels[level] > currentLevel) return;

  const timestamp = new Date().toISOString();
  const prefix = {
    error: '❌',
    warn: '⚠️',
    info: 'ℹ️',
    debug: '🔍',
  }[level] || '•';

  let output = `[${timestamp}] ${prefix} ${level.toUpperCase()}: ${message}`;
  if (data) {
    output += '\n' + JSON.stringify(data, null, 2);
  }

  console.log(output);
}

module.exports = {
  error: (msg, data) => log('error', msg, data),
  warn: (msg, data) => log('warn', msg, data),
  info: (msg, data) => log('info', msg, data),
  debug: (msg, data) => log('debug', msg, data),
};
