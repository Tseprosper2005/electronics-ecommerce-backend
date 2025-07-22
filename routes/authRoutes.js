// backend/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db'); // Import the database pool
require('dotenv').config(); // Load environment variables

const JWT_SECRET = process.env.JWT_SECRET;

// User Registration Route
router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    // Basic validation
    if (!username || !email || !password) {
        return res.status(400).json({ message: 'Username, email, and password are required.' });
    }

    try {
        // Check if user already exists
        const existingUser = await pool.query('SELECT id FROM users WHERE email = $1 OR username = $2', [email, username]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ message: 'User with that email or username already exists.' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert new user into the database
        const newUser = await pool.query(
            "INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'user') RETURNING id, username, email, role",
            [username, email, hashedPassword]
        );

        // Respond with the new user's public information
        res.status(201).json({
            id: newUser.rows[0].id,
            username: newUser.rows[0].username,
            email: newUser.rows[0].email,
            role: newUser.rows[0].role
        });

    } catch (error) {
        console.error('Error during user registration:', error.message);
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

// User Login Route
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    // Basic validation
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }

    try {
        // Retrieve user from database by email
        const userResult = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (userResult.rows.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const user = userResult.rows[0];

        // Compare provided password with hashed password
        const isPasswordMatch = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, role: user.role, username: user.username }, // Payload
            JWT_SECRET, // Secret key
            { expiresIn: '1h' } // Token expiration time
        );

        // Respond with token and user details
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error('Error during user login:', error.message);
        res.status(500).json({ message: 'Server error during login.' });
    }
});

module.exports = router;
