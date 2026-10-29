# Viorka Web Console（脚手架）

- React 18 + TypeScript + Vite。
- 当前是**交互/视觉起始页**，仅通过 `/api/v1/version` 检查后端是否启动。
- Nodes、Services、Topology、Tasks 只是设计预览，并非已经实现的功能；UI 特意没有提供假操作按钮。
- `npm install && npm run dev`，Go 服务默认在 `127.0.0.1:8080`，Vite 配置开发代理。
- 构建：`npm run build`。第一次安装依赖后应提交生成的 `package-lock.json`，正式 CI 应从 `npm install` 切换到 `npm ci` 并启用依赖更新自动化。
- 生产方案待 M0 完成：单二进制静态资源嵌入或 Web 由独立静态服务器提供，统一通过 TLS 反向代理访问，默认不启用 CORS `*`。
