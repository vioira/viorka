# Viorka Web Console

React + TypeScript + Vite，使用 pnpm 管理依赖和 Arc 基础组件。

- `pnpm install --frozen-lockfile`
- `pnpm run dev`：默认仅监听本机，`/api` 代理到 `127.0.0.1:8080`。
- `pnpm run typecheck` 和 `pnpm run build`：类型检查和生产构建。

登录页采用居中双栏卡片，左侧为薄荷绿到青柠绿渐变品牌区，右侧使用用户名和密码登录；小屏改为上下排列。默认深色，面板保留浅色切换。
请求实际 `/api/v1/auth/login`，由服务端设置 HttpOnly 会话 Cookie；CSRF token 仅保存在内存，退出时通过 `X-CSRF-Token` 发送。凭证不会写入浏览器存储。
登录成功跳转至受保护的面板总览布局；其余菜单已提供独立页面入口，业务数据和操作尚未接入。未提供第三方登录、注册和找回密码入口。
后端的允许 Origin 必须与浏览器访问地址一致，配置方式见 [开发指南](../docs/GETTING_STARTED.md)。

## 路由与会话

使用 React Router：`/login` 为登录页，`/` 为受保护的面板总览，共享布局下的所有页面沿用会话 loader，未知路径回到根路由。路由 loader 通过 `GET /api/v1/auth/session` 恢复 Cookie 会话，401 跳转登录；网络错误或 5xx 显示可重试错误，不当作退出登录。已登录用户访问登录页会返回根路由。登录、退出成功均使用 replace 导航。

侧栏菜单与页面目录：

| 菜单 | 路径 | 页面目录（`src/views/`） |
| --- | --- | --- |
| 总览 | `/` | `home/` |
| 节点 | `/nodes` | `nodes/` |
| 代理服务 | `/proxy-services` | `proxy-services/` |
| 拓扑与中转 | `/topology` | `topology/` |
| 订阅 | `/subscriptions` | `subscriptions/` |
| 任务中心 | `/tasks` | `tasks/` |
| 审计日志 | `/audit-logs` | `audit-logs/` |
| 系统设置 | `/settings` | `settings/` |

每个目录以默认导出的 `index.tsx` 作为页面入口；新增页面目前只说明尚未接入的功能。会话与退出登录由 `src/layouts/AuthenticatedLayout.tsx` 统一管理，侧栏选中状态随路由变化。

生产静态服务器必须为非 API 的前端路径配置 SPA 回退到 `index.html`，保证直接打开和刷新 `/login` 及所有控制台路径可用；`/api/*` 必须继续交给 Go 服务，不能回退成 HTML。

验证路由与认证请求：`pnpm test`（使用模拟 HTTP 响应验证跳转、会话恢复与失败语义，不替代真实后端联调）。

## 通用 API 请求

所有普通 JSON REST 请求通过 `src/api/client.ts` 的 `apiRequest`，业务路径与 DTO 放在 `src/api/<module>.ts` 中。

底层选择 Ky（基于 Fetch），复用其 JSON、超时、取消和 HTTP 错误处理，避免重复实现底层请求生命周期。当前没有需要 Axios 的特殊适配场景；TanStack Query 属于缓存与服务端状态管理层，等列表缓存、失效刷新等需求明确后再引入。

```ts
import { apiRequest } from '@/api/client';

const result = await apiRequest<NodeList>('/nodes', {
  query: { limit: 20, cursor },
  signal, // 传入 React Router loader 的 request.signal
});

await apiRequest('/auth/logout', {
  method: 'POST',
  csrfToken: session.csrf_token,
  responseType: 'void', // 204 等无数据响应，不尝试解析 JSON
});
```

- 固定请求当前站点的 `/api/v1`；传入规范的 API 相对路径，例如 `/auth/session`。查询参数使用 `query` 自动编码，不拼接 URL。禁止外部 URL 和重定向。
- 默认携带同源 Cookie；写操作通过 `csrfToken` 显式传入当前会话令牌，不使用全局可变令牌或浏览器持久化存储。登录接口本身不需要 CSRF。
- `json` 自动序列化并设置 Content-Type；`headers` 接受标准 HeadersInit；默认 12 秒超时，可用 `timeoutMs` 调整。超时覆盖响应体读取；调用者取消保留原始 abort reason。
- `ApiError` 区分 `http/network/timeout/invalid-response`，HTTP 错误保留 `status/code` 和后端安全 `message`。若响应提供 `X-Request-ID` 或 `Retry-After`，分别保存至 `requestId/retryAfter`。当前后端尚未统一输出 request ID。
- 不自动重试、不跳转页面、不弹 Toast；任务等有副作用操作由业务层决定恢复策略，401 由会话/路由层处理。
- 泛型只提供编译期类型，不等于运行时校验；认证模块单独校验关键 Session 字段。需要严格验证的其它 DTO 应在业务 API 层校验。
- 此方法只覆盖 JSON REST 和无数据响应；SSE、文件下载及流式传输需要各自的生命周期策略，不套用普通请求超时。

