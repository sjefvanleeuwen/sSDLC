const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ status: "ok", message: "demo-secure-app is running" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "healthy" });
});

app.get("/version", (_req, res) => {
  res.json({ version: "1.0.0", pipeline: "sSDLC" });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
