// Usage: node scripts/createAdmin.js you@example.com yourStrongPassword
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { UserModel } = require('../models/userModel');
const { pool } = require('../db/pool');

(async () => {
  const [, , email, password] = process.argv;
  if (!email || !password || password.length < 8) {
    console.error('Usage: node scripts/createAdmin.js <email> <password (min 8 chars)>');
    process.exit(1);
  }
  const existing = await UserModel.findByEmail(email);
  if (existing) {
    console.error(`A user with email ${email} already exists (id ${existing.id}).`);
    process.exit(1);
  }
  const user = await UserModel.create(email, password, 'admin');
  await UserModel.markVerified(user.id); // admins created via CLI skip the email-verification flow
  console.log(`Admin created: ${user.email} (id ${user.id})`);
  await pool.end();
})();
