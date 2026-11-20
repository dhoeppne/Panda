# 一个聊天有自己的路由

聊天有地址了。哈希命名用户在看的东西：一个聊天、新会话视图、设置。会话的路由带两段——家庭的命名空间，和 agent 发的会话 id。会话 id 是服务器自己的那个，所以一个链接在任何设备上打开同一个对话。

## 问题

Panda 原来只有两条路由：`#/` 和 `#/settings`。聊天在哪，全在 store 的两个指针里（`activeConnectionId` 和 `activeSessionId`）。三件事因此做不到：

1. **链接不到一个聊天。** 地址栏里没有聊天的名字。刷新一次页面，读到的是新会话视图：store 是空的，第一个家庭成为前台，没有会话，手写的记录也没了。
2. **一个聊天有几个身份。** `sessionId`（agent 的）、`connectionId`（配置 id）、`navKey(endpoint, sessionId)`（侧栏布局的键）、`composerDraftKey(connectionId, sessionId)`（草稿的键）、加上两个前台指针。五个形状说同一件事。
3. **服务器和浏览器不共用一个 id。** creche 那边，attendance 在 `session/new` 上发一个 UUID，vmm 的行、会话盘、VM、通知板的一页 `/sessions/<family>/<id>` 都用它。浏览器手里也是这个 id——但聊天本身没有单一的 id，所以没有一个地址可以写下来。

## 决定

### 路由的形状

```
#/chat/<namespace>/<sessionId>    一个聊天
#/new                             新会话视图
#/settings                       设置
```

`<namespace>` 是家庭的 URL 标识（slug）：小写字母、数字和短横线。它挂在配置上，**改名不改它**，所以链接一直有效。一个家庭没有 slug 时（改名前的旧配置、还没有配置的时候），loader 按名字推一个，推法是确定的：同一个列表在每台设备上读出同一批 slug。

`<sessionId>` 是 agent 发的会话 id，两段都做 URL 编码。creche 的 id 是 UUID，天然安全；别的 agent 的 id 是任意字符串，所以要编码。

### 路由驱动前台

路由说用户在看哪个聊天，store 说它活着没有。路由变了（贴进来的链接、另一个设备发来的链接），app 打开那个聊天：家庭连上，会话 `session/load`。前台动了（新建的会话、删掉的会话、agent 掉的会话），路由跟上。

**聊天不增长浏览器的历史。** 换聊天用 `replaceState`，所以后退键离开 Panda，而不是走一遍聊天。ADR 0010 记的是这个形状：路由是名字，不是历史。

### 一个 id 到处用

侧栏布局（`panda.nav`：置顶、分组、本地标题）的键从 `navKey(endpoint, sessionId)` 换成 `navKey(namespace, sessionId)`——和路由是同一对。迁移在读的时候做一次：旧键的第一段是端点，端点找得到家庭就换成它的 slug，找不到（家庭没了）就丢。端点不在链接里：桥接文档写明 `wss://…/acp?token=…` 是支持的写法，链接里带端点等于带凭据。

### 打开一个链接用 `session/load`

不是 `session/resume`。`session/load` 重放历史，所以一台从没见过这个聊天的设备打开链接也有内容。creche 的 facade 在 `session/load` 里先把实时项扣住、重放、再放出来，所以跑着的回合也接得上。

### creche 那边

不动。门已经服务一个家庭的多个会话，每个会话一台 VM，`session/list` 走完所有页，`session/load` 和 `session/resume` 都有。

## 决策依据

1. **会话 id 已经是服务器的了。** attendance 在 `session/new` 上发它，`SessionId` 的线格式是严格的 UUID，vmm 的行、会话盘和 VM 都带它。浏览器没有第二个 id 可用，也不需要。
2. **通知板已经会这么写地址。** `GET /sessions/<family>/<session>` 是 creche 自己的会话地址。Panda 的路由用同一对（家庭、会话），两个系统说的同一件事。
3. **家庭是那个命名空间。** 通知板知道家庭名（"principal"），不知道 Panda 的配置 id（配置表在浏览器的同步设置里）。所以命名空间必须是两边都认得的文字：家庭的 slug。
4. **slug 稳定，名字不 stable。** 配置可以改名；改名不改 slug，所以链接不断。Panda 不检查两个配置的名字是否相同，所以名字不能当命名空间用。
5. **不增长历史是刻意的。** 聊天是侧栏里的位置，不是浏览器的前进后退。链接靠地址栏和通知板，不靠历史。

## Considered

- **路由带端点**：`#/chat/<endpoint>/<sessionId>`。端点是唯一到处都在的身份，但端点可能带 `?token=`，链接会漏凭据。否决。
- **路由只带会话 id**：`#/chat/<sessionId>`。creche 的 id 是全局 UUID，通知板直接就能写。但 ACP 的会话 id 只在一个 agent 内唯一，两个 agent 可能发同一个 id；而且解析它要扫每个家庭。否决。
- **一条连接带多个活跃会话**（把 `pendingPrompt`、会话 id、外来会话过滤按会话分桶）：更贴协议，但要把 1900 行的客户端按会话拆开，动到每一个 agent 的行为。ADR 0009 选了第二条连接，代价小得多。否决。
- **路径路由**（`/chat/...` 而不是 `#/chat/...`）：更好看。nginx 已经有回退（"the fallback also keeps direct static paths safe if a non-hash route is introduced later"），但桌面壳是按哈希做的（`desktop/src-tauri/src/main.rs`），Tauri 的静态协议要另外配 SPA 回退。先哈希，以后再说。
- **后退键走一遍聊天**：每换一次聊天压一条历史。聊天是侧栏里的位置，不是网页流。否决。

## Consequences

- 一个聊天有一个地址：`https://chat.davidhoeppner.ca/#/chat/principal/<会话 id>`。侧栏的 ⋯ 菜单有「复制链接」。
- 刷新页面回到你刚才读的那个聊天：路由带着它，app 打开它。
- 一个链接在另一台设备上打开同一个对话：家庭按 slug 找，会话按 id 找。
- 家庭改名不改链接；改 slug 改链接（设置页里改）。
- 临时直连没有家庭，也没有可分享的命名空间：它的聊天路由用连接 id，只有这台浏览器认得。
- 新会话视图是 `#/new`。它不是聊天，路由说它是。
