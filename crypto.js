const crypto = require("crypto");

// Generate a random salt
const salt = crypto
  .randomBytes(16)
  .toString("hex")
  .replace(/[a-fA-F]/g, "");
console.log("Generated salt:", salt);
