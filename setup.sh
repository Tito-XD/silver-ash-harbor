#!/bin/bash
# ============================================================
# Silver Ash Harbor — 一键部署脚本
# 自动完成：安装依赖 → 创建D1 → 初始化表 → 部署Worker
# ============================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Silver Ash Harbor — 一键部署${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

cd "$(dirname "$0")/worker"

# ── Step 1: Install dependencies ───────────────────────────
echo -e "${GREEN}[1/5]${NC} 安装依赖..."
npm install
echo ""

# ── Step 2: Create D1 database ─────────────────────────────
echo -e "${GREEN}[2/5]${NC} 创建 D1 数据库..."
DB_OUTPUT=$(npx wrangler d1 create price-db 2>&1)
echo "$DB_OUTPUT"

# Extract database_id from wrangler output
DB_ID=$(echo "$DB_OUTPUT" | grep "database_id" | head -1 | sed 's/.*=\s*"\(.*\)"/\1/')
if [ -z "$DB_ID" ]; then
  echo -e "${RED}错误: 无法从输出中提取 database_id${NC}"
  echo "请手动运行 'npx wrangler d1 create price-db' 并将 database_id 填入 wrangler.toml"
  exit 1
fi
echo -e "${GREEN}  database_id: ${DB_ID}${NC}"

# ── Step 3: Auto-fill database_id into wrangler.toml ───────
echo -e "${GREEN}[3/5]${NC} 更新 wrangler.toml 配置..."
sed -i.bak "s|database_id = \"\"|database_id = \"${DB_ID}\"|" wrangler.toml
rm -f wrangler.toml.bak
echo "  已将 database_id 写入 wrangler.toml"
echo ""

# ── Step 4: Initialize database (schema + seed) ────────────
echo -e "${GREEN}[4/5]${NC} 初始化数据库表结构..."
npx wrangler d1 execute price-db --remote --file=../schema.sql
echo ""
echo -e "${GREEN}[4/5]${NC} 写入品牌种子数据..."
npx wrangler d1 execute price-db --remote --file=../seed.sql
echo ""

# ── Step 5: Deploy Worker ──────────────────────────────────
echo -e "${GREEN}[5/5]${NC} 部署 Worker 到 Cloudflare..."
npx wrangler deploy
echo ""

# ── Done ───────────────────────────────────────────────────
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}  部署完成！${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "  访问 Dashboard: https://silver-ash-harbor.<你的子域名>.workers.dev"
echo "  手动触发爬取:  curl -X POST https://silver-ash-harbor.<你的子域名>.workers.dev/api/crawl"
echo ""
echo "  Cron 已配置为每 6 小时自动爬取一次。"
echo "  如需调整频率，修改 worker/wrangler.toml 中的 crons 表达式。"
echo ""
