const bcrypt = require("bcrypt");

function getBcryptRounds() {
  const parsed = Number(process.env.BCRYPT_ROUNDS);
  if (Number.isInteger(parsed) && parsed >= 10 && parsed <= 15) return parsed;
  return process.env.NODE_ENV === "production" ? 12 : 10;
}

exports.hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(getBcryptRounds());
  return bcrypt.hash(password, salt);
};

exports.comparePassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

exports.getBcryptRounds = getBcryptRounds;
