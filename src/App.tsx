import React, { useState, useEffect, useRef } from 'react';
import type { ChatMessage, Session, LLMConfig, ToolConfirmRequest, SkillInfo, AgentConfig, CreateAgentRequest, UpdateAgentRequest } from './shared/types';

const SUGGESTIONS = [
  '帮我列出当前目录下有哪些文件',
  '浏览器搜索 React 19 的新特性',
  '记住：我叫张三，住在上海',
  '执行 dir 命令看看 Windows 目录'
];

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'up-to-date';

// 自定义标题栏
function TitleBar({ title }: { title: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    window.api.window?.isMaximized?.().then(setMaximized);
  }, []);

  return (
    <div className="titlebar">
      <div className="titlebar-drag">
        <div className="titlebar-brand">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="url(#g1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <defs><linearGradient id="g1" x1="2" y1="2" x2="22" y2="22"><stop stopColor="#6c8cff"/><stop offset="1" stopColor="#a78bfa"/></linearGradient></defs>
          </svg>
          <span className="titlebar-title">{title}</span>
        </div>
      </div>
      <div className="titlebar-controls">
        <button className="tb-btn" onClick={() => window.api.window?.minimize?.()} title="最小化">
          <svg width="12" height="12" viewBox="0 0 12 12"><rect y="5" width="12" height="1.5" fill="currentColor"/></svg>
        </button>
        <button className="tb-btn" onClick={async () => { await window.api.window?.maximize?.(); setMaximized(await window.api.window?.isMaximized?.() ?? false); }} title={maximized ? '还原' : '最大化'}>
          {maximized
            ? <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2.5" y="0" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/><rect x="0" y="2.5" width="9" height="9" rx="1" fill="var(--bg-primary)" stroke="currentColor" strokeWidth="1.2"/></svg>
            : <svg width="12" height="12" viewBox="0 0 12 12"><rect x="0.5" y="0.5" width="11" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
          }
        </button>
        <button className="tb-btn tb-close" onClick={() => window.api.window?.close?.()} title="关闭">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>
    </div>
  );
}

