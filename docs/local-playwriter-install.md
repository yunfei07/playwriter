# Playwriter 本地安装与 Agent 使用指南（未发布版本）

本指南用于: 你在本地源码仓库中使用 Playwriter，不依赖 npm 已发布版本。

## 1. 前置准备

- 已安装 `Node.js`（建议 18+）
- 已安装 `pnpm`
- 已安装 Chrome，并安装 Playwriter 扩展

## 2. 拉起本地开发版本

在仓库根目录执行:

```bash
cd /Users/yangyunfei/Learning/ai/agents/playwriter
pnpm bootstrap
pnpm --dir playwriter build
```

说明:
- `bootstrap` 会初始化子模块并安装依赖
- `build` 会生成 `playwriter/dist/*`（MCP/CLI 实际运行入口）

## 3. 本地运行方式

### 方式 A（推荐）: 直接使用本地 dist 入口

```bash
node /Users/yangyunfei/Learning/ai/agents/playwriter/playwriter/dist/cli.js --help
node /Users/yangyunfei/Learning/ai/agents/playwriter/playwriter/dist/cli.js session new
```

### 方式 B: 本地 link 成全局命令

```bash
cd /Users/yangyunfei/Learning/ai/agents/playwriter/playwriter
pnpm build
npm link
playwriter --help
```

## 4. 在 Agent 中配置 MCP（本地版）

将以下配置加入 Agent 的 MCP 配置文件:

```json
{
  "mcpServers": {
    "playwriter": {
      "command": "node",
      "args": [
        "/Users/yangyunfei/Learning/ai/agents/playwriter/playwriter/dist/cli.js"
      ]
    }
  }
}
```

建议: 不要在生产使用 `tsx src/mcp.ts`，优先使用 `dist/cli.js`。

## 5. 在 Agent 中配置 skill 用法

给 Agent 一条规则即可:

```text
使用 playwriter 前先执行 playwriter skill，然后使用 playwriter MCP 工具执行浏览器自动化。
```

## 6. 批量 JSON 用例: 先配置一次默认参数

### 第一步: 只做一次

调用 MCP 工具 `configure_json_testcase_batch_defaults`:

```json
{
  "jsonPath": "./cases/order.json",
  "batchSize": 10,
  "batchIndex": 0,
  "outDir": "./generated-regression"
}
```

### 第二步: 每次只传批次号

调用 MCP 工具 `run_json_testcase_batch`:

```json
{
  "batchIndex": 0
}
```

下一批:

```json
{
  "batchIndex": 1
}
```

## 7. 常见问题

### 1) MCP 连接失败 / Connection closed

- 确认已执行 `pnpm --dir playwriter build`
- 确认 MCP 指向 `dist/cli.js`
- 确认 Chrome 已打开，且扩展在目标标签页已启用

### 2) 找不到生成目录

- `outDir` 建议使用绝对路径
- 相对路径默认相对 MCP 进程工作目录

### 3) 修改代码后不生效

- 重新执行:

```bash
pnpm --dir playwriter build
```

- 然后重启 Agent / 重新连接 MCP