## 目录与命名规范

```text
src/
├── api/                  # Ky 通用请求、各业务 API、模块 DTO 和请求测试
├── assets/styles/        # Tailwind 入口、共享主题与字体
├── components/arc/       # Arc 导入组件，保留官方文件结构与 CSS Modules
├── layouts/              # 多页面共用的展示布局
├── router/               # 路由配置、会话 loader、加载/错误反馈及路由测试
├── utils/                # 无业务状态的纯工具，如 cn
├── views/
│   ├── home/index.tsx    # 受保护的总览布局，业务数据尚未接入
│   └── login/index.tsx   # 登录页
├── App.tsx               # 根 Provider 装配
└── main.tsx              # 挂载与全局样式导入
```

- 页面文件夹使用 kebab-case，默认从 `index.tsx` 导出页面，例如 `import LoginPage from '@/views/login'`。组件文件用 PascalCase，普通业务模块用 kebab-case。
- 页面就近管理局部状态；具有独立职责的局部展示模块放到该页面的 `components/`，复杂交互按职责提取为页面 Hook。不要按行数机械拆分，目录嵌套通常控制在 3–4 层。
- 多页面复用的组件才上提到 `components/`；共享布局放 `layouts/`。所有自写页面、布局和业务组件使用 Tailwind，Arc 原有 CSS Modules 保留。
- `api/` 不依赖页面或路由；`router/` 编排 loader 与页面；布局只接收展示内容。测试与被测试模块就近放置。
- DTO 优先与模块 API 放在一起；跨领域共用类型出现后再建 `types/`。可复用 Hook 出现后再建 `hooks/`，不预建空目录。
- `public/image/` 保留现有固定 URL 资源；需要打包导入的图片再放到 `assets/`。Arc 安装配置的样式入口和 utils 别名已同步。

### 状态管理与 Zustand

当前不引入 Zustand，也不创建空 `store/` 或 `context/`：表单输入、提交状态和错误由页面管理，会话由 React Router loader 从服务端读取，不维护第二份全局会话副本。

出现跨页面共享且独立于服务端的客户端状态（例如布局偏好、多页面工作草稿）时，再评估 Zustand，并按业务职责组织 `store/<domain>.ts`。服务端列表缓存、查询去重与失效刷新优先评估 TanStack Query。密码、会话凭证与 CSRF Token 不使用持久化 store。

## 面板布局

`PanelLayout` 提供侧栏、顶栏和单层内容容器，无 macOS 彩色窗口圆点。桌面使用 96px 图标侧栏，用户头像位于侧栏底部，点击 Arc UserMenu 查看身份和退出登录，手机端通过展开按钮显示导航；Escape 收起并返回焦点。支持键盘跳到主要内容、深浅色切换及真实会话退出。主题切换仅在当前页面生命周期内保留，不存储会话或凭证。

基础交互复用 Arc Button，内容空态使用官方 EmptyState。主题切换使用官方 ThemeSwitch，保留太阳/月亮动画，并通过 View Transitions 从按钮位置圆形展开新主题；减少动态效果或浏览器不支持时直接切换。侧栏由免费 primitives 组合，未复制 Pro block。总览未接入业务 API，不展示参考原型中的示例数字、曲线或节点。未开放的导航、搜索、通知和注册操作均禁用并说明原因；此改动不改变 REST 或 Agent 协议。

按钮外观统一由 `theme.css` 的 `--button-*` token 定义：主按钮使用参考 HTML 的薄荷绿至青柠绿渐变及柔和阴影，次按钮使用主题抬升表面与细边框。Arc Button 保留加载、禁用与键盘行为；未开放操作继续禁用。

侧栏菜单使用 Arc Tooltip，在悬浮或键盘聚焦时于右侧显示名称。未开放菜单项保持 `aria-disabled` 且没有操作处理器，允许聚焦以读取提示；移动端导航保留可见名称。
