module.exports = {
    apps: [
      {
            name: "retail-pos-server",
            cwd: "./retail_pos_server",
        script: "npm",
        args: "run start",
        // Owner 2026-10-19: timestamp every pm2 log line (box local time).
        time: true,
        log_date_format: "YYYY-MM-DD HH:mm:ss",
        env: {
          NODE_ENV: "production",
          PORT: 2200,
          // F-18 (2026-10-19): Node's Happy Eyeballs gives each resolved address
          // 250 ms to connect by default; Sydney → Cloudflare (SIN) sits at
          // 160–250 ms, so cloud calls to crm/api failed with AggregateError
          // ETIMEDOUT several times an hour ("500 Server Error / error undefined").
          // src/index.ts sets the same default in code; this covers older builds.
          NODE_OPTIONS: "--network-family-autoselection-attempt-timeout=3000"
        }
      }
    ]
  };