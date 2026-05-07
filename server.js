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

// ============ 管理员重置 API（临时） ============

// 重置管理员账号 - 创建或更新admin/admin123
app.post('/api/reset-admin', async (req, res) => {
  if (!pool) return res.status(500).json({ error: '数据库未连接' });
  try {
    // 先删除现有管理员
    await pool.query("DELETE FROM admins WHERE username = 'admin'");
    // 创建新管理员
    await pool.query(
      "INSERT INTO admins (username, password) VALUES ('admin', 'admin123')"
    );
    console.log('✅ 管理员重置成功: admin / admin123');
    res.json({ success: true, message: '管理员账号已重置为 admin/admin123' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '重置失败: ' + err.message });
  }
});

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

// 批量导入商品数据
app.post('/api/import-csv', async (req, res) => {
  if (!pool) return res.status(500).json({ error: '数据库未连接' });
  try {
    const { products } = req.body;
    if (!products || !Array.isArray(products)) {
      return res.status(400).json({ error: '无效的商品数据' });
    }
    
    let imported = 0, updated = 0;
    for (const p of products) {
      // 仓库映射
      const warehouseMap = { '美国仓': 'us', '英国仓': 'uk', '德国仓': 'de' };
      const warehouse = warehouseMap[p.warehouse] || 'us';
      
      // 货币映射
      const currencyMap = { 'us': '$', 'uk': '£', 'de': '€' };
      const currencyNameMap = { 'us': 'USD', 'uk': 'GBP', 'de': 'EUR' };
      const currency = currencyMap[warehouse];
      const currency_name = currencyNameMap[warehouse];
      
      const result = await pool.query(
        `INSERT INTO products 
         (name, sku, warehouse, price, retail_price, stock, unit, image, currency, currency_name, specs, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (sku) DO UPDATE SET
         name=EXCLUDED.name, warehouse=EXCLUDED.warehouse, 
         price=EXCLUDED.price, retail_price=EXCLUDED.retail_price,
         stock=EXCLUDED.stock, unit=EXCLUDED.unit,
         specs=EXCLUDED.specs, description=EXCLUDED.description,
         updated_at=CURRENT_TIMESTAMP`,
        [p.name, p.sku, warehouse, p.price, p.retailPrice || 0, p.stock || 0, p.unit || '件', '📦', currency, currency_name, JSON.stringify(p.specs || {}), p.description || '']
      );
      
      if (result.rowCount === 1) imported++;
      else updated++;
    }

    res.json({ success: true, message: `导入成功: ${imported} 个新增, ${updated} 个更新` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '导入失败: ' + err.message });
  }
});

