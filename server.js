// backend/server.js
const express = require('express');
const cors = require('cors');
// REMOVED: require('dotenv').config(); // Render handles env vars directly

// Temporary: Use a dummy key if STRIPE_SECRET_KEY is not found in environment variables.
// This allows the server to start, but actual Stripe payments will fail until the correct key is set on Render.
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_DUMMY_KEY_FOR_RENDER_DEPLOYMENT'); // Initialize Stripe

// Import database configuration
const pool = require('./config/db');

// Import authentication middleware
const { authenticateToken, isAdmin } = require('./middleware/authMiddleware');

// Import routes
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const userRoutes = require('./routes/userRoutes');
const messageRoutes = require('./routes/messageRoutes'); // Ensure message routes are imported

const app = express();
const port = process.env.PORT || 3001; // Use PORT from environment or default to 3001

// --- Stripe Webhook Endpoint (MUST be before express.json() if raw body is needed) ---
// Stripe recommends using the raw body for webhook signature verification
app.post('/api/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    // IMPORTANT: If process.env.STRIPE_WEBHOOK_SECRET is not set, this will fail.
    // Ensure it's correctly configured in Render environment variables.
    if (!process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET === 'whsec_YOUR_STRIPE_WEBHOOK_SECRET') {
        console.warn("Stripe Webhook Secret is not configured. Webhook verification will fail.");
        return res.status(400).send("Webhook secret not configured.");
    }

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`Webhook Error: ${err.message}`);
        return r