/**
 * The message dictionary (#91): every UI-chrome string Panda renders, keyed
 * `<domain>.<name>` with one entry per locale. en is the source of truth —
 * zh entries may lag (translate() falls back to en when the zh slot is
 * missing), but an entirely missing KEY is a programming error and warns in
 * the console.
 *
 * Scope (issue #91): chrome only — buttons, labels, badges, placeholders,
 * hints, notices, and error strings that reach the UI. NOT translated: agent
 * output (messages, tool results, diffs), user input,
 * docs, and code comments (this file's zh column is the only place those
 * strings leave the components).
 *
 * Interpolation: `{name}` placeholders, filled by t(key, { name: value }).
 */
export const messages = {
  // ---- shell / app frame ----
  'app.closeNav': { en: 'Close navigation', zh: '关闭导航' },
  'app.openNav': { en: 'Open navigation', zh: '打开导航' },
  'app.back': { en: 'Back', zh: '返回' },
  'app.backTooltip': { en: 'Back to the session view', zh: '回到会话界面' },
  'app.liveSessionTitle': { en: 'Live session', zh: 'Live 会话' },

  // ---- shared connection states (StatusDot labels etc.) ----
  'conn.connected': { en: 'Connected', zh: '已连接' },
  'conn.error': { en: 'Connection error', zh: '连接错误' },
  'conn.authRequired': { en: 'Sign-in required', zh: '需要登录' },
  'conn.disconnected': { en: 'Not connected', zh: '未连接' },
  'conn.running': { en: 'Running', zh: '运行中' },

  // ---- StatusBar ----
  'status.connecting': { en: 'Connecting…', zh: '连接中…' },
  'status.switching': { en: 'Switching session…', zh: '切换会话中…' },
  'status.authenticated': { en: 'Authenticated', zh: '已认证' },
  'status.authenticatedVia': { en: 'Authenticated via “{name}”', zh: '已通过「{name}」认证' },
  'status.authenticate': { en: 'Authenticate', zh: '认证' },
  'status.authenticateVia': { en: 'Authenticate via “{name}”', zh: '通过「{name}」认证' },
  'status.awaitingApproval': { en: 'Awaiting your approval', zh: '等待你的批准' },
  'status.working': { en: 'Working…', zh: '工作中…' },
  'status.ready': { en: 'Ready', zh: '就绪' },
  'status.spendOfBudget': { en: '{amount} / {budget} today', zh: '今日 {amount} / {budget}' },
  'status.spendToday': { en: '{amount} today', zh: '今日 {amount}' },
  'status.spendTitle': {
    en: 'Spend of this agent family today, against its daily budget of {budget}',
    zh: '此 agent 家族今日花费,每日预算 {budget}',
  },
  'status.spendNoBudget': { en: 'Spend of this agent family today (no daily budget)', zh: '此 agent 家族今日花费(无每日预算)' },

  // ---- EmptyState (first-run onboarding, #200) ----
  'empty.title': { en: 'Connect your agent', zh: '把你的 agent 连上来' },
  'empty.lead': {
    en: 'Panda is a pure protocol client: implement ACP in your agent and this message stream is its UI. Connect your own agent below.',
    zh: 'Panda 是纯协议客户端:你的 agent 说 ACP,这条消息流就是它的界面。按下面两步连上你自己的 agent。',
  },
  'empty.connectHeading': { en: 'Connect your own agent', zh: '连你自己的 agent' },
  'empty.desktopKicker': { en: 'Desktop · direct stdio', zh: '桌面版 · stdio 直连' },
  'empty.desktopBody': {
    en: 'Settings → Agent profiles → New (stdio), then fill in your agent’s start command. Ten-minute walkthrough from scratch:',
    zh: '设置 → Agent profiles → 新建(stdio),填入你 agent 的启动命令。从零接入的十分钟走读:',
  },
  'empty.quickstartLink': { en: 'Agent quickstart', zh: '接入快速上手' },
  'empty.quickstartUrl': {
    en: 'https://github.com/lukaisluka/Panda/blob/main/docs/agent-quickstart.en.md',
    zh: 'https://github.com/lukaisluka/Panda/blob/main/docs/agent-quickstart.md',
  },
  'empty.webKicker': { en: 'Web · WebSocket endpoint', zh: '网页版 · WebSocket 端点' },
  'empty.webBody': {
    en: 'Point the web app at any ACP-over-WebSocket endpoint. Recipe for bridging a stdio agent to WebSocket:',
    zh: '网页版连接任一 ACP-over-WebSocket 端点。把 stdio agent 桥接为 WebSocket 的配方:',
  },
  'empty.bridgeLink': { en: 'Bridge guide', zh: '桥接指南' },
  'empty.bridgeUrl': {
    en: 'https://github.com/lukaisluka/Panda/blob/main/docs/acp-stdio-to-websocket.en.md',
    zh: 'https://github.com/lukaisluka/Panda/blob/main/docs/acp-stdio-to-websocket.md',
  },
  'empty.existingToggle': {
    en: 'Using an existing agent? (Claude Code, Gemini CLI, …)',
    zh: '用现成 agent?(Claude Code、Gemini CLI 等)',
  },
  'empty.existingBody': {
    en: '40+ mainstream coding agents speak ACP or can be exposed through a bridge; Claude Code is pinned by real-traffic contract tests. Connection paths:',
    zh: '40+ 主流 coding agent 说 ACP 或可经 bridge 暴露;Claude Code 由真实流量契约测试钉死。连接路径见',
  },
  'empty.userGuideLink': { en: 'User guide', zh: '使用指南' },
  'empty.userGuideUrl': {
    en: 'https://github.com/lukaisluka/Panda/blob/main/docs/user-guide.md',
    zh: 'https://github.com/lukaisluka/Panda/blob/main/docs/user-guide.md',
  },

  // ---- Composer ----
  'composer.placeholder': { en: 'Message Panda…', zh: '给 Panda 发消息…' },
  'composer.commands': { en: 'Slash commands', zh: '斜杠命令' },
  'composer.paramHint': { en: 'Input: {hint}', zh: '参数:{hint}' },
  'composer.skills': { en: 'Skills · {family}', zh: '技能 · {family}' },
  'composer.skillsMatched': { en: '{count} of {total}', zh: '{count} / {total}' },
  'composer.skillsLoading': { en: 'Loading the skills of {family}', zh: '正在加载 {family} 的技能' },
  'composer.skillsOffline': {
    en: '{family} is offline. Its skills show here when it reconnects.',
    zh: '{family} 已离线。重新连接后,这里会显示它的技能。',
  },
  'composer.skillsNoMatch': {
    en: 'No skill starts with {query}. Enter sends the text as typed.',
    zh: '没有以 {query} 开头的技能。按 Enter 会按原样发送。',
  },
  'composer.skillsKeys': { en: '↑↓ select · Enter or Tab insert · Esc close', zh: '↑↓ 选择 · Enter 或 Tab 插入 · Esc 关闭' },
  'composer.removeAttachment': { en: 'Remove {name}', zh: '移除 {name}' },
  'composer.attach': { en: 'Attach files', zh: '添加文件' },
  'composer.attachUnavailable': { en: 'This agent does not take files', zh: '当前 agent 不接收文件' },
  'composer.attachDisabled': { en: 'Cannot attach files right now', zh: '当前不可添加文件' },
  'composer.dropFiles': { en: 'Drop files to attach', zh: '拖放文件以添加' },
  'composer.settings': { en: 'Session settings', zh: '会话设置' },
  'composer.settingsDisabled': { en: 'Cannot change settings right now', zh: '当前不可调整设置' },
  'composer.stop': { en: 'Stop', zh: '停止' },
  'composer.send': { en: 'Send', zh: '发送' },
  'composer.queue': { en: 'Queue message', zh: '加入队列' },
  'composer.queueHint': {
    en: 'Queue message — it sends when the current turn ends (Enter)',
    zh: '加入队列 — 当前回合结束后发送(Enter)',
  },
  'composer.queueLabel': { en: 'Queued messages', zh: '排队的消息' },
  'composer.queued': { en: 'Queued · {count} — sends when the turn ends', zh: '排队中 · {count} — 回合结束后发送' },
  'composer.queuePaused': {
    en: 'Queue paused · {count} — the last turn stopped early',
    zh: '队列已暂停 · {count} — 上一回合提前结束',
  },
  'composer.queueResume': { en: 'Resume queue', zh: '继续发送' },
  'composer.queueRemove': { en: 'Remove queued message: {preview}', zh: '移除排队消息:{preview}' },
  'composer.queuedFiles': { en: '{count} file(s)', zh: '{count} 个文件' },
  'composer.readFileFailed': { en: 'Failed to read file: {message}', zh: '读取文件失败:{message}' },
  'composer.hintAll': {
    en: 'Images, PDF, text and code · up to {files} files, {fileMb} MB each, {messageMb} MB in all',
    zh: '图片、PDF、文本和代码 · 最多 {files} 个文件,每个 {fileMb} MB,合计 {messageMb} MB',
  },
  'composer.hintImagesOnly': {
    en: 'Images · up to {files} files, {fileMb} MB each, {messageMb} MB in all',
    zh: '图片 · 最多 {files} 个文件,每个 {fileMb} MB,合计 {messageMb} MB',
  },
  'composer.hintFilesOnly': {
    en: 'PDF, text and code · up to {files} files, {fileMb} MB each, {messageMb} MB in all',
    zh: 'PDF、文本和代码 · 最多 {files} 个文件,每个 {fileMb} MB,合计 {messageMb} MB',
  },
  'composer.refusedHint': {
    en: 'Red files stay visible but are not sent. Remove them or send the rest.',
    zh: '红色文件保留显示但不会发送。移除它们,或发送其余文件。',
  },

  // ---- attachments ----
  'attach.notAllowed': { en: 'Kind not allowed', zh: '类型不允许' },
  'attach.fileTooLarge': { en: 'Over 8 MB', zh: '超过 8 MB' },
  'attach.messageTooLarge': { en: 'Over 10 MB in all', zh: '合计超过 10 MB' },
  'attach.tooMany': { en: 'Up to {n} files', zh: '最多 {n} 个文件' },
  'attach.pastedName': { en: 'Pasted image', zh: '粘贴的图片' },
  'attach.kindImage': { en: 'Image', zh: '图片' },
  'attach.kindText': { en: 'Text', zh: '文本' },
  'attach.kindCode': { en: 'Code', zh: '代码' },
  'attach.kindFile': { en: 'File', zh: '文件' },

  // ---- MessageStream ----
  'stream.compacting': { en: 'Compacting context…', zh: '正在压缩上下文…' },
  'stream.jumpToLatest': { en: 'Jump to latest', zh: '回到最新' },
  'msg.rewind': { en: 'Rewind to here', zh: '回退到这里' },
  'msg.copy': { en: 'Copy message', zh: '复制消息' },
  'msg.copied': { en: 'Copied', zh: '已复制' },
  'msg.rewindTitle': { en: 'Rewind to before this message?', zh: '回退到这条消息之前?' },
  'msg.rewindBody': {
    en: 'This message and every message after it leave the chat. Its text goes back to the composer. Files in the workspace stay as they are.',
    zh: '这条消息及其之后的所有消息将从对话中移除,它的文字会回到输入框。工作区中的文件保持不变。',
  },
  'msg.rewindAction': { en: 'Rewind', zh: '回退' },
  'stream.compacted': { en: 'Context compacted', zh: '上下文已压缩' },
  'stream.compactFailed': { en: 'Context compaction failed', zh: '上下文压缩失败' },
  'stream.compactFailedReason': { en: 'Context compaction failed: {error}', zh: '上下文压缩失败:{error}' },
  // The scroller's a11y name (#221): focusable but unnamed read as a bare
  // tab-stop to screen readers.
  'stream.transcript': { en: 'Conversation transcript', zh: '对话记录' },

  // ---- PermissionCard ----
  'perm.title': { en: 'Agent requests approval', zh: 'Agent 请求批准' },
  'perm.unknownOption': { en: '{name} (unknown option type)', zh: '{name}(未知选项类型)' },
  // What an「always」option actually remembers (#221): Panda's session-scoped
  // memory, keyed by the action's identity — not an agent-side setting.
  'perm.alwaysScopeTooltip': {
    en: 'Remembered for this session only: identical requests won’t ask again. It expires when the session ends or you switch.',
    zh: '仅本会话内记住:相同操作不再询问;会话结束或切换后失效。',
  },
  'perm.deniedByPolicy': { en: 'Denied by policy', zh: '已由策略拒绝' },
  'perm.autoAnswered': { en: 'Auto-answered {kind} (not by you)', zh: '已代答 {kind}(非用户决定)' },
  'perm.autoCancelled': {
    en: 'The agent offered no reject option; auto-answered cancelled (not by you)',
    zh: 'agent 未提供拒绝选项,已代答 cancelled(非用户决定)',
  },
  'perm.byPriorChoice': { en: "Auto-answered from this session's earlier choices", zh: '按本会话既往选择代答' },
  'perm.autoRejected': {
    en: 'You chose “reject always” for this action earlier this session; auto-rejected',
    zh: '你本会话曾对同一操作选择 reject_always,已自动拒绝',
  },
  'perm.autoAllowed': {
    en: 'You chose “allow always” for this action earlier this session; auto-allowed',
    zh: '你本会话曾对同一操作选择 allow_always,已自动放行',
  },
  'perm.allowOnce': { en: 'Allow', zh: '允许' },
  'perm.allowAlways': { en: 'Always allow', zh: '始终允许' },
  'perm.rejectOnce': { en: 'Reject', zh: '拒绝' },
  'perm.rejectAlways': { en: 'Always reject', zh: '始终拒绝' },
  'perm.approved': { en: 'Approved', zh: '已批准' },
  'perm.rejected': { en: 'Rejected', zh: '已拒绝' },

  // ---- ElicitationCard / ElicitationUrlCard ----
  'elicit.title': { en: 'Agent request', zh: 'Agent 请求信息' },
  'elicit.reject': { en: 'Decline', zh: '拒绝' },
  'elicit.submit': { en: 'Submit', zh: '提交' },
  'elicit.required': { en: 'Required', zh: '必填' },
  'elicit.unsupported': {
    en: 'Unsupported field type ({type}); this field cannot be filled in',
    zh: '暂不支持的字段类型({type}),此项不可填写',
  },
  'elicit.placeholderInteger': { en: 'Integer', zh: '整数' },
  'elicit.placeholderNumber': { en: 'Number', zh: '数字' },
  'elicit.done': { en: 'Done', zh: '已完成' },
  'elicit.submitted': { en: 'Submitted ({n} fields)', zh: '已提交({n} 项)' },
  'elicit.declined': { en: 'Declined', zh: '已拒绝' },
  'elicit.cancelled': { en: 'Cancelled (not by you)', zh: '已取消(非用户决定)' },
  'elicit.url.title': { en: 'External authorization', zh: '外部授权' },
  'elicit.url.opened': { en: 'Link opened; waiting for the external flow to finish…', zh: '链接已打开,等待外部流程完成…' },
  'elicit.url.gateTitle': { en: 'Agent request (external authorization)', zh: 'Agent 请求信息(外部授权)' },
  'elicit.url.punycode': {
    en: 'Domain contains Punycode (xn--) — beware of look-alike sites',
    zh: '域名含 Punycode(xn--),谨防仿冒站点',
  },
  'elicit.url.insecure': { en: 'Link is not HTTPS; transport is unprotected', zh: '链接不是 HTTPS,传输不受保护' },
  'elicit.url.unparseable': { en: 'Link could not be parsed; opening disabled', zh: '链接无法解析,已禁用打开' },
  'elicit.url.desc': {
    en: 'Clicking opens the link in a new browser tab; authorization completes on the external page.',
    zh: '点击后将在你的浏览器新标签页打开,授权在外部页面完成。',
  },
  'elicit.url.open': { en: 'Open link', zh: '打开链接' },

  // ---- ToolCallCard / DiffView ----
  'tool.awaitApproval': { en: 'Awaiting approval', zh: '等待批准' },
  'tool.queued': { en: 'Queued', zh: '排队中' },
  'tool.queuedTooltip': {
    en: 'Another tool in this batch is awaiting approval; approvals resume the whole batch — approving runs this call immediately',
    zh: '同批工具里有一个在等审批;审批是按整批一起恢复的,批准后这张卡立即执行',
  },
  'tool.running': { en: 'Running', zh: '执行中' },
  'tool.unsupportedBlock': { en: 'Unsupported content block ({type})', zh: '未支持的内容块({type})' },
  'tool.waitingApproval': { en: 'Waiting for approval…', zh: '等待批准后执行…' },
  'tool.waitingOutput': { en: 'Waiting for output…', zh: '等待输出…' },
  'tool.rawJson': { en: 'Raw JSON', zh: '原始 JSON' },
  // The tool-call domain stays English on purpose (maintainer call,
  // 2026-09-08): these labels share the row with agent-provided content —
  // tool names (write_todos), permission option names (Approve/Reject),
  // file paths — and translating half of that mix reads worse than keeping
  // the verbs/labels in English. Do not "fix" the zh column to Chinese.
  'tool.thinking': { en: 'Thinking', zh: 'Thinking' },
  'tool.thought': { en: 'Thought', zh: 'Thought' },
  'tool.group.count': { en: '{n} tool calls', zh: '{n} tool calls' },
  'tool.verb.read': { en: 'Read', zh: 'Read' },
  'tool.verb.edit': { en: 'Edit', zh: 'Edit' },
  'tool.verb.delete': { en: 'Delete', zh: 'Delete' },
  'tool.verb.move': { en: 'Move', zh: 'Move' },
  'tool.input': { en: 'Input', zh: 'Input' },
  'tool.output': { en: 'Output', zh: 'Output' },
  'diff.copyPatch': { en: 'Copy patch', zh: '复制补丁' },
  'diff.fold': { en: '⋯ {n} unchanged lines', zh: '⋯ {n} 行未变更' },

  // ---- small blocks ----
  'clamp.collapse': { en: 'Collapse', zh: '收起' },
  'clamp.expand': { en: 'Expand all', zh: '展开全部' },
  'code.copy': { en: 'Copy code', zh: '复制代码' },
  'config.title': { en: 'Session settings', zh: '会话设置' },
  'mode.menu': { en: 'Session mode', zh: '会话模式' },
  'plan.dock': { en: 'Session plan', zh: '会话计划' },
  'plan.title': { en: 'Plan', zh: '计划' },
  // Counter semantics pinned by #220: completed-count, never "current step" —
  // the bare `N/M` read both ways, which read as progress that hadn't happened.
  'plan.progress': { en: '{done}/{total} done', zh: '{done}/{total} 已完成' },
  'unsupported.event': { en: 'Not-yet-supported ACP event · {kind}', zh: '暂不支持的 ACP 事件 · {kind}' },
  'turn.cancelled': { en: 'Cancelled', zh: '已取消' },
  'turn.refusal': { en: 'The model refused this request', zh: '模型拒绝了本次请求' },
  'turn.maxTokens': { en: 'Output hit the length limit (max_tokens)', zh: '输出达到长度上限(max_tokens)' },
  'turn.maxTurnRequests': { en: 'Hit the per-turn request limit (max_turn_requests)', zh: '达到单回合请求上限(max_turn_requests)' },

  // ---- AuthGate ----
  'auth.gateTitle': { en: 'This agent requires sign-in', zh: '此 agent 需要登录' },
  'auth.noMethods': {
    en: 'The agent provided no browser-usable sign-in method',
    zh: 'agent 未提供浏览器可用的登录方式',
  },

  // ---- workspace field (settings agent profiles) ----
  'nsd.localDir': { en: 'Local directory', zh: '本机文件夹' },
  'nsd.noWorkspace': { en: 'No workspace', zh: '无工作区' },
  'nsd.workspacePath': { en: 'Workspace path', zh: '工作区路径' },

  // ---- Sidebar ----
  'side.newChat': { en: 'New chat', zh: '新对话' },
  'side.search': { en: 'Search chats', zh: '搜索对话' },
  'side.results': { en: 'Results · {n}', zh: '结果 · {n}' },
  'side.noMatches': { en: 'No chat title matches.', zh: '没有匹配的对话标题。' },
  'side.noChats': {
    en: 'Your chats show here. Start one with New chat, then group chats into sections and folders.',
    zh: '你的对话会显示在这里。用「新对话」开始,再把对话归入分区和文件夹。',
  },
  'side.noFamilies': { en: 'No agent yet. Add one to start chatting.', zh: '还没有 agent。添加一个即可开始对话。' },
  'side.pinned': { en: 'Pinned', zh: '已置顶' },
  'side.recents': { en: 'Recents', zh: '最近' },
  'side.allFiled': { en: 'Every chat is filed.', zh: '所有对话都已归档。' },
  'side.bucket.today': { en: 'Today', zh: '今天' },
  'side.bucket.yesterday': { en: 'Yesterday', zh: '昨天' },
  'side.bucket.week': { en: 'Previous 7 days', zh: '过去 7 天' },
  'side.bucket.older': { en: 'Older', zh: '更早' },
  'side.newSection': { en: 'New section', zh: '新建分区' },
  'side.sectionName': { en: 'Section name', zh: '分区名称' },
  'side.sectionActions': { en: 'Section actions', zh: '分区操作' },
  'side.renameSection': { en: 'Rename section', zh: '重命名分区' },
  'side.deleteSection': { en: 'Delete section', zh: '删除分区' },
  'side.deleteSectionHint': { en: 'Its chats go to Recents', zh: '其中的对话回到「最近」' },
  'side.newFolder': { en: 'New folder', zh: '新建文件夹' },
  'side.newFolderIn': { en: 'New folder in {name}', zh: '在 {name} 中新建文件夹' },
  'side.folderName': { en: 'Folder name', zh: '文件夹名称' },
  'side.folderActions': { en: 'Folder actions', zh: '文件夹操作' },
  'side.renameFolder': { en: 'Rename folder', zh: '重命名文件夹' },
  'side.deleteFolder': { en: 'Delete folder', zh: '删除文件夹' },
  'side.deleteFolderHint': { en: 'Its chats stay in the section', zh: '其中的对话留在分区里' },
  'side.dropHere': { en: 'Drag chats here.', zh: '把对话拖到这里。' },
  'side.chatActions': { en: 'Chat actions', zh: '对话操作' },
  'side.pin': { en: 'Pin', zh: '置顶' },
  'side.unpin': { en: 'Unpin', zh: '取消置顶' },
  'side.rename': { en: 'Rename', zh: '重命名' },
  'side.moveTo': { en: 'Move to', zh: '移动到' },
  'side.deleteConfirm': {
    en: 'Delete “{title}”? The agent deletes the session and its history.',
    zh: '删除「{title}」?agent 会删除该会话及其历史。',
  },
  'side.familyConnect': { en: 'click to connect', zh: '点击连接' },
  'side.familyReconnect': { en: 'click to reconnect', zh: '点击重连' },
  'side.notice.layoutSaveFailed': {
    en: 'Panda could not save the sidebar layout in this browser. The change is lost on reload.',
    zh: 'Panda 无法在此浏览器保存侧栏布局,刷新后改动会丢失。',
  },
  'family.menu': { en: 'Family', zh: 'Family' },
  'family.pickTooltip': { en: 'Choose the family for this chat', zh: '为这个对话选择 family' },
  'family.lockedTooltip': {
    en: 'This chat runs on {name}. Start a new chat to use another family.',
    zh: '这个对话运行在 {name} 上。要用别的 family,请新建对话。',
  },
  'newChat.title': { en: 'What do you need?', zh: '需要做什么?' },
  'newChat.hint': {
    en: 'This chat goes to {name}. Switch the family in the chat bar before you send.',
    zh: '这个对话会发给 {name}。发送前可以在输入栏切换 family。',
  },
  'newChat.placeholder': { en: 'Message {name}…', zh: '给 {name} 发消息…' },
  'newChat.starting': { en: 'Starting a chat on {name}…', zh: '正在 {name} 上开始对话…' },
  'newChat.startFailed': {
    en: 'Panda could not start a chat on {name}. Check the family in the sidebar footer, then send again.',
    zh: 'Panda 无法在 {name} 上开始对话。请检查侧栏底部的 family 状态后重新发送。',
  },
  'side.addAgent': { en: 'Add agent', zh: '添加 agent' },
  'side.settings': { en: 'Settings', zh: '设置' },
  'side.settingsTooltip': { en: 'Settings: agent profiles, theme', zh: '设置:Agent 配置、主题' },
  'side.backToSession': { en: 'Back to session', zh: '返回会话' },
  'side.backToSessionTooltip': { en: 'Leave settings and return to the session view', zh: '离开设置,回到会话界面' },
  'side.needsAttention': { en: 'Needs attention', zh: '需要关注' },
  'side.attentionTooltip': { en: 'Needs attention: {reasons}', zh: '需要关注:{reasons}' },
  'side.disabled.busy': { en: 'Wait for the current turn or switch to finish', zh: '等待当前回合或切换完成' },
  'side.disabled.offline': { en: 'Connect to view/switch this session', zh: '连接后可查看/切换该会话' },
  'side.disabled.host': { en: 'The host does not support session replay', zh: '宿主暂不支持会话回放' },
  'side.disabled.agent': {
    en: 'The agent does not support history replay (session/load)',
    zh: 'agent 不支持历史回放(session/load)',
  },
  'side.deleteSession': { en: 'Delete session', zh: '删除会话' },
  'side.time.justNow': { en: 'just now', zh: '刚刚' },
  'side.time.minutesAgo': { en: '{n} min ago', zh: '{n} 分钟前' },
  'side.time.hoursAgo': { en: '{n} h ago', zh: '{n} 小时前' },
  'side.time.daysAgo': { en: '{n} d ago', zh: '{n} 天前' },

  // ---- SettingsPage ----
  'settings.title': { en: 'Settings', zh: '设置' },
  'settings.general': { en: 'General', zh: '通用' },
  'settings.generalDesc': {
    en: 'Appearance theme and interface language.',
    zh: '外观主题与界面语言。',
  },
  // Codex-style row labels (#138): one setting per row — title + description
  // on the left, control on the right. Group titles head the row cards.
  'settings.appearanceGroup': { en: 'Appearance & language', zh: '外观与语言' },
  'settings.themeRow': { en: 'Theme', zh: '主题' },
  'settings.themeRowDesc': { en: 'The color scheme of the whole interface.', zh: '整个界面的配色。' },
  'settings.themeMore': { en: 'More themes coming soon', zh: '更多主题将陆续开放' },
  'settings.language': { en: 'Language', zh: '语言' },
  'settings.languageRowDesc': { en: 'Display language of the interface.', zh: '界面的显示语言。' },
  'settings.uiFontRow': { en: 'UI font size', zh: '界面字号' },
  'settings.uiFontRowDesc': { en: 'Base size of the interface; secondary text scales with it.', zh: '界面的基准字号，次要文字随之缩放。' },
  'settings.codeFontRow': { en: 'Code font size', zh: '代码字号' },
  'settings.codeFontRowDesc': { en: 'Font size of code blocks and other mono content.', zh: '代码块与等宽内容的字号。' },
  'settings.syncRow': { en: 'Settings sync', zh: '设置同步' },
  'settings.syncOn': { en: 'On, as {user}', zh: '已开启，用户 {user}' },
  'settings.syncOff': { en: 'Off (this browser only)', zh: '未开启(仅本浏览器)' },
  'settings.fontSmaller': { en: 'Smaller', zh: '调小' },
  'settings.fontLarger': { en: 'Larger', zh: '调大' },
  'settings.envGroup': { en: 'Environment', zh: '运行环境' },
  'settings.versionRow': { en: 'Version', zh: '版本' },
  'settings.hostRow': { en: 'Host', zh: '宿主' },
  'settings.hostBrowser': { en: 'Browser', zh: '浏览器' },
  'settings.hostDesktop': { en: 'Desktop app', zh: '桌面版' },
  'settings.userAgentRow': { en: 'Browser & OS', zh: '浏览器与系统' },
  'settings.reportGroup': { en: 'Diagnostics report', zh: '诊断报告' },
  'settings.reportRowDesc': {
    en: 'Environment and the recent console log, copied to the clipboard for a bug report.',
    zh: '环境信息与最近控制台日志,复制到剪贴板,可附在问题反馈里。',
  },
  'settings.locale.en': { en: 'English', zh: 'English' },
  'settings.locale.zh': { en: '中文', zh: '中文' },
  'settings.profiles': { en: 'Agent profiles', zh: 'Agent 配置' },
  'settings.profilesGroup': { en: 'Saved profiles', zh: '已保存的配置' },
  'settings.addProfile': { en: 'Add profile', zh: '新增配置' },
  'settings.profilesDesc': {
    en: 'Save agent endpoints and default workspaces to pick directly when starting a session.',
    zh: '保存 agent 的端点地址与默认工作区,新建会话时直接选用。',
  },
  'settings.noProfiles': { en: 'No agent profiles yet', zh: '还没有 Agent 配置' },
  'settings.noProfilesDesc': {
    en: 'Add one and it becomes directly selectable when starting a session.',
    zh: '新增一条,之后新建会话时就能直接选这个 agent。',
  },
  'settings.editProfile': { en: 'Edit profile', zh: '编辑配置' },
  'settings.editProfileTooltip': {
    en: 'Edit the name, endpoint, or default workspace',
    zh: '编辑名称、端点地址或默认工作区',
  },
  'settings.deleteProfile': { en: 'Delete profile', zh: '删除配置' },
  'settings.deleteProfileTooltip': {
    en: 'Delete this profile (the endpoint’s remembered sessions are untouched)',
    zh: '删除这条配置(不影响该端点已记忆的会话)',
  },
  'settings.deleteProfileConfirm': {
    en: 'Delete profile “{name}”? The endpoint’s remembered sessions are unaffected.',
    zh: '删除配置「{name}」?该端点已记忆的会话不受影响。',
  },
  'settings.mcp': { en: 'MCP servers', zh: 'MCP 服务器' },
  'settings.mcpGroup': { en: 'Saved servers', zh: '已保存的服务器' },
  'settings.addMcp': { en: 'Add server', zh: '新增服务器' },
  'settings.mcpModeLabel': { en: 'Input mode', zh: '输入方式' },
  'settings.mcpModeForm': { en: 'Form', zh: '表单' },
  'settings.mcpModeText': { en: 'Text', zh: '文本' },
  'settings.mcpFormatLabel': { en: 'Config format', zh: '配置格式' },
  'settings.mcpFormatBtn': { en: 'Format', zh: '格式化' },
  'settings.mcpSaveCount': { en: 'Save {n} server(s)', zh: '保存 {n} 条' },
  'settings.mcpParseError': { en: 'Cannot parse', zh: '无法解析' },
  'settings.mcpDirtyConfirm': {
    en: 'Discard unsaved changes to the text config?',
    zh: '放弃文本配置的未保存修改?',
  },
  'settings.mcpDirtyTitle': { en: 'Unsaved changes', zh: '有未保存的修改' },
  'settings.mcpDirtyLeave': { en: 'Discard & leave', zh: '放弃并离开' },
  'settings.mcpDroppedFields': {
    en: 'Fields Panda does not store were dropped: {fields}',
    zh: 'Panda 暂不存储的字段已丢弃:{fields}',
  },
  'settings.mcpPlaceholders': {
    en: 'Some values contain ${{…}} placeholders — imported literally, replace them yourself if needed.',
    zh: '部分值含 ${{…}} 占位符,已按字面导入,需要时请自行替换。',
  },
  'settings.mcpRenamed': { en: 'Duplicate names suffixed: {names}', zh: '重名已加序号后缀:{names}' },
  'settings.mcpSkipMissingName': { en: 'entry has no name', zh: '条目缺少名称' },
  'settings.mcpSkipInvalid': { en: 'entry is not a config object', zh: '条目不是配置对象' },
  'settings.mcpSkipMissingCommand': { en: 'stdio needs a command', zh: 'stdio 缺少命令' },
  'settings.mcpSkipMissingUrl': { en: 'remote needs a URL', zh: '远程类型缺少 URL' },
  'settings.mcpSkipUnsupportedType': {
    en: 'transport type Panda cannot host (stdio / http / sse only)',
    zh: 'Panda 不支持该传输类型(仅 stdio / http / sse)',
  },
  'settings.mcpDesc': {
    en: 'Configured tool servers ride every session/new · session/load to the agent, which connects and obtains their tools; stdio commands run on the agent’s host. Changes apply to the next session.',
    zh: '配置的工具服务会随每个新建/载入的会话下发给 agent,由 agent 侧连接并取得工具;stdio 命令在 agent 所在主机上执行。修改对下一个会话生效。',
  },
  'settings.noMcp': { en: 'No MCP servers yet', zh: '还没有 MCP 服务器' },
  'settings.noMcpDesc': {
    en: 'Add one and the agent can use the tools it provides in sessions.',
    zh: '新增一条,agent 就能在会话里用到它提供的工具。',
  },
  'settings.editMcp': { en: 'Edit server', zh: '编辑服务器' },
  'settings.editMcpTooltip': { en: 'Edit the name, type, or launch parameters', zh: '编辑名称、类型或启动参数' },
  'settings.deleteMcp': { en: 'Delete server', zh: '删除服务器' },
  'settings.deleteMcpTooltip': {
    en: 'Delete this MCP server config (existing sessions are untouched)',
    zh: '删除这条 MCP 服务器配置(不影响已建立的会话)',
  },
  'settings.deleteMcpConfirm': { en: 'Delete MCP server “{name}”?', zh: '删除 MCP 服务器「{name}」?' },
  'settings.serverName': { en: 'Server name', zh: '服务器名称' },
  'settings.serverNamePlaceholder': { en: 'e.g. filesystem', zh: '如:filesystem' },
  'settings.type': { en: 'Type', zh: '类型' },
  'settings.profileType': { en: 'Connection type', zh: '连接方式' },
  'settings.typeWebsocket': { en: 'WebSocket (remote service)', zh: 'WebSocket(远程服务)' },
  'settings.profileTypeTooltip': {
    en: 'stdio spawns a local agent process and speaks ACP over its stdin/stdout',
    zh: 'stdio 在本机拉起 agent 进程,经其 stdin/stdout 通信',
  },
  'settings.stdioDesktopOnly': {
    en: 'Panda desktop app only (spawns a local process)',
    zh: '仅 Panda 桌面版可用(在本机拉起进程)',
  },
  'settings.agentCommandPlaceholder': {
    en: 'e.g. node your-agent.mjs (see the agent quickstart)',
    zh: '如:node your-agent.mjs(见 agent 快速入门)',
  },
  'settings.commandRequired': {
    en: 'stdio needs an executable command',
    zh: 'stdio 需要可执行命令',
  },
  'settings.typeStdio': { en: 'stdio (command on the agent host)', zh: 'stdio(agent 主机命令)' },
  'settings.typeHttp': { en: 'HTTP (Streamable)', zh: 'HTTP(Streamable)' },
  'settings.typeSse': { en: 'SSE', zh: 'SSE' },
  'settings.typeTooltip': {
    en: 'stdio spawns a process on the agent host; HTTP/SSE is dialed by the agent',
    zh: 'stdio 由 agent 所在主机拉起进程;HTTP/SSE 由 agent 侧按 URL 拨号',
  },
  'settings.command': { en: 'Command', zh: '命令' },
  'settings.commandPlaceholder': {
    en: 'e.g. npx -y @modelcontextprotocol/server-filesystem',
    zh: '如:npx -y @modelcontextprotocol/server-filesystem',
  },
  'settings.args': { en: 'Arguments (space-separated)', zh: '参数(空格分隔)' },
  'settings.argsPlaceholder': { en: 'e.g. /path/to/dir --another', zh: '如:/path/to/dir --another' },
  'settings.mcpEditNote': {
    en: 'Changes apply to the next session/new or session/load.',
    zh: '修改在下一个新建/载入的会话生效。',
  },
  'settings.save': { en: 'Save', zh: '保存' },
  'settings.create': { en: 'Create', zh: '创建' },
  'settings.cancel': { en: 'Cancel', zh: '取消' },
  // 测试连接 (#221): handshake-then-drop verdict on the profile form.
  'settings.testConnection': { en: 'Test connection', zh: '测试连接' },
  'settings.serverSignIn': { en: 'Sign in to server', zh: '登录服务器' },
  'settings.serverSignInHelp': {
    en: 'Finish signing in in the new window, close it, then test the connection here. Your browser login is separate from this app.',
    zh: '在新窗口中完成登录并关闭窗口，然后在此测试连接。浏览器的登录状态与此应用分开保存。',
  },
  'settings.testConnectionRunning': { en: 'Testing…', zh: '测试中…' },
  'settings.testOk': {
    en: 'Reached: {agent} (protocol v{v}) — the link was closed after the handshake',
    zh: '连通:{agent}(协议 v{v})——握手后已断开',
  },
  'settings.testFailed': { en: 'Failed: {error}', zh: '失败:{error}' },
  // Post-create CTA (#221): a saved profile used to dead-end on the list.
  'settings.profileSavedTitle': { en: 'Profile saved', zh: '配置已保存' },
  'settings.profileSavedDesc': {
    en: '“{name}” is ready — its slot appears in the sidebar.',
    zh: '「{name}」已就绪,侧栏会出现它的分组。',
  },
  'settings.startSessionCtaNamed': { en: 'Start a session with {name}', zh: '用 {name} 开始会话' },
  'settings.done': { en: 'Done', zh: '完成' },
  'side.copyLink': { en: 'Copy link', zh: '复制链接' },
  'side.linkCopied': { en: 'The link to this chat is on the clipboard.', zh: '这个会话的链接已复制。' },
  'side.linkCopyFailed': { en: 'The clipboard refused the link.', zh: '剪贴板拒绝了这次复制。' },
  'settings.profileName': { en: 'Profile name', zh: '配置名称' },
  'settings.profileNamePlaceholder': { en: 'e.g. test-agent', zh: '如:test-agent' },
  'settings.profileSlug': { en: 'Link slug', zh: '链接标识' },
  'settings.profileSlugPlaceholder': { en: 'e.g. principal', zh: '如:principal' },
  'settings.profileSlugHint': {
    en: 'The name of this family in a chat link. It never changes when you rename the profile.',
    zh: '这个家庭在会话链接里的名字。改名不会改它。',
  },
  'settings.endpoint': { en: 'Endpoint', zh: '端点地址' },
  'settings.defaultWorkspace': { en: 'Default workspace', zh: '默认工作区' },
  'settings.workspaceTooltip': {
    en: 'The agent-side working context used by default for new sessions (ADR 0005)',
    zh: '新建会话时默认使用的 agent 侧工作上下文(ADR 0005)',
  },
  'settings.editNote': {
    en: 'Endpoint and workspace changes apply on the next connection.',
    zh: '端点与工作区的修改在下一次连接时生效。',
  },
  'settings.profileMcpGroup': { en: 'MCP servers', zh: 'MCP 服务器' },
  'settings.profileMcpDesc': {
    en: 'Checked servers ride this agent\'s sessions; unchecked ones stay off it.',
    zh: '勾选的服务器随该 agent 的会话加载,未勾选的不加载。',
  },
  'settings.profileMcpEmpty': {
    en: 'No MCP servers configured yet — add them on the MCP page.',
    zh: '还没有配置 MCP 服务器——可在 MCP 分区添加。',
  },
  'settings.deleteMcpConfirmUsed': {
    en: 'Delete MCP server “{name}”? {n} agent profile(s) include it.',
    zh: '删除 MCP 服务器「{name}」?有 {n} 个 agent 配置正在使用它。',
  },
  'settings.nameRequired': { en: 'Profile name is required', zh: '配置名称不能为空' },
  'settings.slugInvalid': { en: 'A slug is lowercase letters, digits and dashes', zh: '标识只能是小写字母、数字和短横线' },
  'settings.slugTaken': { en: 'Another family already uses that slug', zh: '另一个家庭已经用了这个标识' },
  'settings.endpointRequired': { en: 'Endpoint is required', zh: '端点地址不能为空' },
  'settings.pathRequired': { en: 'A local directory needs a path', zh: '本机文件夹需要路径' },
  'settings.mcpNameRequired': { en: 'Server name is required', zh: '服务器名称不能为空' },
  'settings.mcpCommandRequired': { en: 'stdio type needs an executable command', zh: 'stdio 类型需要可执行命令' },
  'settings.mcpUrlRequired': { en: 'A URL is required', zh: '需要一个 URL' },

  // ---- diagnostics (#105): crash fallback + settings diagnostics card ----
  'diag.crashTitle': { en: 'Panda hit an error', zh: 'Panda 遇到了错误' },
  'diag.crashDesc': {
    en: 'The interface stopped rendering. Copy the diagnostics report (error, component stack, recent console log) and reload.',
    zh: '界面停止渲染了。复制诊断报告(错误、组件栈、最近控制台日志)后重新加载。',
  },
  'diag.copyDiagnostics': { en: 'Copy diagnostics', zh: '复制诊断信息' },
  'diag.copied': { en: 'Copied', zh: '已复制' },
  'diag.copyFailed': { en: 'Copy failed', zh: '复制失败' },
  'diag.reload': { en: 'Reload', zh: '重新加载' },
  'diag.cardTitle': { en: 'Diagnostics', zh: '诊断' },
  'diag.cardDesc': {
    en: 'Copy a diagnostics report (app environment and the recent console log — nothing leaves your browser) to attach to a bug report.',
    zh: '复制诊断报告(应用环境与最近控制台日志——数据不会离开你的浏览器),可附在问题反馈里。',
  },
  'settings.colophon': {
    en: 'Panda — a pure-protocol client for any ACP agent',
    zh: 'Panda — 连接任意 ACP agent 的纯协议客户端',
  },

  // ---- workspace ----
  'workspace.none': { en: 'No workspace', zh: '无工作区' },

  // ---- lifecycle projection (busy line / hints) ----
  'lifecycle.awaitingApproval': { en: 'Awaiting approval…', zh: '等待批准中…' },
  // Composer placeholder while a permission/elicitation waits (#216): the
  // input stays writable for drafting, so the copy must say where the real
  // action is instead of claiming work is in progress.
  'lifecycle.awaitingApprovalHint': {
    en: 'Awaiting your approval — respond in the message stream',
    zh: '等待你的批准 — 在消息流中处理',
  },
  'lifecycle.working': { en: 'Panda is working…', zh: 'Panda 正在工作…' },
  'lifecycle.connecting': { en: 'Connecting…', zh: '连接中…' },
  'lifecycle.connectFailed': {
    en: 'Connection failed — reconnect & resume from the sidebar, or connect again',
    zh: '连接失败 — 在侧栏重连并恢复,或重新连接',
  },
  'lifecycle.authRequired': {
    en: 'Sign-in required — pick a login method above',
    zh: '需要登录 — 在上方选择登录方式',
  },
  'lifecycle.disconnected': {
    en: 'Not connected to an ACP service — connect from the sidebar',
    zh: '未连接 ACP 服务 — 在侧栏连接',
  },
  'lifecycle.noSession': {
    en: 'Connected — select an existing session or start a new one',
    zh: '已连接 — 选择已有会话或新建会话',
  },
  'lifecycle.switching': { en: 'Switching session…', zh: '切换会话中…' },

  // ---- session loading (the column while a session switch replays) ----
  'session.loading': { en: 'Loading session…', zh: '正在加载会话…' },

  // ---- live connection driver ----
  'live.switchFailedTitled': {
    en: 'Switching to “{title}” failed: {reason}',
    zh: '切换到「{title}」失败:{reason}',
  },
  'live.retrySwitch': { en: 'Retry', zh: '重试' },
  'live.notice.unknownConnection': { en: 'That connection no longer exists.', zh: '该连接已不存在。' },
  'live.notice.unknownChat': { en: 'That chat is unknown to its family.', zh: '该家庭不认识这个会话。' },
  'live.notice.chatUnavailable': { en: 'That family did not come up, so the chat stays closed.', zh: '该家庭没有连上，会话没有打开。' },
  'settings.notice.saveFailed': {
    en: 'Could not save the agent configuration (storage rejected the write).',
    zh: 'agent 配置保存失败(存储写入被拒)。',
  },

  // ---- ACP client errors (surface via connection.error) ----
  'acp.timeout': { en: '{method} timed out after {s}s', zh: '{method} 超过 {s}s 未应答' },
  // #217: a pre-handshake close is a connect failure — code 1006 collapses
  // refused/unreachable/rejected, so the copy points at the usual causes
  // (agent not running / wrong path) instead of "the server closed".
  'acp.disconnected': { en: 'Connection lost — reconnect from the sidebar', zh: '连接已断开——可从侧栏重连' },
  'acp.connectRefused': {
    en: 'Could not connect — make sure the agent is running at this address and the path points at its ACP endpoint',
    zh: '无法连接——请确认 agent 已在该地址启动、且路径指向它的 ACP 端点',
  },
  'acp.connectClosedEarly': {
    en: 'The connection closed before the session could be established',
    zh: '会话尚未建立,连接即被关闭',
  },
  'acp.protocolMismatch': {
    en: 'the agent negotiated protocol v{agent}, but Panda currently supports only v{ours}',
    zh: 'agent 协商了协议 v{agent},Panda 目前只支持 v{ours}',
  },
  'acp.authNoMethods': {
    en: 'The agent requires authentication but provided no browser-usable login method',
    zh: 'agent 要求认证,但没有提供浏览器可用的登录方式',
  },
  'acp.connectFailed': { en: 'Connection failed: {error}', zh: '连接失败: {error}' },
  'acp.stdioHostMissing': {
    en: 'stdio agents require the Panda desktop app',
    zh: 'stdio agent 需要在 Panda 桌面版中连接',
  },
  'acp.newSessionFailed': { en: 'New session failed: {error}', zh: '新建会话失败: {error}' },
  // 测试连接 (#221) guard rails: the missing-endpoint refusal, and the
  // never-settled sentinel — the probe's handlers must overwrite it.
  'acp.testMissingEndpoint': { en: 'An endpoint is required to test', zh: '缺少端点,无法测试' },
  'acp.testNoOutcome': { en: 'Test produced no result', zh: '测试未返回结果' },
  // ---- operation notices (#160): console-only guard/failure paths surfaced as toasts ----
  'acp.notice.notConnected': { en: 'Not connected to the agent — reconnect first.', zh: '尚未连接 agent,请先重连。' },
  // Ignored-reconnect exits (#238): the request itself was dropped, so the
  // click must still answer — plain cause + remedy copy, one per exit.
  'acp.notice.reconnectNoConnection': {
    en: 'No connection selected — pick an agent in the sidebar first.',
    zh: '未选择连接——请先在侧栏选择一个 agent。',
  },
  'acp.notice.reconnectNoTarget': {
    en: 'This session has no remembered connection target — connect again from New session.',
    zh: '该会话槽没有记住的连接目标——请从「新建会话」重新连接。',
  },
  'acp.notice.reconnectNoWorkspace': {
    en: 'This session has no remembered workspace — connect again from New session.',
    zh: '该会话槽没有记住的工作区——请从「新建会话」重新连接。',
  },
  'acp.notice.busy': { en: 'The agent is busy (a turn or a session switch is still in flight) — try again shortly.', zh: 'agent 正忙(回合或会话切换仍在进行),请稍后再试。' },
  'acp.notice.loadUnsupported': {
    en: 'This agent does not support session/load — switching to another session is unavailable.',
    zh: '该 agent 不支持 session/load,无法切换到其他会话。',
  },
  'acp.notice.deleteUnsupported': { en: 'This agent does not support session/delete.', zh: '该 agent 不支持 session/delete。' },
  'acp.notice.rewindUnsupported': { en: 'This agent does not support rewind.', zh: '该 agent 不支持回退。' },
  'acp.notice.rewindFailed': { en: 'Rewind failed: {error}', zh: '回退失败:{error}' },
  'acp.notice.listFailed': { en: 'Session list fetch failed: {error}', zh: '会话列表拉取失败:{error}' },
  'acp.notice.permissionGone': {
    en: 'That permission request is no longer pending — the answer was not delivered.',
    zh: '该权限请求已不在等待应答,本次应答未能送达。',
  },
  'acp.loginFailed': { en: 'Sign-in failed: {error}', zh: '登录失败: {error}' },
  'acp.deleteSessionFailed': { en: 'Session deletion failed: {error}', zh: '删除会话失败: {error}' },
  'acp.imageHostUnsupported': { en: 'the host does not support this capability', zh: '宿主不支持该能力' },
  'acp.imagePolicyBlocked': { en: 'policy blocks this capability', zh: '策略已禁止该能力' },
  'acp.imageNotDeclared': {
    en: 'the agent did not declare promptCapabilities.image',
    zh: 'agent 未声明 promptCapabilities.image',
  },
  'acp.imageRejected': { en: '{cause} — refusing to send images', zh: '{cause},拒绝发送图片' },
  'acp.fileNotDeclared': {
    en: 'the agent did not declare promptCapabilities.embeddedContext',
    zh: 'agent 未声明 promptCapabilities.embeddedContext',
  },
  'acp.fileRejected': { en: '{cause} — refusing to send files', zh: '{cause},拒绝发送文件' },
  'acp.superseded': { en: 'The connection was replaced by a newer one', zh: '连接已被更新的连接替换' },

  // ---- wire ----
  'wire.unnamedTool': { en: 'Unnamed action', zh: '未命名操作' },
} as const;

export type MessageKey = keyof typeof messages;
