// ecosystem.config.js — Uses .env file

module.exports = {
  apps: [{
    name: 'orvexify',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '500M',
    
    // ✅ Auto-load .env file
    env_file: '.env',
    
    // ✅ Override any specific env vars if needed
    env: {
      NODE_ENV: 'production',
      PORT: 5000,
    },
    
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    kill_timeout: 5000,
    listen_timeout: 3000,
    shutdown_with_message: true,
  }]
};