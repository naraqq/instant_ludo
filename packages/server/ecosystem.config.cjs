const os = require('os')

// Colyseus Cloud deployment configuration.
// https://docs.colyseus.io/deployment/cloud
module.exports = {
  apps: [{
    name: 'elemental-ludo',
    script: 'src/index.js',
    time: true,
    watch: false,
    instances: os.cpus().length,
    exec_mode: 'fork',
    wait_ready: true,
    max_memory_restart: '512M',
  }],
}
