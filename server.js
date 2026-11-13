const express = require('express');
const sql = require('mssql/msnodesqlv8');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.get(['/', '/index.html'], (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// 1. Microsoft SQL Server Configuration
const dbConfig = {
    server: 'Masthan\\SQLEXPRESS', 
    database: 'TShirtStoreDB',
    driver: 'ODBC Driver 18 for SQL Server',
    options: {
        trustedConnection: true,
        trustServerCertificate: true
    }
};

let pool; // Global connection pool

// 2. Connect to MSSQL, Create Table & Seed 10 Initial T-Shirts
async function initializeDatabase() {
    try {
        pool = await sql.connect(dbConfig);
        console.log('Connected to Microsoft SQL Server.');

        // Create products table if it does not exist (T-SQL syntax)
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='products' AND xtype='U')
            CREATE TABLE products (
                id INT IDENTITY(1,1) PRIMARY KEY,
                name NVARCHAR(255) NOT NULL,
                price DECIMAL(10, 2) NOT NULL,
                quantity INT NOT NULL,
                image NVARCHAR(500),
                description NVARCHAR(1000)
            )
        `);

        // Add the description column to existing product tables.
        await pool.request().query(`
            IF COL_LENGTH('products', 'description') IS NULL
            ALTER TABLE products ADD description NVARCHAR(1000) NULL
        `);

        // Check if table is empty; if so, insert 10 sample T-shirts
        const countResult = await pool.request().query('SELECT COUNT(*) AS count FROM products');
        if (countResult.recordset[0].count === 0) {
            for (let i = 1; i <= 10; i++) {
                await pool.request()
                    .input('name', sql.NVarChar, `Classic Cotton Tee - Model ${i}`)
                    .input('price', sql.Decimal(10, 2), 499 + (i * 50))
                    .input('quantity', sql.Int, 15)
                    .input('image', sql.NVarChar, `https://placehold.co/300x300/222/fff?text=T-Shirt+Model+${i}`)
                    .query('INSERT INTO products (name, price, quantity, image) VALUES (@name, @price, @quantity, @image)');
            }
            console.log('Seeded 10 initial T-shirt models into MSSQL.');
        }
    } catch (err) {
        console.error('Database connection failed:', err.message);
    }
}

// --- API ROUTES ---

// GET: Fetch all products
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.request().query('SELECT * FROM products');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST: Add a new T-shirt (Admin)
app.post('/api/products', async (req, res) => {
    const { name, price, quantity, image, description } = req.body;
    const imgUrl = image || 'https://placehold.co/300x300/333/fff?text=New+T-Shirt';

    try {
        const result = await pool.request()
            .input('name', sql.NVarChar, name)
            .input('price', sql.Decimal(10, 2), price)
            .input('quantity', sql.Int, quantity)
            .input('image', sql.NVarChar, imgUrl)
            .input('description', sql.NVarChar, description || '')
            .query(`
                INSERT INTO products (name, price, quantity, image, description) 
                OUTPUT INSERTED.id 
                VALUES (@name, @price, @quantity, @image, @description)
            `);
        
        res.json({ id: result.recordset[0].id, message: 'Product added successfully!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT: Update Price or Stock Quantity (Admin)
app.put('/api/products/:id', async (req, res) => {
    const { price, quantity } = req.body;
    try {
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('price', sql.Decimal(10, 2), price)
            .input('quantity', sql.Int, quantity)
            .query('UPDATE products SET price = @price, quantity = @quantity WHERE id = @id');
        
        res.json({ message: 'Product updated!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE: Remove a product from the catalog (Admin)
app.delete('/api/products/:id', async (req, res) => {
    try {
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM products WHERE id = @id');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: 'Product not found.' });
        }
        res.json({ message: 'Product deleted.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST: Buy a T-shirt - Decreases quantity by 1 (Customer Storefront)
app.post('/api/buy/:id', async (req, res) => {
    try {
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('UPDATE products SET quantity = quantity - 1 WHERE id = @id AND quantity > 0');

        if (result.rowsAffected[0] === 0) {
            return res.status(400).json({ error: 'Out of stock!' });
        }
        res.json({ message: 'Purchase successful!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Initialize DB first, then start the Express server
initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
        console.log(`Store intro: http://localhost:${PORT}/index.html`);
        console.log(`Customer page: http://localhost:${PORT}/public/customer.html`);
        console.log(`Admin Panel: http://localhost:${PORT}/public/admin.html`);
    });
});