// 初始化示例商品数据
app.post('/api/init-demo', async (req, res) => {
  if (!pool) return res.status(500).json({ error: '数据库未连接' });
  try {
    const demoProducts = [
      { name: '摇椅', sku: '001', warehouse: 'us', price: 380, retail_price: 210, stock: 10, unit: '件', specs: { size: '138*14*85/54*6*34', weight: '13/27磅' }, description: '尺寸:138*14*85/54*6*34; 重量:13/27磅' },
      { name: '滚筒款2层-白架-黄木纹板', sku: '002', warehouse: 'us', price: 200, retail_price: 110, stock: 10, unit: '件', specs: { size: '105*65.5*7.5/41*26*3', weight: '9.02磅' }, description: '尺寸:105*65.5*7.5/41*26*3; 重量:9.02磅' },
      { name: '滚筒款2层-黑架+古橡木板', sku: '003', warehouse: 'us', price: 200, retail_price: 110, stock: 10, unit: '件', specs: {}, description: '' },
      { name: '滚筒款3层-白架-黄木纹板', sku: '004', warehouse: 'us', price: 210, retail_price: 113, stock: 10, unit: '件', specs: { size: '105*65.5*9/41*26*3.5', weight: '11.12磅' }, description: '尺寸:105*65.5*9/41*26*3.5; 重量:11.12磅' },
      { name: '【升级实木腿】大杉胡桃色40*35*70', sku: '005', warehouse: 'us', price: 200, retail_price: 102.5, stock: 10, unit: '件', specs: { size: '49*43*13', weight: '7.3-7.95磅' }, description: '尺寸:49*43*13; 重量:7.3-7.95磅' },
      { name: '户外休闲多功能折叠床55.8黑+珍珠垫', sku: '006', warehouse: 'us', price: 140, retail_price: 105, stock: 10, unit: '件', specs: { size: '68*58*11', weight: '4.45/7.23磅' }, description: '尺寸:68*58*11; 重量:4.45/7.23磅' },
      { name: '洞洞板置物架黑色四层', sku: '007', warehouse: 'us', price: 320, retail_price: 395, stock: 10, unit: '件', specs: { size: '34*40*66', weight: '16.5磅' }, description: '尺寸:34*40*66; 重量:16.5磅' },
      { name: '洞洞板置物架白色四层', sku: '008', warehouse: 'us', price: 340, retail_price: 0, stock: 10, unit: '件', specs: { size: '34*40*66', weight: '16.5磅' }, description: '尺寸:34*40*66; 重量:16.5磅' },
      { name: '洞洞板置物架白色五层', sku: '009', warehouse: 'us', price: 340, retail_price: 0, stock: 10, unit: '件', specs: { size: '44*40*76', weight: '18.5磅' }, description: '尺寸:44*40*76; 重量:18.5磅' },
      { name: '洞洞板置物架黑色五层', sku: '010', warehouse: 'us', price: 340, retail_price: 0, stock: 10, unit: '件', specs: { size: '44*40*76', weight: '18.5磅' }, description: '尺寸:44*40*76; 重量:18.5磅' },
      { name: '多功能储物沥水篮白色55', sku: '011', warehouse: 'us', price: 220, retail_price: 325, stock: 5, unit: '件', specs: { size: '78*22*36', weight: '6.2/10.3磅' }, description: '尺寸:78*22*36; 重量:6.2/10.3磅' },
      { name: '多功能储物沥水篮黑色55', sku: '012', warehouse: 'us', price: 220, retail_price: 0, stock: 5, unit: '件', specs: { size: '78*22*36', weight: '6.2/10.3磅' }, description: '尺寸:78*22*36; 重量:6.2/10.3磅' },
      { name: '多功能储物沥水篮白色65', sku: '013', warehouse: 'us', price: 220, retail_price: 0, stock: 5, unit: '件', specs: { size: '78*22*36', weight: '6.2/10.3磅' }, description: '尺寸:78*22*36; 重量:6.2/10.3磅' },
      { name: '多功能储物沥水篮黑色65', sku: '014', warehouse: 'us', price: 220, retail_price: 0, stock: 5, unit: '件', specs: { size: '78*22*36', weight: '6.2/10.3磅' }, description: '尺寸:78*22*36; 重量:6.2/10.3磅' },
      { name: '马桶坐便改蹲便蹲', sku: '015', warehouse: 'us', price: 130, retail_price: 95, stock: 10, unit: '件', specs: { size: '44*50*11', weight: '4.25磅' }, description: '尺寸:44*50*11; 重量:4.25磅' },
      { name: '折叠可移动小推车置物架', sku: '016', warehouse: 'us', price: 120, retail_price: 115, stock: 10, unit: '件', specs: { size: '73*50*12', weight: '3.65/7.3磅' }, description: '尺寸:73*50*12; 重量:3.65/7.3磅' },
      { name: '厨房用品免安装折叠白色三层', sku: '017', warehouse: 'us', price: 140, retail_price: 130, stock: 10, unit: '件', specs: { size: '89*40*9', weight: '5/5.34磅' }, description: '尺寸:89*40*9; 重量:5/5.34磅' },
      { name: '厨房用品免安装折叠黑色三层', sku: '018', warehouse: 'us', price: 140, retail_price: 0, stock: 10, unit: '件', specs: { size: '89*40*9', weight: '5/5.34磅' }, description: '尺寸:89*40*9; 重量:5/5.34磅' },
      { name: '厨房用品免安装折叠白色四层', sku: '019', warehouse: 'us', price: 140, retail_price: 0, stock: 10, unit: '件', specs: { size: '89*40*9', weight: '6/6.34磅' }, description: '尺寸:89*40*9; 重量:6/6.34磅' },
      { name: '厨房用品免安装折叠黑色四层', sku: '020', warehouse: 'us', price: 140, retail_price: 0, stock: 10, unit: '件', specs: { size: '89*40*9', weight: '6/6.34磅' }, description: '尺寸:89*40*9; 重量:6/6.34磅' },
      { name: '灰色圆管【中宽-珍珠垫】', sku: '021', warehouse: 'us', price: 190, retail_price: 210, stock: 10, unit: '件', specs: { size: '114*25*19', weight: '7.05/9.02磅' }, description: '尺寸:114*25*19; 重量:7.05/9.02磅' },
      { name: '黑架+【雪山白岩板】60+45组合', sku: '022', warehouse: 'us', price: 410, retail_price: 370, stock: 5, unit: '件', specs: { size: '64*64*48', weight: '18/33磅' }, description: '尺寸:64*64*48; 重量:18/33磅' },
      { name: '爆款:直径60cm【高度45cm】', sku: '023', warehouse: 'us', price: 410, retail_price: 0, stock: 5, unit: '件', specs: { size: '64*64*48', weight: '10/33磅' }, description: '尺寸:64*64*48; 重量:10/33磅' },
      { name: '滚筒洗衣机置物架三层', sku: '024', warehouse: 'us', price: 180, retail_price: 110, stock: 5, unit: '件', specs: { size: '100*43*10', weight: '8磅' }, description: '尺寸:100*43*10; 重量:8磅' },
      { name: '滚筒洗衣机置物架二层', sku: '025', warehouse: 'us', price: 160, retail_price: 110, stock: 5, unit: '件', specs: { size: '100*43*10', weight: '6.1磅' }, description: '尺寸:100*43*10; 重量:6.1磅' },
      { name: '带挂钩洗衣机架两层黑色', sku: '026', warehouse: 'us', price: 36, retail_price: 105, stock: 16, unit: '件', specs: { size: '74.5*20*11', weight: '2.17磅' }, description: '尺寸:74.5*20*11; 重量:2.17磅' },
      { name: '带挂钩洗衣机架两层白色', sku: '027', warehouse: 'us', price: 36, retail_price: 105, stock: 16, unit: '件', specs: { size: '74.5*20*11', weight: '2.17磅' }, description: '尺寸:74.5*20*11; 重量:2.17磅' },
      { name: '旋转凳', sku: '028', warehouse: 'us', price: 119, retail_price: 175, stock: 10, unit: '件', specs: { size: '40*40*55', weight: '4磅' }, description: '尺寸:40*40*55; 重量:4磅' },
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
         stock=EXCLUDED.stock, unit=EXCLUDED.unit,
         specs=EXCLUDED.specs, description=EXCLUDED.description,
         updated_at=CURRENT_TIMESTAMP`,
        [p.name, p.sku, p.warehouse, p.price, p.retail_price, p.stock, 
         p.unit, '📦', '$', 'USD', JSON.stringify(p.specs), p.description]
      );
      imported++;
    }

    res.json({ success: true, message: `成功导入 ${imported} 个美国仓商品` });
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
