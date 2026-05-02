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
  
  let client;
  try {
    client = await pool.connect();
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

// ============ 数据初始化 API ============

// 初始化示例商品数据
app.post('/api/init-demo', async (req, res) => {
  if (!pool) return res.status(500).json({ error: '数据库未连接' });
  try {
    const demoProducts = [
      { name: '兰蔻小黑瓶精华液 50ml', sku: 'LANCOME-001', warehouse: 'us', price: 26, retail_price: 32, stock: 156, unit: '件', image: '💧', currency: '$', currency_name: 'USD', specs: { brand: 'Lancôme', origin: '法国', size: '50ml', expiry: '2026年后' }, description: 'Lancôme Génifique 小黑瓶精华液，蕴含7大益生元及酵母精粹，唤醒肌肤年轻活力。' },
      { name: '雅诗兰黛小棕瓶眼霜 15ml', sku: 'ESTEE-001', warehouse: 'us', price: 22, retail_price: 28, stock: 89, unit: '件', image: '👁️', currency: '$', currency_name: 'USD', specs: { brand: 'Estée Lauder', origin: '美国', size: '15ml', expiry: '2025年后' }, description: 'Advanced Night Repair 修护精华眼霜，深层修护眼周肌肤。' },
      { name: 'Nike Air Max 270 运动鞋', sku: 'NIKE-270', warehouse: 'us', price: 35, retail_price: 45, stock: 45, unit: '双', image: '👟', currency: '$', currency_name: 'USD', specs: { brand: 'Nike', origin: '越南', size: '标准码', expiry: '长期有效' }, description: 'Air Max 270 男子运动鞋，舒适透气。' },
      { name: 'Apple AirPods Pro 2代', sku: 'APPLE-APP2', warehouse: 'us', price: 68, retail_price: 89, stock: 23, unit: '个', image: '🎧', currency: '$', currency_name: 'USD', specs: { brand: 'Apple', origin: '中国', size: '标准版', expiry: '长期有效' }, description: 'AirPods Pro (第二代)，主动降噪，自适应通透模式。' },
      { name: 'SK-II神仙水 230ml', sku: 'SKII-230', warehouse: 'uk', price: 55, retail_price: 68, stock: 67, unit: '件', image: '💎', currency: '£', currency_name: 'GBP', specs: { brand: 'SK-II', origin: '日本', size: '230ml', expiry: '2026年后' }, description: 'SK-II PITERA™ 护肤精华露，肌肤焕亮秘密。' },
      { name: '戴森吹风机 HD03', sku: 'DYSON-HD03', warehouse: 'uk', price: 185, retail_price: 229, stock: 12, unit: '台', image: '💨', currency: '£', currency_name: 'GBP', specs: { brand: 'Dyson', origin: '马来西亚', size: 'HD03', expiry: '长期有效' }, description: 'Dyson Supersonic 吹风机，快速干发，智能温控。' },
      { name: 'Adidas Ultraboost 22', sku: 'ADIDAS-UB22', warehouse: 'uk', price: 35, retail_price: 42, stock: 34, unit: '双', image: '👟', currency: '£', currency_name: 'GBP', specs: { brand: 'Adidas', origin: '越南', size: '标准码', expiry: '长期有效' }, description: 'Adidas Ultraboost 22 跑步鞋，Boost中底。' },
      { name: '香奈儿5号香水 50ml', sku: 'CHANEL-5', warehouse: 'uk', price: 60, retail_price: 75, stock: 28, unit: '瓶', image: '🌸', currency: '£', currency_name: 'GBP', specs: { brand: 'CHANEL', origin: '法国', size: '50ml', expiry: '2027年后' }, description: 'CHANEL N°5 女士香水 EDP，经典永恒。' },
      { name: '小米手环7 Pro', sku: 'XIAOMI-HB7', warehouse: 'de', price: 22, retail_price: 28, stock: 120, unit: '个', image: '⌚', currency: '€', currency_name: 'EUR', specs: { brand: '小米', origin: '中国', size: '标准版', expiry: '长期有效' }, description: '小米手环 7 Pro，全彩 AMOLED 屏幕。' },
      { name: '无印良品香薰机', sku: 'MUJI-Aroma', warehouse: 'de', price: 10, retail_price: 12, stock: 56, unit: '台', image: '🕯️', currency: '€', currency_name: 'EUR', specs: { brand: 'MUJI', origin: '中国', size: '标准版', expiry: '长期有效' }, description: 'MUJI 超声波香薰机，静音设计。' },
      { name: 'LV 经典手提包', sku: 'LV-001', warehouse: 'de', price: 380, retail_price: 450, stock: 5, unit: '个', image: '👜', currency: '€', currency_name: 'EUR', specs: { brand: 'Louis Vuitton', origin: '法国', size: '中号', expiry: '长期有效' }, description: 'Louis Vuitton Neverfull 中号手袋，经典花纹。' },
      { name: '飞利浦电动牙刷', sku: 'PHILIPS-9330', warehouse: 'de', price: 23, retail_price: 28, stock: 78, unit: '支', image: '🪥', currency: '€', currency_name: 'EUR', specs: { brand: 'Philips', origin: '中国', size: '标准版', expiry: '长期有效' }, description: 'Philips Sonicare Diamond Clean Smart，智能刷牙模式。' },
    ];

    let imported = 0;
    for (const p of demoProducts) {
      await pool.query(
        `INSERT INTO products 
         (name, sku, warehouse, price, retail_price, stock, unit, image,
          currency, currency_name, specs, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (sku) DO UPDATE SET
         name=EXCLUDED.name, warehouse=EXCLUDED.warehouse, 
         price=EXCLUDED.price, retail_price=EXCLUDED.retail_price,
         stock=EXCLUDED.stock, updated_at=CURRENT_TIMESTAMP`,
        [p.name, p.sku, p.warehouse, p.price, p.retail_price, p.stock, 
         p.unit, p.image, p.currency, p.currency_name, JSON.stringify(p.specs), p.description]
      );
      imported++;
    }

    res.json({ success: true, message: `成功导入 ${imported} 个示例商品` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '初始化失败' });
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
