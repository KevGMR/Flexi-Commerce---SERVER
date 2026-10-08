require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const crypto = require("crypto");
const Organization = require("../models/Organization");
const secretBox = require("../services/secretBox");

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(uri, { tls: true, ssl: true, family: 4 });

  const [slug, consumerKey, consumerSecret, shortcode, passkey, env] =
    process.argv.slice(2);

  if (!slug || !consumerKey || !consumerSecret || !shortcode || !passkey) {
    console.error(
      "Usage: node scripts/set-org-daraja.js <slug> <consumerKey> <consumerSecret> <shortcode> <passkey> [sandbox|production]",
    );
    process.exit(1);
  }

  const callbackSecret = crypto.randomBytes(24).toString("hex");

  const update = {
    "daraja.enabled": true,
    "daraja.environment": env === "production" ? "production" : "sandbox",
    "daraja.consumerKey": secretBox.encrypt(consumerKey),
    "daraja.consumerSecret": secretBox.encrypt(consumerSecret),
    "daraja.shortcode": shortcode,
    "daraja.passkey": secretBox.encrypt(passkey),
    "daraja.transactionType": "CustomerPayBillOnline",
    "daraja.callbackSecret": callbackSecret,
  };

  const res = await Organization.updateOne({ slug }, { $set: update });
  console.log(`Updated ${res.modifiedCount} org.`);
  console.log(`Callback secret: ${callbackSecret}`);
  console.log(`Callback URL: ${process.env.PUBLIC_API_URL}/storefront/mpesa/callback?key=${callbackSecret}`);

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
