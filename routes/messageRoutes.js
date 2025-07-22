// backend/routes/messageRoutes.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db'); // Import the database pool
const { authenticateToken, isAdmin } = require('../middleware/authMiddleware'); // Import auth middleware

// 1. Send a Message (Authenticated Users & Admin)
router.post('/', authenticateToken, async (req, res) => {
    const { receiverId, subject, messageText } = req.body;
    const senderId = req.user.userId;
    const senderRole = req.user.role;

    // Basic validation
    if (!messageText) {
        return res.status(400).json({ message: 'Message text is required.' });
    }

    // Determine receiver behavior:
    // If sender is a user and receiverId is not provided, assume message is for admin(s).
    // If sender is admin, receiverId must be a specific user.
    if (senderRole === 'user' && receiverId !== undefined && receiverId !== null) {
        return res.status(400).json({ message: 'Users can only send general messages to admin, not specific users.' });
    }
    if (senderRole === 'admin' && (receiverId === undefined || receiverId === null)) {
        return res.status(400).json({ message: 'Admins must specify a receiverId when sending messages.' });
    }

    try {
        const newMessage = await pool.query(
            "INSERT INTO messages (sender_id, receiver_id, subject, message_text) VALUES ($1, $2, $3, $4) RETURNING *",
            [senderId, receiverId, subject, messageText]
        );
        res.status(201).json(newMessage.rows[0]);
    } catch (error) {
        console.error('Error sending message:', error.message);
        res.status(500).json({ message: 'Server error sending message.' });
    }
});

// 2. Get Messages for a User (Inbox/Sent - Authenticated User)
router.get('/', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const userRole = req.user.role;

    try {
        let messagesResult;
        if (userRole === 'admin') {
            // Admin can see all messages (inbox and sent)
            // Join with users table to get sender/receiver usernames
            messagesResult = await pool.query(
                `SELECT m.id, m.sender_id, s.username AS sender_username, m.receiver_id, r.username AS receiver_username,
                        m.subject, m.message_text, m.is_read, m.sent_at
                 FROM messages m
                 JOIN users s ON m.sender_id = s.id
                 LEFT JOIN users r ON m.receiver_id = r.id -- LEFT JOIN because receiver_id can be NULL
                 ORDER BY m.sent_at DESC`
            );
        } else {
            // Regular user sees messages they sent AND messages sent to them (where receiver_id is their ID)
            messagesResult = await pool.query(
                `SELECT m.id, m.sender_id, s.username AS sender_username, m.receiver_id, r.username AS receiver_username,
                        m.subject, m.message_text, m.is_read, m.sent_at
                 FROM messages m
                 JOIN users s ON m.sender_id = s.id
                 LEFT JOIN users r ON m.receiver_id = r.id
                 WHERE m.sender_id = $1 OR m.receiver_id = $1
                 ORDER BY m.sent_at DESC`,
                [userId]
            );
        }
        res.json(messagesResult.rows);
    } catch (error) {
        console.error('Error fetching messages:', error.message);
        res.status(500).json({ message: 'Server error fetching messages.' });
    }
});

// 3. Get a Single Message by ID (Authenticated User - if sender/receiver, Admin - any)
router.get('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    try {
        const messageResult = await pool.query(
            `SELECT m.id, m.sender_id, s.username AS sender_username, m.receiver_id, r.username AS receiver_username,
                    m.subject, m.message_text, m.is_read, m.sent_at
             FROM messages m
             JOIN users s ON m.sender_id = s.id
             LEFT JOIN users r ON m.receiver_id = r.id
             WHERE m.id = $1`,
            [id]
        );

        if (messageResult.rows.length === 0) {
            return res.status(404).json({ message: 'Message not found.' });
        }

        const message = messageResult.rows[0];

        // Authorization: Admin can view any message, regular user can only view their own sent/received messages
        if (userRole !== 'admin' && message.sender_id !== userId && message.receiver_id !== userId) {
            return res.status(403).json({ message: 'Access denied. You can only view your own messages.' });
        }

        res.json(message);
    } catch (error) {
        console.error('Error fetching single message:', error.message);
        res.status(500).json({ message: 'Server error fetching message.' });
    }
});

// 4. Mark Message as Read (Authenticated User - if receiver, Admin - any)
router.patch('/:id/read', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    try {
        // First, fetch the message to check authorization
        const messageResult = await pool.query("SELECT sender_id, receiver_id, is_read FROM messages WHERE id = $1", [id]);
        if (messageResult.rows.length === 0) {
            return res.status(404).json({ message: 'Message not found.' });
        }
        const message = messageResult.rows[0];

        // Authorization: Admin can mark any message as read.
        // Regular user can mark messages as read ONLY IF they are the receiver.
        if (userRole !== 'admin' && message.receiver_id !== userId) {
            return res.status(403).json({ message: 'Access denied. You can only mark messages sent to you as read.' });
        }

        if (message.is_read) {
            return res.status(200).json({ message: 'Message already marked as read.' });
        }

        const updatedMessage = await pool.query(
            "UPDATE messages SET is_read = TRUE WHERE id = $1 RETURNING *",
            [id]
        );

        res.status(200).json(updatedMessage.rows[0]);
    } catch (error) {
        console.error('Error marking message as read:', error.message);
        res.status(500).json({ message: 'Server error marking message as read.' });
    }
});

// 5. Delete a Message (Admin only, or User can delete their own sent messages)
router.delete('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    try {
        // Fetch the message to check authorization
        const messageResult = await pool.query("SELECT sender_id, receiver_id FROM messages WHERE id = $1", [id]);
        if (messageResult.rows.length === 0) {
            return res.status(404).json({ message: 'Message not found.' });
        }
        const message = messageResult.rows[0];

        // Authorization: Admin can delete any message.
        // Regular user can delete messages ONLY IF they are the sender.
        if (userRole !== 'admin' && message.sender_id !== userId) {
            return res.status(403).json({ message: 'Access denied. You can only delete messages you have sent.' });
        }

        const deleteOp = await pool.query("DELETE FROM messages WHERE id = $1 RETURNING *", [id]);

        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ message: "Message not found after checks." });
        }

        res.status(200).json({ message: `Message with ID ${id} deleted successfully.` });

    } catch (error) {
        console.error('Error deleting message:', error.message);
        res.status(500).json({ message: error.message || 'Server error deleting message.' });
    }
});

module.exports = router;
