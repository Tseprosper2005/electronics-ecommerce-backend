// backend/config/db.js
const { Pool } = require('pg');
require('dotenv').config(); // Load environment variables

// Create a new PostgreSQL pool instance
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// Test the database connection when the module is loaded
pool.query('SELECT NOW()')
    .then(res => console.log('Successfully connected to the database at:', res.rows[0].now))
    .catch(err => console.error('Error connecting to the database:', err.stack));

// Export the pool to be used by other modules
module.exports = pool;
