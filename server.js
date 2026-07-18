const app = require("./src/app");

const cfg = app.locals.config;

app.listen(cfg.port, cfg.host, () => {
  const hostLabel = cfg.host === "0.0.0.0" ? "localhost" : cfg.host;
  console.log(
    JSON.stringify({
      level: "info",
      message: "Wevermore transcript backend berjalan",
      address: `http://${hostLabel}:${cfg.port}`
    })
  );
});
