module.exports = {
  apps: [
    {
      name: 'admin-web',
      cwd: __dirname,
      script: 'npm',
      args: 'start -- -p 3000',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
