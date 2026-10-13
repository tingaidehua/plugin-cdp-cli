# plugin-cdp-cli

面向 DeepSeek Harness 的多端点 **CDP 中间�?*。提�?`ctx.cdp` 与模型工具：端点/标签列表、JS 求值、CSS/JS 注入、导航、截图�?

[English](README.md) · [DEVELOPMENT.md](DEVELOPMENT.md) · [架构](../docs/ARCHITECTURE.md)

## 安装

```sh
dsh plugin --profile web add /absolute/path/to/agent-plugins/plugin-cdp-cli
```

�?`~/.env` 配置端点�?

```
DSH_CDP_ENDPOINTS=9225,9224
DSH_CDP_DEFAULT_PORT=9225
```

## 冒烟（无需启动 dsh�?

```sh
node scripts/smoke.mjs
```

## 工具

| 工具 | 作用 |
|------|------|
| `cdp_endpoints` | 列出/刷新端点 |
| `cdp_targets` | 列出页面 Target |
| `cdp_evaluate` | 对唯一匹配页执�?`Runtime.evaluate` |
| `cdp_inject` | 注入 CSS/JS |
| `cdp_navigate` | 导航 |
| `cdp_screenshot` | 截图（有大小上限�?|
