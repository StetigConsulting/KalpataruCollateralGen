module.exports = {
  apps: [
    {
      name: "kalpataru-collateral-gen",
      script: "./server.js",
      instances: 1,
      exec_mode: "fork",
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};