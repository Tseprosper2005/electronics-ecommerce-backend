// backend/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
// REMOVED: require('dotenv').config(); // Load environment variables

const JWT_SECRET = process.env.JWT_SECRET; // JWT_SECRET will now come directly from Render's env vars

// Middleware to authenticate JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (token == null) {
        return res.status(401).json({ message: 'Authentication token required.' }); // No token provided
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error('JWT verification error:', err);
            return res.status(403).json({ message: 'Invalid or expired token.' }); // Token is invalid or expired
        }
        req.user = user; // Attach user payload (userId, role) to the request
        next(); // Proceed to the next middleware/route handler
    });
};

// Middleware to check if the authenticated user is an admin
const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next(); // User is an admin, proceed
    } else {
        return res.status(403).json({ message: 'Access denied. Administrator privileges required.' }); // Not an admin
    }
};

module.exports = {
    authenticateToken,
    isAdmin
};
