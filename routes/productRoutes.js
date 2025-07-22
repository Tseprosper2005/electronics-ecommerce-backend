// backend/routes/productRoutes.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db'); // Import the database pool
const { authenticateToken, isAdmin } = require('../middleware/authMiddleware'); // Import auth middleware

// Helper function to convert numeric strings to floats
const parseProductNumerics = (product) => {
    if (product) {
        if (typeof product.price === 'string') {
            product.price = parseFloat(product.price);
        }
        if (typeof product.stock_quantity === 'string') { // Although INTEGER, sometimes can be string depending on driver/context
            product.stock_quantity = parseInt(product.stock_quantity);
        }
    }
    return product;
};

// Helper function to convert an array of products
const parseProductsNumerics = (products) => {
    return products.map(parseProductNumerics);
};


// 1. Create Product (Admin only)
router.post('/', authenticateToken, isAdmin, async (req, res) => {
    const { name, description, price, category, stock_quantity, image_url } = req.body;

    // Basic validation
    if (!name || !price || !category || stock_quantity === undefined || stock_quantity === null) {
        return res.status(400).json({ message: 'Name, price, category, and stock quantity are required.' });
    }
    if (price < 0 || stock_quantity < 0) {
        return res.status(400).json({ message: 'Price and stock quantity cannot be negative.' });
    }

    try {
        const newProduct = await pool.query(
            "INSERT INTO products (name, description, price, category, stock_quantity, image_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
            [name, description, price, category, stock_quantity, image_url]
        );
        res.status(201).json(parseProductNumerics(newProduct.rows[0])); // Parse before sending
    } catch (error) {
        console.error('Error creating product:', error.message);
        res.status(500).json({ message: 'Server error creating product.' });
    }
});

// 2. Get all Products (Publicly accessible)
router.get('/', async (req, res) => {
    try {
        const allProducts = await pool.query("SELECT * FROM products ORDER BY created_at DESC");
        res.json(parseProductsNumerics(allProducts.rows)); // Parse before sending
    }
    catch (error) {
        console.error('Error fetching all products:', error.message);
        res.status(500).json({ message: 'Server error fetching products.' });
    }
});

// 3. Get a single product by ID (Publicly accessible)
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const product = await pool.query("SELECT * FROM products WHERE id = $1", [id]);

        if (product.rows.length === 0) {
            return res.status(404).json({ message: "Product not found." });
        }
        res.json(parseProductNumerics(product.rows[0])); // Parse before sending
    } catch (error) {
        console.error('Error fetching single product:', error.message);
        res.status(500).json({ message: 'Server error fetching product.' });
    }
});

// 4. Update a product by ID (Admin only)
router.put('/:id', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, description, price, category, stock_quantity, image_url } = req.body;

    // Basic validation
    if (!name || !price || !category || stock_quantity === undefined || stock_quantity === null) {
        return res.status(400).json({ message: 'Name, price, category, and stock quantity are required for update.' });
    }
    if (price < 0 || stock_quantity < 0) {
        return res.status(400).json({ message: 'Price and stock quantity cannot be negative.' });
    }

    try {
        const updatedProduct = await pool.query(
            "UPDATE products SET name = $1, description = $2, price = $3, category = $4, stock_quantity = $5, image_url = $6, updated_at = NOW() WHERE id = $7 RETURNING *",
            [name, description, price, category, stock_quantity, image_url, id]
        );

        if (updatedProduct.rows.length === 0) {
            return res.status(404).json({ message: "Product not found." });
        }
        res.json(parseProductNumerics(updatedProduct.rows[0])); // Parse before sending
    } catch (error) {
        console.error('Error updating product:', error.message);
        res.status(500).json({ message: 'Server error updating product.' });
    }
});

// 5. Delete a product by ID (Admin only)
router.delete('/:id', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const deleteOp = await pool.query("DELETE FROM products WHERE id = $1 RETURNING *", [id]);

        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ message: "Product not found." });
        }
        res.status(200).json({ message: `Product with id ${id} deleted successfully.` });
    } catch (error) {
        console.error('Error deleting product:', error.message);
        // Check for foreign key constraint violation (e.g., product is part of an order)
        if (error.code === '23503') { // PostgreSQL foreign key violation error code
            return res.status(400).json({ message: "Cannot delete product because it is referenced in existing orders." });
        }
        res.status(500).json({ message: 'Server error deleting product.' });
    }
});

module.exports = router;
