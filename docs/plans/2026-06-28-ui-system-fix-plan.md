# UI & System Interaction Fix Implementation Plan

> **For Claude:** Use subagent-driven-development to implement this plan task-by-task.

**Goal:** 全面修复 AppClaw 的 17 项系统交互逻辑和 UI 设计问题

**Architecture:** 纯前端修复，集中在 `src/App.tsx` 和 `src/styles.css`，新增一个 IPC handler 读取版本号

**Tech Stack:** React + TypeScript + CSS Variables + Electron IPC

---

### Task 1: 修复 Stream 监听器重复注册

**Files:**
- Modify: `src/App.tsx:77-93`

**Changes:**
1. 将 `onStream` 返回的 cleanup 函数存储并在 useEffect 的 cleanup 中调用
2. 将 activeSessionId 加入依赖数组确保正确清理

```typescript
useEffect(() => {
  const unsubStream = window.api.chat.onStream((chunk) => {
    if (chunk.done) { setIsLoading(false); return; }
    setMessages(prev => {
      const existing = prev.find(m => m.id === chunk.messageId);
      if (existing) {
        return prev.map(m => m.id === chunk.messageId ? { ...m, content: m.content + chunk.delta } : m);
      } else {
        return [...prev, { id: chunk.messageId, role: 'assistant', content: chunk.delta, sessionId: activeSessionId || '' } as ChatMessage];
      }
    });
  });
  return () => unsubStream();
}, [activeSessionId]);
```

---

### Task 2: 修复 isListening 状态 & 添加 loading 状态

**Files:**
- Modify: `src/App.tsx:12, 78-93, 116-136`

**Changes:**
1. 在 `sendMessage` 开头 `setIsListening(true)`
2. 在 stream done 时 `setIsListening(false)`
3. 在 catch 块中 `setIsListening(false)`
4. 添加 `confirmLoading` 状态变量

---

### Task 3: Error Toast 自动消失 + Tool Confirm Loading

**Files:**
- Modify: `src/App.tsx:12, 741-750, 723-737`

**Changes:**
1. `setError()` 时添加 `setTimeout(() => setError(null), 5000)`
2. 点击 dismiss 时 `clearTimeout`
3. 为 confirm 添加 `confirmLoading` 状态
4. Allow/Deny 后禁用按钮显示 "Processing..."

---

### Task 4: 修复缩进 + 版本号 IPC

**Files:**
- Modify: `src/App.tsx:263, 556, 576`
- Modify: `electron/ipc-handlers.ts`
- Modify: `electron/preload.ts`

**Changes:**
1. 缩进对齐
2. 新增 `app:version` IPC handler
3. preload 暴露 `window.api.app.getVersion()`
4. App.tsx 从 IPC 读取版本号

---

### Task 5: Agent 技能显示名称 + CSS Class 高亮

**Files:**
- Modify: `src/App.tsx:488-498`
- Modify: `src/styles.css:876-948`

**Changes:**
1. 添加 `skillNameMap` 
2. Agent 卡片用 `skillNameMap.get(s) || s` 显示
3. 定义 `.agent-item.active` CSS 样式
4. 移除 agent-item 的内联 style

---

### Task 6: 消息时间戳

**Files:**
- Modify: `src/App.tsx:685-697`
- Modify: `src/styles.css`

**Changes:**
1. 消息气泡下方添加 `<div className="msg-time">{formatTime(m.createdAt)}</div>`
2. CSS 定义 `.msg-time` 样式（小号、muted 颜色）

---

### Task 7: 设置面板滚动保持 + 骨架屏 + Marketplace 同步

**Files:**
- Modify: `src/App.tsx:50-75, 442-448, 812`
- Modify: `src/styles.css`

**Changes:**
1. 为每个 section 缓存 scrollTop 到 ref
2. 初始加载时显示骨架屏
3. Marketplace 添加 useEffect 同步 searchInput