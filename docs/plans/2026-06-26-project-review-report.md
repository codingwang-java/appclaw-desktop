# AppClaw 项目深度审阅报告

本报告针对 AppClaw 桌面端 AI Agent 应用程序进行了深度的源码级审阅，评估范围涵盖主进程架构、进程间通信（IPC）、前端 React 视图组件、内置 MCP 服务以及本地数据库设计。报告总结了该项目在**功能丰富程度**、**用户交互体验**、**页面 UI 设计**三方面的不足，并提出了针对性的**改进计划**。

---

## 一、 功能丰富程度及架构缺失 (Function Richness & Gaps)

虽然项目在设计文档中规划了非常前沿的架构（如 Hermes 的四层记忆模型、双类型 Skill 机制），但在实际的代码实现中存在设计与实现的严重脱节，甚至有数个影响核心功能运转的致命 Bug。

### 1. 技能系统 (Skill System) 处于不可用状态
*   **代码技能 (Code Skill) 运行 Bug**：
    在 `electron/services/skill-manager.ts` 的 `executeSkill` 方法中，JS 代码被载入并放入 `vm.runInContext` 中编译。然而，用户的代码技能通常以 `module.exports = { async execute(params, context) { ... } }` 的形式定义。系统在沙箱编译后**并没有调用 `execute` 方法**，也没有传入 `params` 和 `context`，这导致运行代码技能时什么都不会发生。
*   **声明式技能 (Declarative Skill) 根本无法执行**：
    在前端 `src/App.tsx` 的命令触发逻辑中，如果匹配到了声明式技能，它也会强行调用 `window.api.skill.execute`。但由于声明式技能只有 `SKILL.md` 而没有 `index.js`，该调用会直接因“找不到 index.js”而报错中断。声明式技能本应将其 System Prompt 模板注入到 Agent 的对话上下文，但在现有架构中这部分完全缺失。
*   **技能与 Agent 对话生态割裂**：
    虽然在 UI 上可以把技能关联到某个特定的 Agent，但在大模型对话的实际组装方法 `buildContextMessages` 中，**完全没有读取或注入 Agent 关联技能的逻辑**。LLM 既不知道这些技能的 Prompt 存在，也无法将其作为 Tools 动态调用。

### 2. 记忆系统 (Memory System) 存在大量空实现 (Stubs)
*   **L1 提示词记忆层完全架空**：
    `memory-service.ts` 中的 `loadL1Memory` 和 `saveL1Memory` 仅为返回空字符串/无操作的空函数，规划中的 `MEMORY.md` 和 `USER.md` 读写机制未生效。
*   **L2 会话全文检索未构建**：
    `searchL2` 方法为空实现，且数据库初始化 SQL 中并未如设计文档所规划的那样创建 `messages_fts` 虚拟表和相应的增删改触发器。
*   **L3 长期记忆检索极其原始**：
    虽然数据库的 `long_term_memory` 表预留了 `embedding` 向量字段，但由于缺乏向量生成逻辑，检索记忆时依然采用最原始的 SQL `LIKE %query%` 模糊匹配。
*   **Nudge（记忆提炼与固化）缺失**：
    主进程中的 `triggerNudge` 为空实现。目前的记忆保存仅依赖极其死板的硬编码关键字正则匹配（如“我叫”、“我的名字”等），无法在后台智能分析、提炼和去重。

### 3. 内置 MCP 工具链存在功能遗失
*   **“启动桌面程序 (app_launch)”功能丢失**：
    项目在 `workspace-manager.ts` 中 bypass 了内置 `filesystem` 服务子进程的启动。然而，原本在 `mcp-servers/filesystem/server.js` 中实现的 `app_launch` 工具并没有被移入主进程的 `BUILTIN_TOOLS.filesystem` 中，导致 Agent 丢失了“启动桌面程序”的实际能力。
*   **工具绑定命名混淆**：
    默认 Agent 的工具配置中含有 `shell`。但在 `mcp-manager.ts` 的内置工具映射中没有 `shell` 这一项，它实际上被包含在 `filesystem` 工具组中。这会导致如果用户自定义 Agent 时只开启 `shell`，Agent 将无法加载 `shell_exec` 终端工具。

---

## 二、 用户交互体验 (User Interaction UX)

*   **指令输入不友好**：
    用户在输入 `/` 时没有任何**命令自动补全与提示**。另外，参数解析极其生硬，若用户输入的参数格式不合规或缺失，系统没有引导式表单（Form-based input）来提示输入。
*   **Agent 执行链路黑盒化**：
    当 Agent 执行复杂的工具链（如读取文件 -> 搜索网页 -> 终端编译 -> 截图验证）时，前端只有一个简单的 `CALL` 状态卡片。用户无法看到实时的执行步骤流（Workflow Timeline），容易在漫长等待中感到困惑。
*   **安全确认弹窗 (Confirm Card) 信息度不足**：
    由于执行终端命令或修改文件是高风险操作，当前的确认弹窗只提供了一个简单的原始文本预览（Raw Text Preview），缺乏风险等级提示、差异高亮（Diff）等安全指引。
*   **会话管理能力弱**：
    会话标题只能默认初始化为“新对话 [时间]”。系统没有在对话 1~2 轮后利用 LLM 自动提取关键词来重命名会话。同时，缺少会话的导入导出、归档和搜索功能。

---

## 三、 页面 UI 设计 (UI & Aesthetics)

按照现代 premium 桌面软件的标准，AppClaw 的界面存在较大的打磨空间：

