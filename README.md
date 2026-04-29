# 海外仓掌柜 API

后端服务，提供商品管理、客户管理、订单管理等功能。

## 部署到 Railway

1. Fork 本仓库到您的 GitHub
2. 登录 [Railway](https://railway.app)
3. 点击 "New Project" → "Deploy from GitHub repo"
4. 选择本仓库
5. 添加 PostgreSQL 数据库：
   - 在项目面板点击 "Add Plugin"
   - 选择 "PostgreSQL"
6. 部署完成！

## 默认账号

- **管理员**: admin / admin123

## API 端点

### 商品
- `GET /api/products` - 获取所有商品
- `GET /api/products/:id` - 获取单个商品
- `POST /api/products` - 添加商品
- `PUT /api/products/:id` - 更新商品
- `DELETE /api/products/:id` - 删除商品
- `POST /api/products/import` - 批量导入

### 管理
- `POST /api/admin/login` - 管理员登录

### 客户
- `POST /api/customers/register` - 客户注册
- `POST /api/customers/login` - 客户登录

### 订单
- `POST /api/orders` - 创建订单
- `GET /api/orders` - 获取所有订单（管理员）
- `GET /api/orders/:customerId` - 获取客户订单
