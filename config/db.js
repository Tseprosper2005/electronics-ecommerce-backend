// backend/config/db.js
const { Pool } = require('pg');
// REMOVED: require('dotenv').config(); // Render handles env vars directly

// Create a new PostgreSQL pool instance
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    // Add SSL configuration for production if your hosting provider requires it
    // For Render, you'll typically use the DATABASE_URL environment variable,
    // which handles SSL automatically. This explicit config is more for local.
    // ssl: {
    //     rejectUnauthorized: false // Use this if you encounter SSL issues in development/staging
    // }
});

// Test the database connection when the module is loaded
pool.query('SELECT NOW()')
    .then(res => console.log('Successfully connected to the database at:', res.rows[0].now))
    .catch(err => console.error('Error connecting to the database:', err.stack));

// Export the pool to be used by other modules
module.exports = pool;
