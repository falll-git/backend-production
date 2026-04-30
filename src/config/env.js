const dotenv = require("dotenv");

let loaded = false;

function loadEnv() {
  if (loaded) {
    return;
  }

  dotenv.config({ path: ".env" });

  loaded = true;
}

module.exports = { loadEnv };
