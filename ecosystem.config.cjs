// PM2 process config for the Calby backend.
// Loads environment variables from .env via the server's dotenv import.
// Usage on the server:  pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'calby',
      script: 'server/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
    },
  ],
};
