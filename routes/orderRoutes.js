// backend/routes/orderRoutes.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db'); // Import the database pool
const { authenticateToken, isAdmin } = require('../middleware/authMiddleware'); // Import auth middleware

// Helper function to convert numeric strings to floats for order data
const parseOrderNumerics = (order) => {
    if (order) {
        if (typeof order.total_amount === 'string') {
            order.total_amount = parseFloat(order.total_amount);
        }
        // If order has items, parse their price_at_purchase as well
        if (order.items && Array.isArray(order.items)) {
            order.items = order.items.map(item => {
                if (typeof item.price_at_purchase === 'string') {
                    item.price_at_purchase = parseFloat(item.price_at_purchase);
                }
                return item;
            });
        }
    }
    return order;
};

// Helper function to convert an array of orders
const parseOrdersNumerics = (orders) => {
    return orders.map(parseOrderNumerics);
};


// 1. Create a new Order (Authenticated User)
router.post('/', authenticateToken, async (req, res) => {
    const { shipping_address, items } = req.body; // items is an array of { productId, quantity }
    const userId = req.user.userId; // Get user ID from authenticated token

    // Basic validation
    if (!shipping_address || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'Shipping address and at least one item are required.' });
    }

    const client = await pool.connect(); // Get a client from the pool for transaction

    try {
        await client.query('BEGIN'); // Start transaction

        let totalAmount = 0;
        const orderItemsToInsert = [];

        // Validate products, calculate total, and decrement stock within the transaction
        for (const item of items) {
            const productResult = await client.query("SELECT price, stock_quantity FROM products WHERE id = $1 FOR UPDATE", [item.productId]); // FOR UPDATE locks the row
            if (productResult.rows.length === 0) {
                throw new Error(`Product with ID ${item.productId} not found.`);
            }

            const product = productResult.rows[0];
            // Ensure price and stock are parsed as numbers from DB strings
            const productPrice = parseFloat(product.price);
            const productStock = parseInt(product.stock_quantity);

            if (productStock < item.quantity) {
                throw new Error(`Not enough stock for product ID ${item.productId}. Available: ${productStock}, Requested: ${item.quantity}.`);
            }

            totalAmount += productPrice * item.quantity;

            // Add item details to a temporary array for batch insertion later
            orderItemsToInsert.push({
                productId: item.productId,
                quantity: item.quantity,
                priceAtPurchase: productPrice // Use the parsed number
            });

            // Decrement stock in the database
            const newStock = product.stock_quantity - item.quantity;
            await client.query("UPDATE products SET stock_quantity = $1 WHERE id = $2", [newStock, item.productId]);
        }

        // Create the order in the orders table
        const newOrder = await client.query(
            "INSERT INTO orders (user_id, total_amount, shipping_address, payment_status) VALUES ($1, $2, $3, 'pending') RETURNING id, order_date",
            [userId, totalAmount, shipping_address]
        );
        const orderId = newOrder.rows[0].id;

        // Insert each item into the order_items table
        for (const orderItem of orderItemsToInsert) {
             await client.query(
                "INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase) VALUES ($1, $2, $3, $4)",
                [orderId, orderItem.productId, orderItem.quantity, orderItem.priceAtPurchase]
            );
        }

        await client.query('COMMIT'); // Commit the transaction
        res.status(201).json({ message: 'Order created successfully', orderId: orderId, totalAmount: totalAmount });

    } catch (error) {
        await client.query('ROLLBACK'); // Rollback the transaction on any error
        console.error('Error creating order:', error.message);
        res.status(500).json({ message: error.message || 'Server error creating order.' });
    } finally {
        client.release(); // Release the client back to the pool
    }
});

// 2. Get Orders (Authenticated User for their own, Admin for all)
router.get('/', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const userRole = req.user.role;

    try {
        let ordersResult;
        if (userRole === 'admin') {
            // Admin can see all orders with associated username
            ordersResult = await pool.query(
                `SELECT o.id, o.user_id, u.username, o.total_amount, o.status, o.payment_status, o.shipping_address, o.order_date
                 FROM orders o
                 JOIN users u ON o.user_id = u.id
                 ORDER BY o.order_date DESC`
            );
        } else {
            // Regular user sees only their own orders
            ordersResult = await pool.query(
                `SELECT o.id, o.user_id, u.username, o.total_amount, o.status, o.payment_status, o.shipping_address, o.order_date
                 FROM orders o
                 JOIN users u ON o.user_id = u.id
                 WHERE o.user_id = $1
                 ORDER BY o.order_date DESC`,
                [userId]
            );
        }
        res.json(parseOrdersNumerics(ordersResult.rows)); // Parse before sending
    } catch (error) {
        console.error('Error fetching orders:', error.message);
        res.status(500).json({ message: 'Server error fetching orders.' });
    }
});

