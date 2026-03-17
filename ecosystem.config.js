module.exports = {
    apps: [
      {
            name: "retail-pos-server",
            cwd: "./retail_pos_server",
        script: "npm",
        args: "run start",
        env: {
          NODE_ENV: "production",
          PORT: 2200
        }
      }
    ]
  };