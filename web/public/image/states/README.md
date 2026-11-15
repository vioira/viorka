# Viorka 状态插画

12 种静态 SVG 场景，分别提供 `light/` 与 `dark/` 版本。单图透明背景，画布为 320 × 216；建议展示宽度 160–320px，保持比例。`overview-light.svg` 和 `overview-dark.svg` 为设计总览，不作为业务内容。

参考 [Arc Empty states](https://uiarc.dev/components/blocks/empty-states)。`offline`、`no-results`、`not-found` 的路径提取自其免费开源 [registry 源码](https://uiarc.dev/r/empty-states.json) 的 idle 场景；其余场景沿用同一细线、平面色块的视觉语言扩展。仅保留静态图形，没有复制示例的模拟操作、标签页、视差或 morph 动画。

## 场景与边界

| 文件名 | 含义 | 使用条件 |
| --- | --- | --- |
| offline | 连接中断 | 已确认连接中断，不能仅根据一次请求超时推断断网 |
| empty | 暂无数据 | 成功读取且集合为空，不用于首次加载或读取失败 |
| not-found | 页面不存在 | 已确认的 404 |
| bad-gateway | 网关异常 | 已确认的 502，不推断节点或引擎离线 |
| no-results | 无匹配结果 | 搜索或筛选后无匹配记录 |
| success | 操作成功 | 已确认执行成功，任务提交或接收不算成功 |
| error | 操作失败 | 已确认失败，不用于结果未知 |
| forbidden | 无访问权限 | 已确认的 403，不替代服务端鉴权 |
| maintenance | 维护中 | 有明确的维护状态，不将所有 503 都解释为维护 |
| pending | 等待处理 | 已提交、尚待处理，不暗示正在执行 |
| partial | 部分异常 | 有可信数据表明部分成功、部分异常 |
| unconfigured | 尚未配置 | 已读取配置并确认缺少必要配置 |

已通过 `src/components/empty-states` 接入共享表格、设置和 404 等场景，使用既有主题状态选择浅深素材。请求成功/失败仍遵守全局 Toast 规范，不使用这些插画替换现有表单、表格或页面主体。加载继续使用 Skeleton。

## 配色与接入

`palette.css` 为这套素材的语义色板，使用 Radix Colors 3.0.0 官方 sage、green、amber、red 色阶（1、3、4、11、12），与项目绿色方向协调。每张 SVG 内嵌相同色板，可独立使用，无需在应用中重复导入 CSS。没有渐变、阴影或自动动画。图形边线为 1px；色彩搭配不同形状表达状态。

通过项目当前主题明确选择 `/image/states/light/<name>.svg` 或 `/image/states/dark/<name>.svg`；不要仅使用系统颜色偏好，因为应用允许用户手动切换主题。外部 `<img>` 不继承宿主 CSS 变量。

```tsx
<img
  src={`/image/states/${theme}/empty.svg`}
  alt=""
  width={320}
  height={216}
  className="h-auto w-full max-w-80"
/>
```

示例 `theme` 必须来自现有主题状态，值限定为 `light` 或 `dark`。图旁已有状态文字时使用空 `alt` 避免重复朗读；独立展示时提供明确中文 `alt`。保留宽高属性以预留空间。插画不内置按钮，恢复操作需复用 Arc 控件并绑定真实处理器。

## 验证范围

浅色/深色总览已实际渲染检查；所有 SVG 已做 XML 解析检查。没有页面接入，本轮不宣称完成 390/768/1024/1440px 浏览器交互、读屏或实机验收。
