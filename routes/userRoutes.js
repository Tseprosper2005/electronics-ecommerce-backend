// backend/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db'); // Import the database pool
const { authenticateToken, isAdmin } = require('../middleware/authMiddleware'); // Import auth middleware
const bcrypt = require('bcrypt'); // For hashing passwords if admin can update them

// 1. Get all Users (Admin only)
router.get('/', authenticateToken, isAdmin, async (req, res) => {
    try {
        // Exclude password_hash for security
        const allUsers = await pool.query("SELECT id, username, email, role, created_at, updated_at FROM users ORDER BY created_at DESC");
        res.json(allUsers.rows);
    } catch (error) {
        console.error('Error fetching all users:', error.message);
        res.status(500).json({ message: 'Server error fetching users.' });
    }
});

// 2. Get a single User by ID (Admin only, or user themselves)
router.get('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const requestingUserId = req.user.userId;
    const requestingUserRole = req.user.role;

    try {
        // Allow admin to fetch any user, or a user to fetch their own profile
        if (requestingUserRole !== 'admin' && parseInt(id) !== requestingUserId) {
            return res.status(403).json({ message: 'Access denied. You can only view your own profile.' });
        }

        const userResult = await pool.query("SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = $1", [id]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: "User not found." });
        }
        res.json(userResult.rows[0]);
    } catch (error) {
        console.error('Error fetching single user:', error.message);
        res.status(500).json({ message: 'Server error fetching user.' });
    }
});

// 3. Update User (Admin only for any user, or user for their own profile)
router.put('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { username, email, password, role } = req.body; // Password and role updates are sensitive
    const requestingUserId = req.user.userId;
    const requestingUserRole = req.user.role;

    // A user can only update their own profile (username, email, password)
    // An admin can update any user's username, email, password, and role
    if (requestingUserRole !== 'admin' && parseInt(id) !== requestingUserId) {
        return res.status(403).json({ message: 'Access denied. You can only update your own profile.' });
    }

    let query = "UPDATE users SET updated_at = NOW()";
    const values = [];
    let paramCount = 1;

    if (username !== undefined) {
        query += `, username = $${paramCount++}`;
        values.push(username);
    }
    if (email !== undefined) {
        query += `, email = $${paramCount++}`;
        values.push(email);
    }
    if (password !== undefined) {
        if (password.length < 6) { // Basic password length validation
            return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        query += `, password_hash = $${paramCount++}`;
        values.push(hashedPassword);
    }
    // Only admin can change roles
    if (role !== undefined && requestingUserRole === 'admin') {
        if (!['user', 'admin'].includes(role)) {
            return res.status(400).json({ message: 'Invalid role specified. Must be "user" or "admin".' });
        }
        query += `, role = $${paramCount++}`;
        values.push(role);
    } else if (role !== undefined && requestingUserRole !== 'admin') {
        // If a non-admin tries to change role, ignore or reject
        return res.status(403).json({ message: 'Access denied. Only administrators can change user roles.' });
    }

    query += ` WHERE id = $${paramCount++} RETURNING id, username, email, role, created_at, updated_at`;
    values.push(id);

    try {
        const updatedUser = await pool.query(query, values);

        if (updatedUser.rows.length === 0) {
            return res.status(404).json({ message: "User not found." });
        }
        res.json(updatedUser.rows[0]);
    } catch (error) {
        console.error('Error updating user:', error.message);
        // Handle unique constraint violation for username/email
        if (error.code === '23505') {
            return res.status(409).json({ message: 'Username or email already in use.' });
        }
        res.status(500).json({ message: 'Server error updating user.' });
    }
});

// 4. Delete User (Admin only)
router.delete('/:id', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    const userIdToDelete = parseInt(id);
    const requestingUserId = req.user.userId;

    // Prevent admin from deleting themselves
    if (userIdToDelete === requestingUserId) {
        return res.status(403).json({ message: 'Cannot delete your own admin account.' });
    }

    const client = await pool.connect(); // Use transaction for cascading delete
    try {
        await client.query('BEGIN');

        // Optional: Check if the user has any active orders before deleting (depends on business logic)
        // const activeOrders = await client.query("SELECT id FROM orders WHERE user_id = $1 AND status NOT IN ('delivered', 'cancelled')", [userIdToDelete]);
        // if (activeOrders.rows.length > 0) {
        //     throw new Error('Cannot delete user with active orders.');
        // }

        // Deleting user will cascade delete their orders and order_items due to ON DELETE CASCADE
        const deleteOp = await client.query("DELETE FROM users WHERE id = $1 RETURNING *", [userIdToDelete]);

        if (deleteOp.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: "User not found." });
        }

        await client.query('COMMIT');
        res.status(200).json({ message: `User with id ${id} and associated data deleted successfully.` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting user:', error.message);
        res.status(500).json({ message: error.message || 'Server error deleting user.' });
    } finally {
        client.release();
    }
});

module.exports = router;
