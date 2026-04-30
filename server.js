const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// PostgreSQL 连接配置
let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000
  });
  pool.on('error', (err) => {
    console.error('Unexpected database error:', err);
  });
} else {
  console.warn('DATABASE_URL not set, using mock mode');
}

// 初始化数据库
async function initDatabase() {
  if (!pool) {
    console.log('No database, skipping initialization');
    return;
  }
  
  try {
    const client = await pool.connect();
    console.log('✅ 数据库连接成功');
    // 创建商品表
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        sku VARCHAR(100) UNIQUE,
        warehouse VARCHAR(50) DEFAULT 'us',
        price DECIMAL(10,2) NOT NULL,
        retail_price DECIMAL(10,2),
        stock INTEGER DEFAULT 0,
        unit VARCHAR(50) DEFAULT '件',
        image TEXT,
        currency VARCHAR(10) DEFAULT '$',
        currency_name VARCHAR(20) DEFAULT 'USD',
        specs JSONB,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建客户表
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'customer',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建管理员表
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建订单表
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id),
        products JSONB NOT NULL,
        total DECIMAL(10,2),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建默认管理员（如果不存在）
    const adminResult = await client.query(
      "SELECT id FROM admins WHERE username = 'admin'"
    );
    if (adminResult.rows.length === 0) {
      await client.query(
        "INSERT INTO admins (username, password) VALUES ('admin', 'admin123')"
      );
      console.log('✅ 默认管理员已创建: admin / admin123');
    }

    console.log('✅ 数据库表初始化完成');
  } finally {
    client.release();
  }
}

// ============ 商品 API ============

// 获取所有商品
app.get('/api/products', async (req, res) => {
  if (!pool) return res.status(500).json({ error: '数据库未连接' });
  try {
    const result = await pool.query(
      'SELECT * FROM products ORDER BY id DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取商品失败' });
  }
});

// 获取单个商品
app.get('/api/products/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: '数据库未连接' });
  try {
    const result = await pool.query(
      'SELECT * FROM products WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '商品不存在' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取商品失败' });
  }
});

// 添加商品
app.post('/api/products', async (req, res) => {
  if (!pool) return res.status(500).json({ error: '数据库未连接' });
  try {
    const {
      name, sku, warehouse, price, retailPrice,
      stock, unit, image, currency, currencyName,
      specs, description
    } = req.body;

    const result = await pool.query(
      `INSERT INTO products 
       (name, sku, warehouse, price, retail_price, stock, unit, image, 
        currency, currency_name, specs, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [name, sku, warehouse, price, retailPrice, stock, unit, image,
       currency, currencyName, JSON.stringify(specs), description]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '添加商品失败' });
  }
});

// 更新商品
app.put('/api/products/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: '数据库未连接' });
  try {
    const {
      name, sku, warehouse, price, retailPrice,
      stock, unit, image, currency, currencyName,
      specs, description
    } = req.body;

    const result = await pool.query(
      `UPDATE products SET 
       name=$1, sku=$2, warehouse=$3, price=$4, retail_price=$5,
       stock=$6, unit=$7, image=$8, currency=$9, currency_name=$10,
       specs=$11, description=$12, updated_at=CURRENT_TIMESTAMP
       WHERE id=$13 RETURNING *`,
      [name, sku, warehouse, price, retailPrice, stock, unit, image,
       currency, currencyName, JSON.stringify(specs), description, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '商品不存在' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '更新商品失败' });
  }
});

// 删除商品
app.delete('/api/products/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: '数据库未连接' });
  try {
    const result = await pool.query(
      'DELETE FROM products WHERE id=$1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '商品不存在' });
    }
    res.json({ message: '删除成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '删除商品失败' });
  }
});

// 批量导入商品
app.post('/api/products/import', async (req, res) => {
  if (!pool) return res.status(500).json({ error: '数据库未连接' });
  try {
    const { products } = req.body;
    const results = [];

    for (const p of products) {
      const result = await pool.query(
        `INSERT INTO products 
         (name, sku, warehouse, price, retail_price, stock, unit, image,
          currency, currency_name, specs, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (sku) DO UPDATE SET
         name=EXCLUDED.name, warehouse=EXCLUDED.warehouse, 
         price=EXCLUDED.price, retail_price=EXCLUDED.retail_price,
         stock=EXCLUDED.stock, updated_at=CURRENT_TIMESTAMP
         RETURNING *`,
        [p.name, p.sku, p.warehouse, p.price, p.retailPrice, p.stock, 
         p.unit, p.image, p.currency, p.currencyName, 
         JSON.stringify(p.specs || {}), p.desc]
      );
      results.push(result.rows[0]);
    }

    res.json({ message: `成功导入 ${results.length} 个商品`, products: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '导入失败' });
  }
});

// ============ 管理员 API ============

// 管理员登录
app.post('/api/admin/login', async (req, res) => {
  if (!pool) return res.status(500).json({ error: '数据库未连接' });
  try {
    const { username, password } = req.body;
    const result = await pool.query(
      'SELECT id, username FROM admins WHERE username=$1 AND password=$2',
      [username, password]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    
    res.json({ 
      success: true, 
      token: 'admin-token-' + Date.now(),
      user: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '登录失败' });
  }
});

// ============ 客户 API ============

// 客户注册
app.post('/api/customers/register', async (req, res) => {
  if (!pool) return res.status(500).json({ error: '数据库未连接' });
  try {
    const { username, password } = req.body;
    
    const result = await pool.query(
      'INSERT INTO customers (username, password) VALUES ($1, $2) RETURNING id, username',
      [username, password]
    );
    
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: '用户名已存在' });
    }
    console.error(err);
    res.status(500).json({ error: '注册失败' });
  }
});

// 客户登录
app.post('/api/customers/login', async (req, res) => {
  if (!pool) return res.status(500).json({ error: '数据库未连接' });
  try {
    const { username, password } = req.body;
    const result = await pool.query(
      'SELECT id, username FROM customers WHERE username=$1 AND password=$2',
      [username, password]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    
    res.json({ 
      success: true, 
      token: 'customer-token-' + Date.now(),
      user: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '登录失败' });
  }
});

// ============ 订单 API ============

// 创建订单
app.post('/api/orders', async (req, res) => {
  if (!pool) return res.status(500).json({ error: '数据库未连接' });
  try {
    const { customerId, products, total } = req.body;
    
    const result = await pool.query(
      `INSERT INTO orders (customer_id, products, total) 
       VALUES ($1, $2, $3) RETURNING *`,
      [customerId, JSON.stringify(products), total]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '创建订单失败' });
  }
});

// 获取订单列表（管理员）
app.get('/api/orders', async (req, res) => {
  if (!pool) return res.status(500).json({ error: '数据库未连接' });
  try {
    const result = await pool.query(
      `SELECT o.*, c.username as customer_name 
       FROM orders o 
       LEFT JOIN customers c ON o.customer_id = c.id
       ORDER BY o.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取订单失败' });
  }
});

// 获取客户订单
app.get('/api/orders/:customerId', async (req, res) => {
  if (!pool) return res.status(500).json({ error: '数据库未连接' });
  try {
    const result = await pool.query(
      'SELECT * FROM orders WHERE customer_id=$1 ORDER BY created_at DESC',
      [req.params.customerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取订单失败' });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 启动服务
async function start() {
  await initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 服务器运行在端口 ${PORT}`);
  });
}

start().catch(console.error);
