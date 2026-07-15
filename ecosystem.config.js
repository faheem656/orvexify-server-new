// ecosystem.config.js — Server root mein banayein

module.exports = {
  apps: [{
    name: 'orvexify',
    script: 'server.js',
    instances: 1,              // 1 instance (single core)
    exec_mode: 'fork',         // Fork mode
    watch: false,             // Auto-restart on file change
    max_memory_restart: '500M', // Restart if memory > 500MB
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    kill_timeout: 5000,
    listen_timeout: 3000,
    shutdown_with_message: true,
  }]
};