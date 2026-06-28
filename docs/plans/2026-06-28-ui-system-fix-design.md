# UI & System Interaction Fix Design

## Overview
全面修复 AppClaw 项目的系统交互逻辑和 UI 设计问题，共 17 项，按优先级分三部分实施。

## Part 1: Critical Bug Fixes (交互逻辑)

### 1. Stream Listener 重复注册
- **问题**: `chat:onStream` 的 cleanup 函数被忽略，`activeSessionId` 作为依赖导致每次切换 session 重复注册监听器
- **修复**: 在 useEffect 中存储并调用 cleanup 函数
- **文件**: `src/App.tsx` L77-93

### 2. isListening 状态永不更新
- **问题**: `isListening` 声明为 false 且从未设为 true，状态指示器始终显示 "Idle"
- **修复**: sendMessage 开始时设为 true，stream done 时设为 false
- **文件**: `src/App.tsx` L12, L78-93, L116-136

### 3. Error Toast 无自动消失
- **问题**: 必须手动点击关闭，无超时机制
- **修复**: setError 时添加 5s setTimeout 自动清除
- **文件**: `src/App.tsx` L740-750

### 4. Tool Confirm 无 Loading 状态
- **问题**: 点击 Allow/Deny 后 UI 卡住无反馈
- **修复**: 添加 `confirmLoading` 状态，按钮变灰并显示 "Processing..."
- **文件**: `src/App.tsx` L12, L723-737

### 5. 缩进不一致
- **问题**: `loadPopularMarketplace` 少一个前导空格
- **修复**: 对齐缩进
- **文件**: `src/App.tsx` L263

### 6. 版本号硬编码
- **问题**: `v0.4.2` 在两处硬编码
- **修复**: 通过 IPC 从 electron 主进程读取 package.json 版本
- **文件**: `src/App.tsx` L556, L576 + `electron/ipc-handlers.ts`

## Part 2: UI Improvements

### 7. Agent 技能显示名称而非 ID
- **方案**: 用 `skillNameMap` (Map<id, name>) 映射显示
- **文件**: `src/App.tsx` L495-500

### 8. Agent 高亮改用 CSS Class
- **方案**: 定义 `.agent-item.active` 样式，移除 inline style
- **文件**: `src/styles.css` L876-948, `src/App.tsx` L488-490

### 9. 消息时间戳
- **方案**: 消息气泡下方显示 `HH:mm`，hover 显示完整时间
- **文件**: `src/App.tsx` L685-697, `src/styles.css`

### 10. 设置面板滚动位置保持
- **方案**: 为每个 section 缓存 scrollTop
- **文件**: `src/App.tsx` L442-448

### 11. 加载骨架屏
- **方案**: 初始数据加载时显示脉冲动画占位符
- **文件**: `src/App.tsx` L50-75, `src/styles.css`

### 12. Marketplace 搜索输入同步
- **方案**: useEffect 监听 marketplaceQuery 变化同步 searchInput
- **文件**: `src/App.tsx` L812

## Part 3: CSS 清理 & 小改进

### 13-17: CSS class 复用、空消息提示、版本 IPC、响应式准备

## Architecture
- 纯前端修复，无后端架构变更
- UI 修复集中在 `src/App.tsx` 和 `src/styles.css`
- 版本号读取通过新增 IPC handler