*   **视觉质感平庸，缺乏精致感**：
    *   布局相对生硬，线条和色块对比度不够柔和，缺乏现代设计中流行的**毛玻璃效果 (Glassmorphism)**、卡片微立体阴影、悬浮发光以及流光渐变（Gradients）。
    *   顶部的自定义 TitleBar 样式有些呆板，三个控制按钮的 Hover 交互略显简陋。
*   **交互动效与微交互 (Micro-interactions) 缺席**：
    *   侧边栏折叠/展开、设置面板展开折叠时的过渡动画缺失，动作生硬。
    *   消息气泡载入时缺少平滑弹动、打字机流式输出的渐显动效。
*   **设置页面结构混乱**：
    *   设置项采用大而全的单页手风琴（Accordion）堆叠。当大模型、Skills、Agents、系统通用设置混在一起时，显得极其臃肿。应当采用侧边 Tab 导航或多级子菜单进行清晰隔离。
*   **缺乏记忆与资产的可清可视面板**：
    *   虽然 Agent 拥有独立的 Memory，但用户在前端界面中根本不知道“它现在记住了什么”，无法对长期记忆进行查看、手动修改或一键清除。

---

## 四、 结论与改进计划 (Conclusion & Roadmap)

### 📌 审阅结论
`AppClaw` 是一个**骨架优良、野心很大，但肌肉尚未填充完全**的半成品。其底层的 Electron 与 React 多进程通信架构设计是合理的，且已经成功引入了 `@electric-sql/pglite` 本地轻量级数据库和 MCP 协议。然而，记忆系统的几乎全部留白，技能系统的核心执行 Bug，以及简陋的 UI 和交互，使其目前无法提供流畅、稳定的日常辅助体验。

为了使 AppClaw 真正比慢并超越 Hermes Agent 和 OpenClaw，后续改进应循序渐进地进行：

### 📋 阶段性路线图

#### 第一阶段：核心功能排雷修复 (Bug Fix & Hotfix)
1.  **修复 JS 技能执行引擎**：重构 `skill-manager.ts` 中的 `executeSkill`，在沙箱运行代码后调用导出的 `execute` 函数并传入参数与上下文。
2.  **重构声明式技能执行逻辑**：读取 `SKILL.md`，将 Frontmatter 中注入的参数渲染进 Prompt 正文，并将生成的 Prompt 以 `system` 角色临时追加到 Agent 的 Chat Context 中发送给 LLM。
3.  **整合技能至 Agent 聊天流**：将 Agent 关联的所有技能转换为标准的 Tool 定义，在调用大模型接口时作为 `tools` 注入，使 LLM 能在普通对话中通过 Function Calling 自动唤起技能。
4.  **找回内置工具**：在 `BUILTIN_TOOLS.filesystem` 中补全 `app_launch` 工具，并在 `mcp-manager.ts` 中实现该工具的跨平台启动逻辑。修正 `shell` 在 SQL 初始化中的工具组分类。

#### 第二阶段：补全记忆系统与 FTS/RAG (Memory & Retrieval Upgrade)
1.  **实现 L1 提示词记忆读取与落盘**：读取 `MEMORY.md` 和 `USER.md` 并拼接到大模型每次对话的 Context 顶部。
2.  **利用 PostgreSQL 实现 L2 全文检索**：在 PGlite 中引入 PostgreSQL 自带的 `tsvector` 与 `gin` 索引，并在消息插入时自动同步，在构建 Context 时通过关键词搜索提取相关历史片段。
3.  **重构 L3 情景记忆为向量检索 (RAG)**：引入轻量级的嵌入生成机制（如本地 BGE 模型或第三方 Embedding 接口），在 PGlite 中进行向量余弦相似度检索，获取最相关的背景 Facts。
4.  **落地 Nudge 后台任务**：在对话闲置超时时启动后台 LLM 分析提取任务，提取 Facts 写入 `episodic_memory` 中，自动合并重复或冲突的记忆。

#### 第三阶段：升级交互体验与执行透明显化 (UX & Interaction Upgrade)
1.  **实现指令补全 (Command Auto-Complete)**：在输入框中监听 `/` 输入，弹出浮动的 Skills 联想列表。
2.  **引导式参数输入**：前端弹出精美的参数表单对话框，引导用户填写参数后再提交执行。
3.  **工具调用过程时间线化 (Workflow Timeline)**：将聊天区域的 `CALL` 状态升级为阶梯式工作流步骤展示。
4.  **安全差异比对与高亮 (Security Highlighting)**：在高风险工具（如修改文件、执行 Shell）需要确认时，显示差异比对或危险操作高亮。
5.  **会话智能重命名**：会话进行 3 轮后，触发一次 LLM 总结任务，为当前会话生成简洁的标题。

#### 第四阶段：重塑 UI 视觉美学 (Aesthetic Revamp)
1.  **引入精致的深色系与毛玻璃质感**：使用时下流行的 HSL 色彩调配，将背景更换为带有轻微蓝色/微紫色调的灰黑色，加入 `backdrop-filter: blur` 悬浮卡片。
2.  **重构 Settings 页面为多维 Tabs 导航**：拆分为大模型配置、Agents、Skills、系统设置四个页签。
3.  **设计 Agent 记忆体可视化面板 (Memory Manager Dashboard)**：在 Agent 设置中允许用户直接查看、编辑或删除已记录的 `long_term_memory`。
4.  **增加微交互动效**：消息气泡进场加入弹性动画，打字机输出更加柔和，侧栏折叠平滑过渡。
