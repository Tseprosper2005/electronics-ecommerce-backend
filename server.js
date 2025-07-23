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

// --- CORS Configuration (IMPORTANT for Frontend-Backend Communication) ---
// Replace 'https://ecommerce-frontend-app.onrender.com' with your actual deployed frontend URL
const corsOptions = {
    origin: 'https://ecommerce-frontend-app.onrender.com', // Allow requests ONLY from your deployed frontend
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], // Allowed HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'], // Allowed headers
    credentials: true // Allow cookies and authorization headers to be sent
};
app.use(cors(corsOptions)); // Apply CORS middleware with specific options
// --- END CORS Configuration ---


app.use(express.json()); // To parse JSON bodies from incoming requests (after webhook for raw body)

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
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'payment_intent.succeeded':
            const paymentIntentSucceeded = event.data.object;
            console.log(`PaymentIntent for ${paymentIntentSucceeded.amount} was successful!`);
            // Update your order in the database to 'completed'
            const orderIdFromMetadata = paymentIntentSucceeded.metadata.orderId;
            if (orderIdFromMetadata) {
                try {
                    await pool.query(
                        "UPDATE orders SET payment_status = 'completed', updated_at = NOW() WHERE id = $1 AND stripe_payment_intent_id = $2",
                        [orderIdFromMetadata, paymentIntentSucceeded.id]
                    );
                    console.log(`Order ${orderIdFromMetadata} payment status updated to 'completed'.`);
                } catch (dbErr) {
                    console.error(`Database update failed for order ${orderIdFromMetadata}:`, dbErr);
                }
            }
            break;
        case 'payment_intent.payment_failed':
            const paymentIntentFailed = event.data.object;
            console.log(`PaymentIntent for ${paymentIntentFailed.amount} failed!`);
            // Update your order in the database to 'failed'
            const failedOrderIdFromMetadata = paymentIntentFailed.metadata.orderId;
            if (failedOrderIdFromMetadata) {
                try {
                    await pool.query(
                        "UPDATE orders SET payment_status = 'failed', updated_at = NOW() WHERE id = $1 AND stripe_payment_intent_id = $2",
                        [failedOrderIdFromMetadata, paymentIntentFailed.id]
                    );
                    console.log(`Order ${failedOrderIdFromMetadata} payment status updated to 'failed'.`);
                } catch (dbErr) {
                    console.error(`Database update failed for failed order ${failedOrderIdFromMetadata}:`, dbErr);
                }
            }
            break;
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({received: true});
});

// Route Middlewares
app.use('/api/auth', authRoutes); // Authentication routes (register, login)
app.use('/api/products', productRoutes); // Product CRUD routes
app.use('/api/orders', orderRoutes); // Order management routes
app.use('/api/users', userRoutes); // User management routes
app.use('/api/messages', messageRoutes); // Message routes

// Basic Route for testing server status
app.get('/', (req, res) => {
    res.send('E-commerce API is running!');
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Start the server
app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