// 3. Get Order Details by ID (Authenticated User for their own, Admin for any)
router.get('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    try {
        const orderResult = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
        if (orderResult.rows.length === 0) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        const order = orderResult.rows[0];

        // Security check: User can only see their own order, unless they are an admin
        if (userRole !== 'admin' && order.user_id !== userId) {
            return res.status(403).json({ message: 'Access denied. You can only view your own orders.' });
        }

        // Fetch order items for the specific order
        const itemsResult = await pool.query(
            `SELECT oi.quantity, oi.price_at_purchase, p.name, p.image_url
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = $1`,
            [id]
        );

        // Combine order and its items, parsing numeric values
        const fullOrder = { ...order, items: itemsResult.rows };
        res.json(parseOrderNumerics(fullOrder)); // Parse before sending

    } catch (error) {
        console.error('Error fetching order details:', error.message);
        res.status(500).json({ message: 'Server error fetching order details.' });
    }
});

// 4. Update Order Status (Admin only)
router.patch('/:id/status', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // e.g., 'pending', 'processing', 'shipped', 'delivered', 'cancelled'

    const allowedStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!status || !allowedStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid status provided.' });
    }

    try {
        const updatedOrder = await pool.query(
            "UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
            [status, id]
        );

        if (updatedOrder.rows.length === 0) {
            return res.status(404).json({ message: "Order not found." });
        }

        res.json(parseOrderNumerics(updatedOrder.rows[0])); // Parse before sending

    } catch (error) {
        console.error('Error updating order status:', error.message);
        res.status(500).json({ message: 'Server error updating order status.' });
    }
});

// 5. Update Order Payment Status (Admin only - or via webhook)
// This endpoint is primarily for admin manual updates or could be called by a payment webhook simulator
router.patch('/:id/payment-status', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { payment_status } = req.body; // e.g., 'pending', 'completed', 'failed', 'refunded'

    const allowedPaymentStatuses = ['pending', 'completed', 'failed', 'refunded'];
    if (!payment_status || !allowedPaymentStatuses.includes(payment_status)) {
        return res.status(400).json({ message: 'Invalid payment status provided.' });
    }

    try {
        const updatedOrder = await pool.query(
            "UPDATE orders SET payment_status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
            [payment_status, id]
        );

        if (updatedOrder.rows.length === 0) {
            return res.status(404).json({ message: "Order not found." });
        }

        res.json(parseOrderNumerics(updatedOrder.rows[0])); // Parse before sending

    } catch (error) {
        console.error('Error updating order payment status:', error.message);
        res.status(500).json({ message: 'Server error updating order payment status.' });
    }
});

// 6. Delete Order (Admin can delete any, User can delete their own if cancelled)
router.delete('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    const client = await pool.connect(); // Use transaction for cascading delete

    try {
        await client.query('BEGIN');

        // First, get the order to check its status and user_id
        const orderResult = await client.query("SELECT user_id, status FROM orders WHERE id = $1 FOR UPDATE", [id]);
        if (orderResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Order not found.' });
        }

        const order = orderResult.rows[0];

        // Authorization logic
        if (userRole === 'admin') {
            // Admin can delete any order
            console.log(`Admin (User ID: ${userId}) deleting Order ID: ${id}`);
        } else {
            // Regular user can only delete their own order if it's cancelled
            if (order.user_id !== userId) {
                await client.query('ROLLBACK');
                return res.status(403).json({ message: 'Access denied. You can only delete your own orders.' });
            }
            if (order.status !== 'cancelled') {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'Order can only be deleted if its status is "cancelled".' });
            }
            console.log(`User (ID: ${userId}) deleting their cancelled Order ID: ${id}`);
        }

        // Delete order items first (though CASCADE should handle this, explicit is sometimes clearer)
        await client.query("DELETE FROM order_items WHERE order_id = $1", [id]);

        // Delete the order itself
        const deleteOp = await client.query("DELETE FROM orders WHERE id = $1 RETURNING *", [id]);

        if (deleteOp.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: "Order not found after checks." });
        }

        await client.query('COMMIT');
        res.status(200).json({ message: `Order with ID ${id} and its items deleted successfully.` });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting order:', error.message);
        res.status(500).json({ message: error.message || 'Server error deleting order.' });
    } finally {
        client.release();
    }
});


module.exports = router;