// 设置折叠面板
function SettingsSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`settings-section${open ? ' open' : ''}`}>
      <div className="settings-section-header" onClick={() => setOpen(!open)}>
        <span className="settings-section-title">{title}</span>
        <svg className="settings-section-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      {open && <div className="settings-section-body">{children}</div>}
    </div>
  );
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [view, setView] = useState<'chat' | 'settings'>('chat');
  const [llmConfig, setLlmConfig] = useState<LLMConfig | null>(null);
  const [configSaved, setConfigSaved] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<ToolConfirmRequest | null>(null);
  const [streamingDeltas, setStreamingDeltas] = useState<Record<string, string>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 更新状态
  const [updateState, setUpdateState] = useState<UpdateState>('idle');
  const [updateVersion, setUpdateVersion] = useState('');
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError, setUpdateError] = useState('');

  // LLM 测试连接
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'fail'>('idle');
  const [testResult, setTestResult] = useState<{ latency?: number; model?: string; error?: string } | null>(null);

  // Skill 管理
  const [skillList, setSkillList] = useState<SkillInfo[]>([]);
  const [showCreateSkill, setShowCreateSkill] = useState(false);
  const [newSkill, setNewSkill] = useState({ name: '', trigger: '', description: '', type: 'declarative' as 'declarative' | 'code', systemPrompt: '' });
  const [skillCreating, setSkillCreating] = useState(false);

  // Marketplace
  const [marketplaceQuery, setMarketplaceQuery] = useState('');
  const [marketplaceSkills, setMarketplaceSkills] = useState<any[]>([]);
  const [marketplaceSearching, setMarketplaceSearching] = useState(false);
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);

  // Agent 管理
  const [agentList, setAgentList] = useState<AgentConfig[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string>('default-agent');
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [showAgentSkillsModal, setShowAgentSkillsModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [newAgent, setNewAgent] = useState<CreateAgentRequest>({ name: '', description: '', model: 'gpt-4o-mini', systemPrompt: '', temperature: 0.7, tools: [] });
  const [agentCreating, setAgentCreating] = useState(false);
  const [agentUpdating, setAgentUpdating] = useState(false);

  // 设置页 Tab
  const [settingsTab, setSettingsTab] = useState<'llm' | 'agents' | 'skills' | 'system' | 'memory'>('llm');

  // 命令自动补全
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteItems, setAutocompleteItems] = useState<SkillInfo[]>([]);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);

  // 记忆管理
  const [memoryList, setMemoryList] = useState<MemoryItem[]>([]);
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [editingMemory, setEditingMemory] = useState<MemoryItem | null>(null);
  const [memoryEditContent, setMemoryEditContent] = useState('');

  // 工作流时间线
  const [toolTimeline, setToolTimeline] = useState<{ id: string; name: string; status: 'running' | 'done' | 'error'; preview: string }[]>([]);

  useEffect(() => { loadInitialData(); setupStreamListener(); setupConfirmListener(); setupUpdateListener(); setupSessionRenameListener(); }, []);
  useEffect(() => { if (activeSessionId) loadMessages(activeSessionId); }, [activeSessionId]);
  useEffect(() => { scrollToBottom(); }, [messages, streamingDeltas]);
  useEffect(() => { if (view === 'settings') loadSkillList(); }, [view]);

  async function loadInitialData() {
    try {
      const s = await window.api.session.list();
      setSessions(s);
      if (s.length > 0) setActiveSessionId(s[0].id);
      const llm = await window.api.llm.getConfig();
      setLlmConfig(llm);
      if (!llm.apiKey) setView('settings');
      await loadAgentList();
    } catch (e) { console.error(e); }
  }

  function setupStreamListener() {
    window.api.chat.onStream(({ messageId, delta, done }) => {
      setStreamingDeltas((prev) => {
        const next = { ...prev };
        if (!done) next[messageId] = (next[messageId] || '') + delta;
        else delete next[messageId];
        return next;
      });
    });
  }

  function setupConfirmListener() { window.api.tools.onConfirm((req) => setPendingConfirm(req)); }

  function setupUpdateListener() {
    window.api.updater.onUpdateAvailable((info) => {
      setUpdateState('available');
      setUpdateVersion(info.version);
    });
    window.api.updater.onUpdateNotAvailable(() => {
      // 仅手动检查时显示"已是最新"
      setUpdateState((prev) => prev === 'checking' ? 'up-to-date' : 'idle');
    });
    window.api.updater.onProgress((progress) => {
      setUpdateState('downloading');
      setUpdateProgress(progress.percent);
    });
    window.api.updater.onDownloaded((info) => {
      setUpdateState('downloaded');
      setUpdateVersion(info.version);
    });
    window.api.updater.onError((err) => {
      setUpdateState('error');
      setUpdateError(err);
    });
  }

  async function loadMessages(sessionId: string) {
    try { setMessages(await window.api.message.list(sessionId)); } catch (e) { console.error(e); }
  }

  async function handleNewSession() {
    try {
      const title = '新对话 ' + new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const s = await window.api.session.create(title, activeAgentId);
      setSessions((prev) => [s, ...prev]);
      setActiveSessionId(s.id);
      setMessages([]);
    } catch (e) { console.error(e); }
  }

  async function handleDeleteSession(sessionId: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('确定删除这个对话？')) return;
    try {
      await window.api.session.delete(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        const remaining = sessions.filter((s) => s.id !== sessionId);
        setActiveSessionId(remaining.length > 0 ? remaining[0].id : '');
      }
    } catch (err) { console.error(err); }
  }

  async function handleSend() {
    if (!inputText.trim() || isLoading) return;
    if (!activeSessionId) { await handleNewSession(); return; }
    const text = inputText.trim();
    setInputText('');
    setIsLoading(true);

    // /command 解析
    if (text.startsWith('/')) {
      const parts = text.slice(1).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
      if (parts.length > 0) {
        const cmd = parts[0].toLowerCase();
        try {
          const skills: SkillInfo[] = await window.api.skill.list();
          const matched = skills.find((s) => {
            const triggerCmd = s.trigger.replace(/^\//, '').toLowerCase();
            return triggerCmd === cmd || triggerCmd === cmd.replace(/-/g, '');
          });
          if (matched) {
            const args: Record<string, string> = {};
            (matched.parameters || []).forEach((p, i) => {
              args[p.name] = parts[i + 1]?.replace(/^["']|["']$/g, '') || p.default || '';
            });

            if (matched.type === 'declarative') {
              const userMsg: ChatMessage = { id: 'u_' + Date.now(), sessionId: activeSessionId, role: 'user', content: text, createdAt: new Date().toISOString() };
              const assistantMsg: ChatMessage = { id: 'a_' + Date.now(), sessionId: activeSessionId, role: 'assistant', content: '', createdAt: new Date().toISOString() };
              setMessages((prev) => [...prev, userMsg, assistantMsg]);
              await window.api.chat.send({ sessionId: activeSessionId, message: text, agentId: activeAgentId, skillId: matched.id, skillArgs: args });
              await loadMessages(activeSessionId);
              setIsLoading(false);
              return;
            } else {
              const result = await window.api.skill.execute(matched.id, args);
              const userMsg: ChatMessage = { id: 'u_' + Date.now(), sessionId: activeSessionId, role: 'user', content: text, createdAt: new Date().toISOString() };
              const assistantContent = result.success ? result.output || '执行完成' : `执行失败: ${result.error}`;
              const assistantMsg: ChatMessage = { id: 'a_' + Date.now(), sessionId: activeSessionId, role: 'assistant', content: assistantContent, createdAt: new Date().toISOString() };
              setMessages((prev) => [...prev, userMsg, assistantMsg]);
              setIsLoading(false);
              return;
            }
          }
        } catch (e) { console.error('Skill 执行错误:', e); }
      }
    }

    try {
      const userMsg: ChatMessage = { id: 'u_' + Date.now(), sessionId: activeSessionId, role: 'user', content: text, createdAt: new Date().toISOString() };
      setMessages((prev) => [...prev, userMsg]);
      const assistantMsg: ChatMessage = { id: 'a_' + Date.now(), sessionId: activeSessionId, role: 'assistant', content: '', createdAt: new Date().toISOString() };
      setMessages((prev) => [...prev, assistantMsg]);
      await window.api.chat.send({ sessionId: activeSessionId, message: text, agentId: activeAgentId });
      await loadMessages(activeSessionId);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 自动补全导航
    if (showAutocomplete) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAutocompleteIndex((i) => Math.min(i + 1, autocompleteItems.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAutocompleteIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        selectAutocomplete(autocompleteItems[autocompleteIndex]);
        return;
      }
      if (e.key === 'Escape') { setShowAutocomplete(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setInputText(val);
    // `/` 自动补全
    if (val.startsWith('/') && val.length > 1 && !val.includes(' ')) {
      const query = val.slice(1).toLowerCase();
      const matches = skillList.filter((s) =>
        s.trigger.replace(/^\//, '').toLowerCase().includes(query) ||
        s.name.toLowerCase().includes(query)
      );
      if (matches.length > 0) {
        setAutocompleteItems(matches);
        setAutocompleteIndex(0);
        setShowAutocomplete(true);
      } else {
        setShowAutocomplete(false);
      }
    } else {
      setShowAutocomplete(false);
    }
  }

  function selectAutocomplete(skill: SkillInfo) {
    setInputText(skill.trigger + ' ');
    setShowAutocomplete(false);
  }

  function setupSessionRenameListener() {
    window.api.session.onRenamed(({ sessionId, title }) => {
      setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, title } : s));
    });
  }

  function handleConfirm(approved: boolean) {
    if (!pendingConfirm) return;
    window.api.tools.respondConfirm(pendingConfirm.messageId, approved);
    setPendingConfirm(null);
  }

  async function handleSaveLlmConfig() {
    if (!llmConfig) return;
    try {
      const ok = await window.api.llm.saveConfig(llmConfig);
      if (ok) { setConfigSaved(true); setTimeout(() => setConfigSaved(false), 2000); }
    } catch (e) { console.error(e); }
  }

  async function handleTestConnection() {
    if (!llmConfig) return;
    setTestStatus('testing');
    setTestResult(null);
    try {
      const result = await window.api.llm.testConnection(llmConfig);
      setTestResult(result);
      setTestStatus(result.success ? 'success' : 'fail');
    } catch (e: any) {
      setTestResult({ error: e.message });
      setTestStatus('fail');
    }
  }

  async function handleCheckUpdate() {
    setUpdateState('checking');
    try {
      const result = await window.api.updater.check();
      if (result.error) {
        setUpdateState('error');
        setUpdateError(result.error);
      } else if (result.available) {
        setUpdateState('available');
        setUpdateVersion(result.version || '');
      } else {
        setUpdateState('up-to-date');
      }
    } catch { setUpdateState('idle'); }
  }

  async function loadSkillList() {
    try { setSkillList(await window.api.skill.list()); } catch (e) { console.error(e); }
  }

  async function handleDeleteSkill(skillId: string) {
    if (!confirm('确定删除这个 Skill？')) return;
    try {
      await window.api.skill.delete(skillId);
      await loadSkillList();
    } catch (e) { console.error(e); }
  }

  async function handleSearchMarketplace() {
    if (!marketplaceQuery.trim()) {
      setMarketplaceSkills([]);
      return;
    }
    setMarketplaceSearching(true);
    try {
      const results = await window.api.skill.marketplace.search(marketplaceQuery);
      setMarketplaceSkills(results);
    } catch (e) { console.error('Marketplace search error:', e); setMarketplaceSkills([]); }
    finally { setMarketplaceSearching(false); }
  }

  async function handleInstallFromMarketplace(skill: any) {
    setInstallingSkillId(skill.id);
    try {
      const result = await window.api.skill.marketplace.install(skill.url);
      if (result) {
        await loadSkillList();
        setMarketplaceSkills((prev) => prev.filter((s) => s.id !== skill.id));
      } else {
        alert('安装失败，请检查网络连接或稍后再试');
      }
    } catch (e) { console.error('Marketplace install error:', e); alert('安装失败'); }
    finally { setInstallingSkillId(null); }
  }

  async function handleCreateSkill() {
    if (!newSkill.name.trim()) return;
    setSkillCreating(true);
    try {
      const id = newSkill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const trigger = newSkill.trigger || ('/' + id);
      await window.api.skill.create({
        id,
        name: newSkill.name.trim(),
        description: newSkill.description,
        trigger: trigger.startsWith('/') ? trigger : '/' + trigger,
        type: newSkill.type,
        tools: [],
        parameters: [],
        enabled: true,
        source: 'local',
        systemPrompt: newSkill.systemPrompt,
      });
      setNewSkill({ name: '', trigger: '', description: '', type: 'declarative', systemPrompt: '' });
      setShowCreateSkill(false);
      await loadSkillList();
    } catch (e) { console.error(e); } finally { setSkillCreating(false); }
  }

  function scrollToBottom() { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }

  // Agent 管理函数
  async function loadAgentList() {
    try { setAgentList(await window.api.agent.list()); } catch (e) { console.error(e); }
  }

  async function handleCreateAgent() {
    if (!newAgent.name.trim()) return;
    setAgentCreating(true);
    try {
      await window.api.agent.create(newAgent);
      setNewAgent({ name: '', description: '', model: 'gpt-4o-mini', systemPrompt: '', temperature: 0.7, tools: [] });
      setShowAgentModal(false);
      await loadAgentList();
    } catch (e) { console.error(e); } finally { setAgentCreating(false); }
  }

  async function handleUpdateAgent() {
    if (!editingAgent || !newAgent.name.trim()) return;
    setAgentUpdating(true);
    try {
      await window.api.agent.update(editingAgent.id, newAgent);
      setEditingAgent(null);
      setNewAgent({ name: '', description: '', model: 'gpt-4o-mini', systemPrompt: '', temperature: 0.7, tools: [] });
      setShowAgentModal(false);
      await loadAgentList();
    } catch (e) { console.error(e); } finally { setAgentUpdating(false); }
  }

  async function handleDeleteAgent(agentId: string) {
    if (agentId === 'default-agent') return;
    if (!confirm('确定删除这个 Agent？所有相关对话和记忆将被删除。')) return;
    try {
      await window.api.agent.delete(agentId);
      if (activeAgentId === agentId) setActiveAgentId('default-agent');
      await loadAgentList();
    } catch (e) { console.error(e); }
  }

  async function handleToggleAgentSkill(agentId: string, skillId: string) {
    try {
      await window.api.agent.toggleSkill(agentId, skillId);
      await loadAgentList();
    } catch (e) { console.error(e); }
  }

  function openEditAgent(agent: AgentConfig) {
    setEditingAgent(agent);
    setNewAgent({
      name: agent.name,
      description: agent.description || '',
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      temperature: agent.temperature,
      tools: agent.tools
    });
    setShowAgentModal(true);
  }

  function openAgentSkills(agent: AgentConfig) {
    setEditingAgent(agent);
    setShowAgentSkillsModal(true);
  }

  // 记忆管理
  async function loadMemoryList() {
    try {
      const list = await window.api.memory.list(activeAgentId, 50);
      setMemoryList(list);
    } catch (e) { console.error(e); }
  }

  async function handleDeleteMemory(memoryId: string) {
    try {
      await window.api.memory.delete(memoryId);
      await loadMemoryList();
    } catch (e) { console.error(e); }
  }

  async function handleSaveMemory() {
    if (!editingMemory || !memoryEditContent.trim()) return;
    try {
      await window.api.memory.update(editingMemory.id, memoryEditContent.trim());
      setEditingMemory(null);
      setMemoryEditContent('');
      await loadMemoryList();
    } catch (e) { console.error(e); }
  }

  function startEditMemory(item: MemoryItem) {
    setEditingMemory(item);
    setMemoryEditContent(item.content);
  }

  function renderMessage(msg: ChatMessage, index: number) {
    if (msg.role === 'tool') {
      return (
        <div key={msg.id || 'tool_' + index} className="msg msg-tool">
          <div className="msg-tool-card">
            <div className="tool-badge">TOOL</div>
            {msg.content}
          </div>
        </div>
      );
    }
    const isStreaming = !!streamingDeltas[msg.id];
    const content = msg.content || streamingDeltas[msg.id] || msg.content;

    return (
      <div key={msg.id || index} className={`msg msg-${msg.role}`}>
        <div className={`msg-avatar msg-avatar-${msg.role}`}>
          {msg.role === 'user' ? 'U' : 'A'}
        </div>
        <div className="msg-body">
          <div className={`msg-bubble${isStreaming && !msg.content ? ' typing' : ''}`}>
            {content || (isStreaming ? '' : '...')}
          </div>
          {msg.toolCalls && msg.toolCalls.length > 0 && (
            <div className="tool-timeline">
              {msg.toolCalls.map((tc, i) => (
                <div key={i} className="timeline-step">
                  <div className="timeline-dot" />
                  <div className="timeline-body">
                    <span className="timeline-tool">{tc.name}</span>
                    <span className="timeline-args">
                      {Object.entries(tc.arguments || {}).map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v).slice(0, 60)}`).join(', ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const activeTitle = sessions.find((s) => s.id === activeSessionId)?.title || 'AppClaw';

  return (
    <div className="app">
      <TitleBar title={view === 'settings' ? 'AppClaw - 设置' : activeTitle} />

      {/* 更新提示条 */}
      {updateState === 'available' && (
        <div className="update-bar">
          <span>发现新版本 v{updateVersion}</span>
          <button className="update-btn" onClick={() => { window.api.updater.download(); setUpdateState('downloading'); setUpdateProgress(0); }}>立即下载</button>
          <button className="update-dismiss" onClick={() => setUpdateState('idle')}>稍后</button>
        </div>
      )}
      {updateState === 'downloading' && (
        <div className="update-bar downloading">
          <span>正在下载更新 {updateProgress}%</span>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${updateProgress}%` }} /></div>
        </div>
      )}
      {updateState === 'downloaded' && (
        <div className="update-bar downloaded">
          <span>v{updateVersion} 已就绪</span>
          <button className="update-btn" onClick={() => window.api.updater.install()}>重启安装</button>
        </div>
      )}
      {updateState === 'error' && (
        <div className="update-bar error">
          <span>更新失败: {updateError}</span>
          <button className="update-dismiss" onClick={() => setUpdateState('idle')}>关闭</button>
        </div>
      )}
      {updateState === 'up-to-date' && (
        <div className="update-bar up-to-date">
          <span>已是最新版本 v{__APP_VERSION__}</span>
          <button className="update-dismiss" onClick={() => setUpdateState('idle')}>关闭</button>
        </div>
      )}

      <div className="app-body">
        {/* 侧栏 */}
        <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
          <div className="sidebar-head">
            {!sidebarCollapsed && <span className="logo-text">AppClaw</span>}
            <button className="icon-btn" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} title={sidebarCollapsed ? '展开' : '收起'}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d={sidebarCollapsed ? 'M6 3l5 5-5 5' : 'M10 3L5 8l5 5'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            {!sidebarCollapsed && (
              <button className="icon-btn" onClick={handleNewSession} title="新对话">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            )}
          </div>

          {!sidebarCollapsed && (
            <>
              <div className="sidebar-label">对话</div>
              <div className="session-list">
                {sessions.map((s) => (
                  <div key={s.id} className={`session-item${s.id === activeSessionId ? ' active' : ''}`} onClick={() => setActiveSessionId(s.id)}>
                    <span className="session-title">{s.title}</span>
                    <button className="session-del" onClick={(e) => handleDeleteSession(s.id, e)}>
                      <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                ))}
                {sessions.length === 0 && <div className="empty-hint">暂无对话</div>}
              </div>
            </>
          )}

          <div className="sidebar-foot">
            <button className={`foot-btn${view === 'settings' ? ' active' : ''}`} onClick={() => setView(view === 'settings' ? 'chat' : 'settings')}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2"/><path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.1 3.1l.7.7M12.2 12.2l.7.7M3.1 12.9l.7-.7M12.2 3.8l.7-.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              {!sidebarCollapsed && <span>设置</span>}
            </button>
          </div>
        </aside>

        {/* 主区域 */}
        <main className="main">
          {view === 'settings' ? (
            <div className="settings">
              <h2 className="settings-heading">设置</h2>
              <div className="settings-tabs">
                <button className={`settings-tab${settingsTab === 'llm' ? ' active' : ''}`} onClick={() => setSettingsTab('llm')}>大模型</button>
                <button className={`settings-tab${settingsTab === 'agents' ? ' active' : ''}`} onClick={() => setSettingsTab('agents')}>Agents</button>
                <button className={`settings-tab${settingsTab === 'skills' ? ' active' : ''}`} onClick={() => setSettingsTab('skills')}>Skills</button>
                <button className={`settings-tab${settingsTab === 'system' ? ' active' : ''}`} onClick={() => setSettingsTab('system')}>系统</button>
                <button className={`settings-tab${settingsTab === 'memory' ? ' active' : ''}`} onClick={() => { setSettingsTab('memory'); loadMemoryList(); }}>记忆</button>
              </div>

              {settingsTab === 'llm' && (
                <>
                  <SettingsSection title="大模型配置" defaultOpen={!llmConfig?.apiKey}>
                    <div className="field">
                      <label>API 提供商</label>
                      <input value={llmConfig?.provider || ''} onChange={(e) => setLlmConfig({ ...llmConfig!, provider: e.target.value as LLMConfig['provider'] })} placeholder="openai / anthropic / deepseek" />
                    </div>
                    <div className="field">
                      <label>API Key</label>
                      <input type="password" value={llmConfig?.apiKey || ''} onChange={(e) => setLlmConfig({ ...llmConfig!, apiKey: e.target.value })} placeholder="sk-..." />
                    </div>
                    <div className="field-row">
                      <div className="field"><label>模型名称</label><input value={llmConfig?.model || ''} onChange={(e) => setLlmConfig({ ...llmConfig!, model: e.target.value })} placeholder="gpt-4o-mini" /></div>
                      <div className="field"><label>Base URL</label><input value={llmConfig?.baseUrl || ''} onChange={(e) => setLlmConfig({ ...llmConfig!, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" /></div>
                    </div>
                    <div className="btn-row">
                      <button className={`btn-primary${configSaved ? ' btn-saved' : ''}`} onClick={handleSaveLlmConfig}>{configSaved ? '已保存' : '保存配置'}</button>
                      <button className={`btn-test${testStatus === 'success' ? ' test-ok' : testStatus === 'fail' ? ' test-fail' : ''}`} onClick={handleTestConnection} disabled={testStatus === 'testing' || !llmConfig?.apiKey}>
                        {testStatus === 'testing' ? '测试中...' : testStatus === 'success' ? '连接成功' : testStatus === 'fail' ? '连接失败' : '测试连接'}
                      </button>
                    </div>
                    {testResult && (
                      <div className={`test-result${testResult.error ? ' test-fail' : ' test-ok'}`}>
                        {testResult.error
                          ? `错误: ${testResult.error}`
                          : `连接成功! 模型: ${testResult.model}, 延迟: ${testResult.latency}ms`
                        }
                      </div>
                    )}
                  </SettingsSection>
                </>
              )}

              {settingsTab === 'agents' && (
                <SettingsSection title="Agents" defaultOpen={true}>
                  <div className="agent-list">
                    {agentList.length === 0 ? (
                      <div className="empty-hint">暂无 Agents</div>
                    ) : (
                      agentList.map((agent) => (
                        <div key={agent.id} className="agent-item">
                          <div className="agent-info">
                            <div className="agent-name">
                              {agent.name}
                              {agent.id === 'default-agent' && <span className="agent-default">默认</span>}
                            </div>
                            <div className="agent-desc">{agent.description || '暂无描述'}</div>
                            <div className="agent-model">{agent.model}</div>
                            {agent.skills && agent.skills.length > 0 && (
                              <div className="agent-skills">
                                <span>已关联 Skills:</span>
                                {agent.skills.map((skillName) => (
                                  <span key={skillName} className="agent-skill-tag">{skillName}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="agent-actions">
                            <button className="agent-btn agent-btn-skills" onClick={() => openAgentSkills(agent)} title="管理 Skills">
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                            </button>
                            {agent.id !== 'default-agent' && (
                              <button className="agent-btn agent-btn-edit" onClick={() => openEditAgent(agent)} title="编辑">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M12 2H6a2 2 0 00-2 2v10a2 2 0 002 2h6a2 2 0 002-2V4a2 2 0 00-2-2z" stroke="currentColor" strokeWidth="1.2"/><path d="M9 2v5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                              </button>
                            )}
                            {agent.id !== 'default-agent' && (
                              <button className="agent-btn agent-btn-del" onClick={() => handleDeleteAgent(agent.id)} title="删除">
                                <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="btn-row">
                    <button className="btn-primary" onClick={() => { setEditingAgent(null); setNewAgent({ name: '', description: '', model: 'gpt-4o-mini', systemPrompt: '', temperature: 0.7, tools: [] }); setShowAgentModal(true); }}>创建 Agent</button>
                  </div>
                </SettingsSection>
              )}

              {settingsTab === 'skills' && (
                <>
                  <SettingsSection title="Skill 商店" defaultOpen={true}>
                    <div className="marketplace-search">
                      <input
                        type="text"
                        value={marketplaceQuery}
                        onChange={(e) => setMarketplaceQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSearchMarketplace(); }}
                        placeholder="搜索 Skills，例如：code-review, translation..."
                        className="marketplace-input"
                      />
                      <button
                        className="btn-primary marketplace-search-btn"
                        onClick={handleSearchMarketplace}
                        disabled={marketplaceSearching}
                      >
                        {marketplaceSearching ? '搜索中...' : '搜索'}
                      </button>
                    </div>
                    {marketplaceSkills.length > 0 && (
                      <div className="marketplace-list">
                        {marketplaceSkills.map((skill) => {
                          const isInstalled = skillList.some((s) => s.id === skill.id || s.name === skill.name);
                          return (
                            <div key={skill.id} className="marketplace-item">
                              <div className="marketplace-item-info">
                                <div className="marketplace-item-name">{skill.name}</div>
                                <div className="marketplace-item-desc">{skill.description}</div>
                                {skill.author && <div className="marketplace-item-author">作者: {skill.author}</div>}
                              </div>
                              <button
                                className={`marketplace-install-btn${isInstalled ? ' installed' : ''}`}
                                onClick={() => !isInstalled && handleInstallFromMarketplace(skill)}
                                disabled={isInstalled || installingSkillId === skill.id}
                              >
                                {isInstalled ? '已安装' : installingSkillId === skill.id ? '安装中...' : '安装'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {!marketplaceSearching && marketplaceQuery && marketplaceSkills.length === 0 && (
                      <div className="empty-hint">未找到相关 Skill</div>
                    )}
                  </SettingsSection>

                  <SettingsSection title="已安装的 Skills" defaultOpen={true}>
                  <div className="skill-list">
                    {skillList.length === 0 ? (
                      <div className="empty-hint">暂无已安装的 Skills</div>
                    ) : (
                      skillList.map((skill) => (
                        <div key={skill.id} className="skill-item">
                          <div className="skill-info">
                            <div className="skill-name">
                              {skill.name}
                              <span className="skill-type">{skill.type}</span>
                            </div>
                            <div className="skill-desc">{skill.description}</div>
                            <div className="skill-trigger">触发命令: {skill.trigger}</div>
                          </div>
                          <div className="skill-actions">
                            <button className="skill-btn" onClick={async () => { try { const base64 = await window.api.skill.export(skill.id); if (base64) { const blob = new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))]); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${skill.id}.zip`; a.click(); URL.revokeObjectURL(url); } } catch (e) { console.error(e); } }} title="导出">
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2v10M5 9l3 3 3-3M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            </button>
                            <button className="skill-btn skill-del" onClick={() => handleDeleteSkill(skill.id)} title="删除">
                              <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {showCreateSkill ? (
                    <div className="skill-create-form">
                      <div className="field">
                        <label>Skill 名称</label>
                        <input value={newSkill.name} onChange={(e) => setNewSkill({ ...newSkill, name: e.target.value })} placeholder="例如：代码审查" />
                      </div>
                      <div className="field-row">
                        <div className="field">
                          <label>触发命令</label>
                          <input value={newSkill.trigger} onChange={(e) => setNewSkill({ ...newSkill, trigger: e.target.value })} placeholder="/code-review" />
                        </div>
                        <div className="field">
                          <label>类型</label>
                          <select value={newSkill.type} onChange={(e) => setNewSkill({ ...newSkill, type: e.target.value as 'declarative' | 'code' })}>
                            <option value="declarative">声明式</option>
                            <option value="code">代码式</option>
                          </select>
                        </div>
                      </div>
                      <div className="field">
                        <label>描述</label>
                        <input value={newSkill.description} onChange={(e) => setNewSkill({ ...newSkill, description: e.target.value })} placeholder="简要描述这个 Skill 的功能" />
                      </div>
                      <div className="field">
                        <label>系统提示词</label>
                        <textarea value={newSkill.systemPrompt} onChange={(e) => setNewSkill({ ...newSkill, systemPrompt: e.target.value })} placeholder="当触发此 Skill 时，会注入到对话上下文的系统提示词..." rows={4} />
                      </div>
                      <div className="btn-row">
                        <button className="btn-primary" onClick={handleCreateSkill} disabled={skillCreating || !newSkill.name.trim()}>
                          {skillCreating ? '创建中...' : '创建 Skill'}
                        </button>
                        <button className="btn-cancel" onClick={() => setShowCreateSkill(false)}>取消</button>
                      </div>
                    </div>
                  ) : (
                    <div className="btn-row">
                      <button className="btn-primary" onClick={() => setShowCreateSkill(true)}>创建 Skill</button>
                      <label className="btn-primary" style={{ cursor: 'pointer' }}>
                        导入 Skill
                        <input type="file" accept=".zip" style={{ display: 'none' }} onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const reader = new FileReader();
                            reader.onload = async (ev) => {
                              const base64 = btoa(String.fromCharCode(...new Uint8Array(ev.target!.result as ArrayBuffer)));
                              await window.api.skill.import(base64);
                              await loadSkillList();
                            };
                            reader.readAsArrayBuffer(file);
                          } catch (err) { console.error(err); }
                        }} />
                      </label>
                    </div>
                  )}
                  <p className="skill-hint">提示：在对话中输入 <code>/命令</code> 即可触发 Skill</p>
                </SettingsSection>
                </>
              )}

              {settingsTab === 'system' && (
                <>
                  <SettingsSection title="检查更新">
                    <div className="update-section">
                      <span className="update-info">当前版本: {__APP_VERSION__}</span>
                      <button className="btn-primary" onClick={handleCheckUpdate} disabled={updateState === 'checking'}>
                        {updateState === 'checking' ? '检查中...' : '检查更新'}
                      </button>
                    </div>
                  </SettingsSection>
                  <SettingsSection title="关于 AppClaw">
                    <p className="about-text">桌面端 AI 助手，支持对话式交互、文件系统读写、浏览器搜索、命令行执行、启动桌面程序，以及长期记忆（PGlite 本地存储）。所有数据保存在 ~/.appclaw/ 目录下。</p>
                  </SettingsSection>
                </>
              )}

              {settingsTab === 'memory' && (
                <SettingsSection title="长期记忆管理" defaultOpen={true}>
                  <div className="memory-list">
                    {memoryList.length === 0 ? (
                      <div className="empty-hint">暂无记忆数据</div>
                    ) : (
                      memoryList.map((item) => (
                        <div key={item.id} className="memory-item">
                          {editingMemory?.id === item.id ? (
                            <div className="memory-edit">
                              <textarea value={memoryEditContent} onChange={(e) => setMemoryEditContent(e.target.value)} rows={3} />
                              <div className="btn-row">
                                <button className="btn-primary" onClick={handleSaveMemory}>保存</button>
                                <button className="btn-cancel" onClick={() => setEditingMemory(null)}>取消</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="memory-content">{item.content}</div>
                              <div className="memory-actions">
                                <button className="agent-btn agent-btn-edit" onClick={() => startEditMemory(item)} title="编辑">
                                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M12 2H6a2 2 0 00-2 2v10a2 2 0 002 2h6a2 2 0 002-2V4a2 2 0 00-2-2z" stroke="currentColor" strokeWidth="1.2"/><path d="M9 2v5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                                </button>
                                <button className="agent-btn agent-btn-del" onClick={() => handleDeleteMemory(item.id)} title="删除">
                                  <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </SettingsSection>
              )}
            </div>
          ) : (
            <>
              <div className="chat-top">
                <div className="chat-top-title">{activeTitle}</div>
                <div className="chat-top-right">
                  <div className="agent-selector">
                    <select value={activeAgentId} onChange={(e) => setActiveAgentId(e.target.value)}>
                      {agentList.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                    <button className="agent-settings-btn" onClick={() => setView('settings')} title="管理 Agents">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2"/><path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                  <div className={`status-dot${llmConfig?.apiKey ? ' on' : ''}`}>
                    <span className="dot" />
                    {llmConfig?.apiKey ? `${llmConfig.model || '已连接'}` : '未配置'}
                  </div>
                </div>
              </div>

              <div className="messages">
                {messages.length === 0 ? (
                  <div className="welcome">
                    <div className="welcome-icon">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="url(#wg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><defs><linearGradient id="wg" x1="2" y1="2" x2="22" y2="22"><stop stopColor="#6c8cff"/><stop offset="1" stopColor="#a78bfa"/></linearGradient></defs></svg>
                    </div>
                    <h2>你好，我是 AppClaw</h2>
                    <p>一个能调用你电脑的桌面 AI 助手</p>
                    <div className="chips">
                      {SUGGESTIONS.map((s, i) => (
                        <button key={i} className="chip" onClick={() => setInputText(s)}>{s}</button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {messages.map((msg, idx) => renderMessage(msg, idx))}
                    {pendingConfirm && (
                      <div className="msg msg-assistant">
                        <div className="msg-avatar msg-avatar-assistant">A</div>
                        <div className="msg-body">
                          <div className="confirm-card">
                            <div className="confirm-title">
                              <span className={`risk-badge risk-${pendingConfirm.risk}`}>
                                {pendingConfirm.risk === 'high' ? '高危' : pendingConfirm.risk === 'medium' ? '中危' : '低危'}
                              </span>
                              需要你的确认
                            </div>
                            <div className="confirm-body">
                              <pre>{pendingConfirm.preview}</pre>
                            </div>
                            <div className="confirm-btns">
                              <button className="btn-allow" onClick={() => handleConfirm(true)}>允许执行</button>
                              <button className="btn-deny" onClick={() => handleConfirm(false)}>拒绝</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              <div className="input-area">
                <div className="input-box">
                  {showAutocomplete && (
                    <div className="autocomplete-popup">
                      {autocompleteItems.map((item, i) => (
                        <div key={item.id} className={`autocomplete-item${i === autocompleteIndex ? ' active' : ''}`} onClick={() => selectAutocomplete(item)} onMouseEnter={() => setAutocompleteIndex(i)}>
                          <span className="ac-trigger">{item.trigger}</span>
                          <span className="ac-desc">{item.description}</span>
                          <span className="ac-type">{item.type}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea value={inputText} onChange={handleInputChange} onKeyDown={handleKeyDown} placeholder="输入消息，Enter 发送，/ 触发技能..." rows={1} />
                  <button className="send-btn" onClick={handleSend} disabled={isLoading || !inputText.trim()}>
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M2 8l12-6-6 12V8H2z" fill="currentColor"/></svg>
                  </button>
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {/* Agent 创建/编辑 模态框 */}
      {showAgentModal && (
        <div className="modal-overlay" onClick={() => { setShowAgentModal(false); setEditingAgent(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingAgent ? '编辑 Agent' : '创建 Agent'}</h3>
              <button className="modal-close" onClick={() => { setShowAgentModal(false); setEditingAgent(null); }}>
                <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>Agent 名称</label>
                <input value={newAgent.name} onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })} placeholder="例如：办公助手" />
              </div>
              <div className="field">
                <label>描述</label>
                <input value={newAgent.description} onChange={(e) => setNewAgent({ ...newAgent, description: e.target.value })} placeholder="简要描述这个 Agent 的功能" />
              </div>
              <div className="field">
                <label>模型</label>
                <input value={newAgent.model} onChange={(e) => setNewAgent({ ...newAgent, model: e.target.value })} placeholder="gpt-4o-mini" />
              </div>
              <div className="field">
                <label>温度</label>
                <input type="number" step="0.1" min="0" max="2" value={newAgent.temperature} onChange={(e) => setNewAgent({ ...newAgent, temperature: parseFloat(e.target.value) })} />
              </div>
              <div className="field">
                <label>系统提示词</label>
                <textarea value={newAgent.systemPrompt} onChange={(e) => setNewAgent({ ...newAgent, systemPrompt: e.target.value })} placeholder="设置这个 Agent 的角色和行为..." rows={6} />
              </div>
              <div className="field">
                <label>可用工具（逗号分隔）</label>
                <input value={newAgent.tools.join(',')} onChange={(e) => setNewAgent({ ...newAgent, tools: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} placeholder="file_read, file_write, web_search, run_command, open_app" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => { setShowAgentModal(false); setEditingAgent(null); }}>取消</button>
              <button className="btn-primary" onClick={editingAgent ? handleUpdateAgent : handleCreateAgent} disabled={(agentCreating || agentUpdating) || !newAgent.name.trim()}>
                {agentCreating || agentUpdating ? '保存中...' : (editingAgent ? '保存修改' : '创建 Agent')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Agent Skills 关联 模态框 */}
      {showAgentSkillsModal && editingAgent && (
        <div className="modal-overlay" onClick={() => { setShowAgentSkillsModal(false); setEditingAgent(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingAgent.name} - 管理 Skills</h3>
              <button className="modal-close" onClick={() => { setShowAgentSkillsModal(false); setEditingAgent(null); }}>
                <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="skill-assign-list">
                {skillList.length === 0 ? (
                  <div className="empty-hint">暂无 Skills，请先创建</div>
                ) : (
                  skillList.map((skill) => {
                    const isAssigned = editingAgent.skills?.includes(skill.id) || false;
                    return (
                      <div key={skill.id} className={`skill-assign-item${isAssigned ? ' assigned' : ''}`}>
                        <div className="skill-assign-info">
                          <div className="skill-assign-name">{skill.name}</div>
                          <div className="skill-assign-desc">{skill.description}</div>
                        </div>
                        <button className={`skill-assign-toggle${isAssigned ? ' active' : ''}`} onClick={() => handleToggleAgentSkill(editingAgent!.id, skill.id)}>
                          {isAssigned ? '已关联' : '关联'}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={() => { setShowAgentSkillsModal(false); setEditingAgent(null); }}>完成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
