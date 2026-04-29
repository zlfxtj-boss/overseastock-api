# 海外仓掌柜 API

后端服务，提供商品管理、客户管理、订单管理等功能。

## 快速部署

### 方式一：Railway CLI（本地部署）

```bash
# 1. 安装 Railway CLI
npm install -g @railway/cli

# 2. 登录 Railway
railway login

# 3. 进入项目目录并初始化
cd overseastock-api
railway init

# 4. 添加 PostgreSQL 数据库
railway add postgresql

# 5. 部署
railway up

# 6. 查看状态
railway status
```

### 方式二：GitHub Actions（自动部署）

1. 在 Railway 生成 Token：
   - 访问 https://railway.app/account
   - 创建新 Token
   
2. 在 GitHub 仓库添加 Secret：
   - Settings → Secrets and variables → Actions
   - 添加 `RAILWAY_TOKEN`
   
3. 推送代码后自动部署！

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
