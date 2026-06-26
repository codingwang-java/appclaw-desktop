import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChatMessage, Session, LLMConfig, SkillInfo, ToolConfirmRequest } from './shared/types';
import './styles.css';

function App() {
  const [view, setView] = useState<'chat' | 'settings'>('welcome');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({ apiKey: '', model: '', baseUrl: '' });
  const [showSettings, setShowSettings] = useState(false);
  const [tools, setTools] = useState<any[]>([]);
  const [confirmReq, setConfirmReq] = useState<ToolConfirmRequest | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Agent & Skill state
  const [agents, setAgents] = useState<any[]>([]);
  const [localSkills, setLocalSkills] = useState<SkillInfo[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string>('default');
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<any>(null);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [editingSkill, setEditingSkill] = useState<any>(null);
  const [showSkillAssign, setShowSkillAssign] = useState<string | null>(null);
  const [skillSearchQuery, setSkillSearchQuery] = useState('');

  // Update state
  const [updateState, setUpdateState] = useState<{ status: string; version?: string; progress?: number }>({ status: 'idle' });

  // Settings drawer state
  const [activeSetting, setActiveSetting] = useState<string>('llm');
  const [drawerLevel, setDrawerLevel] = useState<1 | 2 | 3>(2);
  const [drawerStack, setDrawerStack] = useState<{ level: 1 | 2 | 3; setting: string; data?: any }[]>([{ level: 2, setting: 'llm' }]);
  const [marketplaceSkills, setMarketplaceSkills] = useState<any[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceQuery, setMarketplaceQuery] = useState('');
  const [installedSkillIds, setInstalledSkillIds] = useState<Set<string>>(new Set());
  const [installedSkillNames, setInstalledSkillNames] = useState<Set<string>>(new Set());

  // LLM test
  const [testResult, setTestResult] = useState<{ ok?: boolean; msg: string } | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // Load initial data
  useEffect(() => {
    (async () => {
      try {
        const [s, m, t, sk, ag] = await Promise.all([
          window.api.session.list().catch(() => []),
          window.api.llm.getConfig().catch(() => ({ apiKey: '', model: '', baseUrl: '' })),
          window.api.tools.list().catch(() => []),
          window.api.skill.list().catch(() => []),
          window.api.agent?.list().catch(() => []) || Promise.resolve([]),
        ]);
        setSessions(s);
        setLlmConfig(m);
        setTools(t);
        setLocalSkills(sk);
        setAgents(ag);
        if (s.length > 0) {
          setActiveSessionId(s[0].id);
          const msgs = await window.api.message.list(s[0].id).catch(() => []);
          setMessages(msgs);
          setView('chat');
        } else {
          setView('welcome');
        }
      } catch (e) { setError('Failed to load data'); }
    })();
  }, []);

// Stream listener
  useEffect(() => {
    window.api.chat.onStream((chunk) => {
      if (chunk.done) {
        setIsLoading(false);
        return;
      }
      setMessages(prev => {
        const existing = prev.find(m => m.id === chunk.messageId);
        if (existing) {
          return prev.map(m => m.id === chunk.messageId ? { ...m, content: m.content + chunk.delta } : m);
        } else {
          return [...prev, { id: chunk.messageId, role: 'assistant', content: chunk.delta, sessionId: activeSessionId || '' } as ChatMessage];
        }
      });
    });
  }, [activeSessionId]);

  // Tool confirm listener
  useEffect(() => {
    window.api.tools.onConfirm((req) => setConfirmReq(req));
  }, []);

  // Scroll to bottom
  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);

  // Update listener
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    unsubs.push(window.api.updater.onUpdateAvailable((info) => setUpdateState({ status: 'available', version: info.version })));
    unsubs.push(window.api.updater.onUpdateNotAvailable(() => setUpdateState({ status: 'up-to-date' })));
    unsubs.push(window.api.updater.onProgress((p) => setUpdateState(prev => ({ ...prev, status: 'downloading', progress: p.percent }))));
    unsubs.push(window.api.updater.onDownloaded((info) => setUpdateState({ status: 'downloaded', version: info.version })));
    unsubs.push(window.api.updater.onError((err) => setUpdateState({ status: 'error' })));
    return () => unsubs.forEach(fn => fn());
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: input.trim(), sessionId: activeSessionId || '' };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    try {
      let sid = activeSessionId;
      if (!sid) {
        const s = await window.api.session.create(input.trim().slice(0, 40) || 'New Chat');
        setSessions(prev => [s, ...prev]);
        setActiveSessionId(s.id);
        sid = s.id;
        setView('chat');
      }
      await window.api.chat.send({ sessionId: sid, message: userMsg.content, agentId: activeAgentId });
    } catch (e: any) {
      setIsLoading(false);
      setError(e.message || 'Send failed');
    }
  };

  const createSession = async () => {
    const s = await window.api.session.create('New Chat');
    setSessions(prev => [s, ...prev]);
    setActiveSessionId(s.id);
    setMessages([]);
    setView('chat');
  };

  const deleteSession = async (id: string) => {
    await window.api.session.delete(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
      setMessages([]);
      if (sessions.length < 2) setView('welcome');
    }
  };

  const selectSession = async (id: string) => {
    setActiveSessionId(id);
    const msgs = await window.api.message.list(id).catch(() => []);
    setMessages(msgs);
    setView('chat');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ---- Settings Drawer Navigation ----
  // Click nav item -> always show content panel (level 2)
  const navigateSetting = (setting: string) => {
    setActiveSetting(setting);
    setDrawerLevel(2);
    setDrawerStack(prev => [{ level: 1, setting: prev[0]?.setting || 'llm' }, { level: 2, setting, data: null }]);
  };

  const pushDrawer = (setting: string, data?: any) => {
    const nextLevel = Math.min((drawerLevel + 1) as 1 | 2 | 3, 3);
    setDrawerLevel(nextLevel);
    setActiveSetting(setting);
    setDrawerStack(prev => [...prev, { level: nextLevel, setting, data }]);
  };

  const popDrawer = () => {
    if (drawerStack.length <= 1) return;
    const newStack = drawerStack.slice(0, -1);
    setDrawerStack(newStack);
    const prev = newStack[newStack.length - 1];
    setDrawerLevel(prev.level);
    setActiveSetting(prev.setting);
    // Reset modal states when closing Layer 3
    setShowAgentModal(false);
    setEditingAgent(null);
    setShowSkillModal(false);
    setEditingSkill(null);
  };

  // ---- Agent actions ----
  const loadAgents = async () => {
    const ag = await window.api.agent?.list().catch(() => []) || [];
    setAgents(ag);
  };

  const saveAgent = async (agent: any) => {
    if (editingAgent) {
      await window.api.agent?.update(agent.id, agent);
    } else {
      await window.api.agent?.create(agent);
    }
    setEditingAgent(null);
    setShowAgentModal(false);
    loadAgents();
  };

  const deleteAgent = async (id: string) => {
    await window.api.agent?.delete(id);
    loadAgents();
    if (activeAgentId === id) setActiveAgentId('default');
  };

  const toggleSkillForAgent = async (agentId: string, skillId: string) => {
    await window.api.agent?.toggleSkill(agentId, skillId);
    loadAgents();
  };

  // ---- Skill actions ----
  const loadSkills = async () => {
    const sk = await window.api.skill.list().catch(() => []);
    setLocalSkills(sk);
    setInstalledSkillIds(new Set(sk.map(s => s.id.toLowerCase())));
    setInstalledSkillNames(new Set(sk.map(s => s.name.toLowerCase())));
  };

  const saveSkill = async (skill: any) => {
    if (editingSkill) {
      await window.api.skill.save(skill.id, skill);
    } else if (skill.systemPrompt) {
      await window.api.skill.create({ name: skill.name, description: skill.description, id: skill.id, systemPrompt: skill.systemPrompt });
    } else {
      await window.api.skill.create(skill);
    }
    setEditingSkill(null);
    setShowSkillModal(false);
    loadSkills();
  };

  const deleteSkill = async (id: string) => {
    await window.api.skill.delete(id);
    loadSkills();
  };

  // ---- Marketplace ----
  const searchMarketplace = async (query: string) => {
    setMarketplaceLoading(true);
    setMarketplaceQuery(query);
    try {
      const results = await window.api.skill.marketplace.search(query);
      setMarketplaceSkills(results);
    } catch (e: any) {
      setMarketplaceSkills([{ error: e.message }]);
    }
    setMarketplaceLoading(false);
  };

const loadPopularMarketplace = async () => {
    setMarketplaceLoading(true);
    setMarketplaceQuery('');
    try {
      const results = await window.api.skill.marketplace.popular();
      setMarketplaceSkills(results);
    } catch (e: any) {
      setMarketplaceSkills([{ error: e.message }]);
    }
    setMarketplaceLoading(false);
  };

  const installMarketplaceSkill = async (skill: any) => {
    const result = await window.api.skill.marketplace.install(skill.id, skill.name, skill.skillDir);
    if (result.success) {
      loadSkills();
      if (marketplaceQuery) searchMarketplace(marketplaceQuery);
      else loadPopularMarketplace();
    }
    return result;
  };

  // ---- Scroll into view ----
  const settingsRef = useRef<HTMLDivElement>(null);

  // ---- LLM Test ----
  const testConnection = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const r = await window.api.llm.testConnection(llmConfig);
      setTestResult({ ok: r.success, msg: r.success ? `✓ Connected (${r.model || ''}, ${r.latency?.toFixed(0)}ms)` : `✗ ${r.error || 'Failed'}` });
    } catch (e: any) {
      setTestResult({ ok: false, msg: `✗ ${e.message}` });
    }
    setTestLoading(false);
  };

  const activeTitle = sessions.find((s) => s.id === activeSessionId)?.title || 'AppClaw';

  // ---- Render ----
  return (
    <div className="app">
      {/* Title Bar */}
      <div className="titlebar">
        <div className="titlebar-drag">
          <div className="titlebar-brand">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#6c8cff' }}>
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
            <span className="titlebar-title">AppClaw</span>
          </div>
        </div>
        <div className="titlebar-controls">
          <button className="tb-btn" onClick={() => window.api.window.minimize()}>
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          <button className="tb-btn" onClick={() => window.api.window.maximize()}>
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
          </button>
          <button className="tb-btn tb-close" onClick={() => window.api.window.close()}>
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
      </div>

      <div className="app-body">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sidebar-head">
            <span className="logo-text">AppClaw</span>
            <button className="icon-btn" title="New Chat" onClick={createSession}>
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            </button>
          </div>
          <div className="sidebar-label">Sessions</div>
          <div className="session-list">
            {sessions.length === 0 && <div className="empty-hint">No sessions yet</div>}
            {sessions.map(s => (
              <div key={s.id} className={`session-item ${activeSessionId === s.id ? 'active' : ''}`} onClick={() => selectSession(s.id)}>
                <span className="session-title">{s.title || 'Untitled'}</span>
                <button className="session-del" onClick={e => { e.stopPropagation(); deleteSession(s.id); }}>
                  <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </button>
              </div>
            ))}
          </div>
          <div className="sidebar-foot">
            <button className={`foot-btn ${showSettings ? 'active' : ''}`} onClick={() => {
              if (showSettings) {
                // Reset drawer state when closing
                setDrawerLevel(2);
                setActiveSetting('llm');
                setDrawerStack([{ level: 2, setting: 'llm' }]);
                setShowAgentModal(false);
                setEditingAgent(null);
                setShowSkillModal(false);
                setEditingSkill(null);
              }
              setShowSettings(!showSettings);
            }}>
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 10a2 2 0 100-4 2 2 0 000 4z" fill="none" stroke="currentColor" strokeWidth="1.3"/><path d="M13.5 8a5.5 5.5 0 01-.3 1.8l1.3 1-1 1.7-1.5-.6a5.5 5.5 0 01-1.6.9L10 14H8.5l-.4-1.6a5.5 5.5 0 01-1.6-.9l-1.5.6-1-1.7 1.3-1A5.5 5.5 0 014.5 8a5.5 5.5 0 01.3-1.8l-1.3-1 1-1.7 1.5.6a5.5 5.5 0 011.6-.9L8.5 2H10l.4 1.6a5.5 5.5 0 011.6.9l1.5-.6 1 1.7-1.3 1A5.5 5.5 0 0113.5 8z" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
              Settings
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="main" style={showSettings ? { padding: 0, overflow: 'hidden' } : {}}>
          {/* Update Bar */}
          {updateState.status === 'available' && (
            <div className="update-bar">
              <span>Update v{updateState.version} available</span>
              <button className="update-btn" onClick={() => window.api.updater.download()}>Download</button>
              <button className="update-dismiss" onClick={() => setUpdateState({ status: 'idle' })}>Dismiss</button>
            </div>
          )}
          {updateState.status === 'downloading' && (
            <div className="update-bar downloading">
              <span>Downloading update...</span>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${updateState.progress || 0}%` }} /></div>
              <span>{updateState.progress?.toFixed(0)}%</span>
            </div>
          )}
          {updateState.status === 'downloaded' && (
            <div className="update-bar downloaded">
              <span>Update ready</span>
              <button className="update-btn" onClick={() => window.api.updater.install()}>Install & Restart</button>
            </div>
          )}
          {updateState.status === 'error' && (
            <div className="update-bar error">
              <span>Update check failed</span>
              <button className="update-dismiss" onClick={() => setUpdateState({ status: 'idle' })}>Dismiss</button>
            </div>
          )}
          {updateState.status === 'up-to-date' && (
            <div className="update-bar up-to-date">
              <span>App is up to date</span>
              <button className="update-dismiss" onClick={() => setUpdateState({ status: 'idle' })}>Dismiss</button>
            </div>
          )}

          {showSettings ? (
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* ===== Settings Drawer Layer 1: Navigation ===== */}
              <div style={{
                width: 200, background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)',
                display: 'flex', flexDirection: 'column', flexShrink: 0
              }}>
                <div style={{ padding: '20px 16px 12px', fontSize: 14, fontWeight: 700 }}>Settings</div>
                {[
                  { key: 'llm', label: 'LLM Config', icon: 'M12 2L2 7l10 5 10-5-10-5z' },
                  { key: 'agents', label: 'Agents', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8z M2 21v-2a6 6 0 0112 0v2' },
                  { key: 'skills', label: 'Skills', icon: 'M9 11l3-3 3 3 M12 2v8' },
                  { key: 'updates', label: 'Updates', icon: 'M12 2v4M12 22v-4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M22 12h-4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83' },
                  { key: 'about', label: 'About', icon: 'M12 12c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z M12 14c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' },
                ].map(item => (
                  <button key={item.key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', width: '100%',
                      textAlign: 'left', fontSize: 13, color: activeSetting === item.key ? 'var(--accent)' : 'var(--text-secondary)',
                      background: activeSetting === item.key ? 'var(--accent-glow)' : 'transparent',
                      borderRight: activeSetting === item.key ? '2px solid var(--accent)' : '2px solid transparent',
                      transition: 'all var(--transition-fast)'
                    }}
                    onClick={() => navigateSetting(item.key)}
                    onMouseEnter={e => { if (activeSetting !== item.key) (e.target as HTMLElement).style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={e => { if (activeSetting !== item.key) (e.target as HTMLElement).style.background = 'transparent'; }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d={item.icon} />
                    </svg>
                    {item.label}
                  </button>
                ))}
              </div>

              {/* ===== Settings Drawer Layer 2: Content ===== */}
              <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                <div style={{
                  flex: 1, overflow: 'auto',
                  borderRight: drawerLevel >= 3 ? '1px solid var(--border)' : 'none',
                  padding: '24px 28px', maxWidth: drawerLevel >= 3 ? '55%' : '100%',
                  transition: 'all 0.25s'
                }}>
                  {/* LLM Config */}
                  {activeSetting === 'llm' && (
                    <div className="settings" style={{ padding: 0, maxWidth: '100%' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>LLM Configuration</div>
                      <div className="field">
                        <label>API Key</label>
                        <input type="password" value={llmConfig.apiKey} onChange={e => setLlmConfig(p => ({ ...p, apiKey: e.target.value }))} placeholder="sk-..." />
                      </div>
                      <div className="field-row">
                        <div className="field">
                          <label>Base URL</label>
                          <input value={llmConfig.baseUrl} onChange={e => setLlmConfig(p => ({ ...p, baseUrl: e.target.value }))} placeholder="https://api.openai.com/v1" />
                        </div>
                        <div className="field">
                          <label>Model</label>
                          <input value={llmConfig.model} onChange={e => setLlmConfig(p => ({ ...p, model: e.target.value }))} placeholder="gpt-4o" />
                        </div>
                      </div>
                      <div className="btn-row">
                        <button className="btn-primary" onClick={() => { window.api.llm.saveConfig(llmConfig); setUpdateState({ status: 'up-to-date' }); setTimeout(() => setUpdateState({ status: 'idle' }), 1500); }}>Save</button>
                        <button className={`btn-test ${testLoading ? '' : testResult?.ok ? 'test-ok' : testResult?.ok === false ? 'test-fail' : ''}`}
                          onClick={testConnection} disabled={testLoading || !llmConfig.apiKey}>{testLoading ? 'Testing...' : 'Test Connection'}</button>
                      </div>
                      {testResult && <div className={`test-result ${testResult.ok ? 'test-ok' : 'test-fail'}`}>{testResult.msg}</div>}
                      <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 12 }}>Changes are saved locally.</div>
                    </div>
                  )}

                  {/* Agents */}
                  {activeSetting === 'agents' && (
                    <div className="settings" style={{ padding: 0, maxWidth: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>Agents</div>
                        <button className="btn-primary" style={{ padding: '7px 16px', fontSize: 13 }}
                          onClick={() => { setEditingAgent(null); pushDrawer('agent-form'); setShowAgentModal(true); }}>+ New Agent</button>
                      </div>
                      {agents.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 40 }}>No agents configured</div>}
                      <div className="agent-list">
                        {agents.map(a => (
                          <div key={a.id} className={`agent-item ${activeAgentId === a.id ? 'agent-active' : ''}`}
                            onClick={() => setActiveAgentId(a.id)}
                            style={{ cursor: 'pointer', ...(activeAgentId === a.id ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px var(--accent)' } : {}) }}>
                            <div className="agent-info">
                              <div className="agent-name">{a.name} {a.default && <span className="agent-default">Default</span>}</div>
                              <div className="agent-desc">{a.description}</div>
                              <div className="agent-model">{a.model || 'Default model'}</div>
                              {a.skills?.length > 0 && (
                                <div className="agent-skills">
                                  <span>Skills: </span>
                                  {a.skills.map((s: string) => <span key={s} className="agent-skill-tag">{s}</span>)}
                                </div>
                              )}
                            </div>
                            <div className="agent-actions">
                              <button className="agent-btn agent-btn-skills" title="Assign Skills" onClick={() => { pushDrawer('agent-skills', a); }}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                              </button>
                              <button className="agent-btn agent-btn-edit" title="Edit" onClick={() => { setEditingAgent(a); pushDrawer('agent-form'); setShowAgentModal(true); }}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                              </button>
                              <button className="agent-btn agent-btn-del" title="Delete" onClick={() => deleteAgent(a.id)}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Skills */}
                  {activeSetting === 'skills' && (
                    <div className="settings" style={{ padding: 0, maxWidth: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>Skills</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn-primary" style={{ padding: '7px 16px', fontSize: 13 }}
                            onClick={() => { setEditingSkill(null); pushDrawer('skill-form'); setShowSkillModal(true); }}>+ New</button>
                          <button className="btn-cancel" style={{ padding: '7px 16px', fontSize: 13 }}
                            onClick={() => { pushDrawer('marketplace'); loadPopularMarketplace(); }}>Marketplace</button>
                        </div>
                      </div>
                      <div className="skill-list">
                        {localSkills.map(s => (
                          <div key={s.id} className="skill-item">
                            <div className="skill-info">
                              <div className="skill-name">{s.name} <span className="skill-type">{s.type || 'custom'}</span></div>
                              <div className="skill-desc">{s.description}</div>
                              {s.trigger && <div className="skill-trigger">Trigger: {s.trigger}</div>}
                            </div>
                            <button className="skill-del" title="Delete" onClick={() => deleteSkill(s.id)}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="skill-hint">
                        Skills are stored in <code>~/.appclaw/skills/</code> as <code>SKILL.md</code> files. Browse the <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => { pushDrawer('marketplace'); searchMarketplace(''); }}>Marketplace</span> to discover more.
                      </div>
                    </div>
                  )}

                  {/* Updates */}
                  {activeSetting === 'updates' && (
                    <div className="settings" style={{ padding: 0, maxWidth: '100%' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Updates</div>
                      <div className="update-section">
                        <span className="update-info">Current version: v0.4.2</span>
                        <button className="btn-primary" style={{ padding: '7px 18px', fontSize: 13 }}
                          onClick={async () => {
                            setUpdateState({ status: 'idle' });
                            const r = await window.api.updater.check().catch(() => ({ available: false, error: 'Check failed' }));
                            if (r.available) setUpdateState({ status: 'available', version: r.version });
                            else if (r.error) setUpdateState({ status: 'error' });
                            else setUpdateState({ status: 'up-to-date' });
                          }}>
                          Check for Updates
                        </button>
                      </div>
                    </div>
                  )}

                  {/* About */}
                  {activeSetting === 'about' && (
                    <div className="settings" style={{ padding: 0, maxWidth: '100%' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>About</div>
                      <div className="about-text">
                        <p><strong>AppClaw</strong> v0.4.2</p>
                        <p style={{ marginTop: 8 }}>A desktop AI agent with autonomous capabilities.</p>
                        <p style={{ marginTop: 8, color: 'var(--text-muted)' }}>Built with Electron + React + TypeScript.</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* ===== Settings Drawer Level 3: Detail Panel ===== */}
                {drawerLevel >= 3 && (
                  <div style={{
                    flex: 1, overflow: 'auto', padding: '24px 28px',
                    background: 'var(--bg-primary)', minWidth: 0
                  }}>
                    {/* Back button */}
                    <button onClick={popDrawer} style={{
                      display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)',
                      fontSize: 13, marginBottom: 20, padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                      transition: 'all var(--transition-fast)'
                    }}
                      onMouseEnter={e => (e.target as HTMLElement).style.color = 'var(--text-primary)'}
                      onMouseLeave={e => (e.target as HTMLElement).style.color = 'var(--text-muted)'}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                      Back
                    </button>

                    {/* Agent Skill Assignment */}
                    {activeSetting === 'agent-skills' && drawerStack.find(d => d.setting === 'agent-skills')?.data && (
                      <AgentSkillAssign
                        agent={drawerStack.find(d => d.setting === 'agent-skills')?.data}
                        localSkills={localSkills}
                        skillSearchQuery={skillSearchQuery}
                        setSkillSearchQuery={setSkillSearchQuery}
                        onToggleSkill={toggleSkillForAgent}
                      />
                    )}

                    {/* Marketplace */}
                    {activeSetting === 'marketplace' && (
                      <MarketplaceView
                        marketplaceSkills={marketplaceSkills}
                        marketplaceLoading={marketplaceLoading}
                        marketplaceQuery={marketplaceQuery}
                        onSearch={searchMarketplace}
                        onInstall={installMarketplaceSkill}
                        installedSkillIds={installedSkillIds}
                        installedSkillNames={installedSkillNames}
                      />
                    )}

                    {/* Agent/Edit modal in-drawer */}
                    {showAgentModal && (
                      <AgentForm
                        editingAgent={editingAgent}
                        llmConfig={llmConfig}
                        onSave={saveAgent}
                        onCancel={() => { setShowAgentModal(false); setEditingAgent(null); }}
                      />
                    )}

                    {/* Skill/Create modal in-drawer */}
                    {showSkillModal && (
                      <SkillForm
                        editingSkill={editingSkill}
                        onSave={saveSkill}
                        onCancel={() => { setShowSkillModal(false); setEditingSkill(null); }}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : view === 'welcome' ? (
            /* Welcome Screen */
            <div className="welcome">
              <div className="welcome-icon">
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                  <path d="M32 4L6 18v28l26 14 26-14V18L32 4z" fill="url(#wg)" stroke="#6c8cff" strokeWidth="2" opacity="0.3"/>
                  <path d="M32 32L18 24v16l14 8 14-8V24L32 32z" fill="#6c8cff" opacity="0.6"/>
                  <defs><linearGradient id="wg" x1="6" y1="4" x2="58" y2="60"><stop stopColor="#6c8cff"/><stop offset="1" stopColor="#a78bfa"/></linearGradient></defs>
                </svg>
              </div>
              <h2>Welcome to AppClaw</h2>
              <p>Your desktop AI agent. Start a conversation or configure agents.</p>
              <div className="chips">
                <button className="chip" onClick={createSession}>Start a new chat</button>
                <button className="chip" onClick={() => { setShowSettings(true); navigateSetting('agents'); }}>Configure agents</button>
                <button className="chip" onClick={() => { setShowSettings(true); navigateSetting('llm'); }}>Set up LLM</button>
              </div>
            </div>
          ) : (
            /* Chat View */
            <>
              <div className="chat-top">
                <div className="chat-top-title">{sessions.find(s => s.id === activeSessionId)?.title || 'Chat'}</div>
                <div className="chat-top-right">
                  <div className="agent-selector">
                    <select value={activeAgentId} onChange={e => setActiveAgentId(e.target.value)}>
                      <option value="default">Default Agent</option>
                      {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                  <div className={`status-dot ${isListening ? 'on' : ''}`}>
                    <span className="dot" />
                    {isListening ? 'Active' : 'Idle'}
                  </div>
                </div>
              </div>
              <div className="messages" ref={messagesRef}>
                {messages.map(m => (
                  <div key={m.id} className={`msg msg-${m.role === 'user' ? 'user' : 'assistant'}`}>
                    <div className={`msg-avatar msg-avatar-${m.role === 'user' ? 'user' : 'assistant'}`}>
                      {m.role === 'user' ? 'U' : 'AI'}
                    </div>
                    <div className="msg-body">
                      <div className={`msg-bubble ${m.role === 'assistant' && m.content === '' && isLoading ? 'typing' : ''}`}>
                        {m.content}
                      </div>
                    </div>
                  </div>
                ))}
                {isLoading && messages.length > 0 && messages[messages.length - 1].role === 'user' && !messages.some(m => m.id.endsWith('.loading')) && (
                  <div className="msg msg-assistant">
                    <div className="msg-avatar msg-avatar-assistant">AI</div>
                    <div className="msg-body">
                      <div className="msg-bubble typing">Thinking</div>
                    </div>
                  </div>
                )}
              </div>
              <div className="input-area">
                <div className="input-box">
                  <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                    placeholder="Type a message..." rows={1} disabled={isLoading}
                    onInput={e => { const el = e.target as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; }} />
                  <button className="send-btn" onClick={sendMessage} disabled={!input.trim() || isLoading}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tool Confirm Overlay */}
      {confirmReq && (
        <div className="modal-overlay" onClick={() => setConfirmReq(null)}>
          <div className="confirm-card" onClick={e => e.stopPropagation()}>
            <div className="confirm-title">Tool Confirmation Required</div>
            <div className="confirm-body">
              <strong>{confirmReq.tool}</strong> wants to execute:<br />
              <code style={{ fontSize: 12, wordBreak: 'break-word' }}>{JSON.stringify(confirmReq.args, null, 2)}</code>
              {confirmReq.reason && <p style={{ marginTop: 8, opacity: 0.7 }}>Reason: {confirmReq.reason}</p>}
            </div>
            <div className="confirm-btns">
              <button className="btn-allow" onClick={() => { window.api.tools.respondConfirm(confirmReq.messageId, true); setConfirmReq(null); }}>Allow</button>
              <button className="btn-deny" onClick={() => { window.api.tools.respondConfirm(confirmReq.messageId, false); setConfirmReq(null); }}>Deny</button>
            </div>
          </div>
        </div>
      )}

      {/* Error Toast */}
      {error && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, padding: '12px 20px',
          background: 'var(--red-dim)', border: '1px solid var(--red)',
          borderRadius: 'var(--radius)', color: 'var(--red)', fontSize: 13, zIndex: 2000,
          animation: 'slideDown 0.3s ease', cursor: 'pointer'
        }} onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  );
}

// ===== Sub-components =====

function AgentSkillAssign({ agent, localSkills, skillSearchQuery, setSkillSearchQuery, onToggleSkill }: {
  agent: any; localSkills: SkillInfo[]; skillSearchQuery: string;
  setSkillSearchQuery: (q: string) => void; onToggleSkill: (agentId: string, skillId: string) => void;
}) {
  const filtered = localSkills.filter(s => !skillSearchQuery || s.name.toLowerCase().includes(skillSearchQuery.toLowerCase()) || s.description?.toLowerCase().includes(skillSearchQuery.toLowerCase()));
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Assign Skills</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
        Select skills for <strong style={{ color: 'var(--text-primary)' }}>{agent?.name}</strong>
      </div>
      {/* Search */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '8px 14px',
        transition: 'all var(--transition)'
      }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
        <input value={skillSearchQuery} onChange={e => setSkillSearchQuery(e.target.value)}
          placeholder="Search skills..." style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 13 }} />
        {skillSearchQuery && (
          <button onClick={() => setSkillSearchQuery('')} style={{ color: 'var(--text-muted)', padding: 2 }}>✕</button>
        )}
      </div>
      <div className="skill-assign-list">
        {filtered.length === 0 && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32, fontSize: 13 }}>No skills match your search</div>}
        {filtered.map(s => {
          const assigned = agent?.skills?.includes?.(s.id);
          return (
            <div key={s.id} className={`skill-assign-item ${assigned ? 'assigned' : ''}`}>
              <div className="skill-assign-info">
                <div className="skill-assign-name">{s.name}</div>
                <div className="skill-assign-desc">{s.description}</div>
              </div>
              <button className={`skill-assign-toggle ${assigned ? 'active' : ''}`}
                onClick={() => onToggleSkill(agent.id, s.id)}>
                {assigned ? 'Assigned' : 'Assign'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MarketplaceView({ marketplaceSkills, marketplaceLoading, marketplaceQuery, onSearch, onInstall, installedSkillIds, installedSkillNames }: {
  marketplaceSkills: any[]; marketplaceLoading: boolean; marketplaceQuery: string;
  onSearch: (q: string) => void; onInstall: (skill: any) => Promise<any>;
  installedSkillIds: Set<string>; installedSkillNames: Set<string>;
}) {
  const [installing, setInstalling] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(marketplaceQuery);
  const [resultMsg, setResultMsg] = useState<{ id: string; success: boolean; msg: string } | null>(null);
  const [activeTopic, setActiveTopic] = useState<string>('all');

  const handleInstall = async (skill: any) => {
    setInstalling(skill.name);
    setResultMsg(null);
    const r = await onInstall(skill);
    setInstalling(null);
    if (r.success) {
      setResultMsg({ id: skill.name, success: true, msg: '✓ Installed successfully' });
    } else {
      setResultMsg({ id: skill.name, success: false, msg: `✗ ${r.error || 'Install failed'}` });
    }
    setTimeout(() => setResultMsg(null), 3000);
  };

  // Topic filter
  const topics = ['all', ...new Set(marketplaceSkills.filter(s => s.topic).map(s => s.topic))];
  const filtered = activeTopic === 'all' ? marketplaceSkills : marketplaceSkills.filter(s => s.topic === activeTopic);
  const hasRankings = marketplaceSkills.some(s => s.rank);

  const topicLabels: Record<string, string> = { all: 'All', design: 'Design', coding: 'Coding', data: 'Data', devops: 'DevOps', productivity: 'Productivity' };

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Skill Marketplace</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
        Browse trending skills. Search skills.sh for more.
      </div>
      {/* Search bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '8px 14px',
        transition: 'all var(--transition)'
      }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
        <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSearch(searchInput)}
          placeholder="Search marketplace..." style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 13 }} />
        <button className="btn-primary" style={{ padding: '5px 14px', fontSize: 12 }} onClick={() => onSearch(searchInput)}>Search</button>
      </div>

      {/* Topic filter chips */}
      {hasRankings && topics.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {topics.map(t => (
            <button key={t}
              style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                background: activeTopic === t ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: activeTopic === t ? '#fff' : 'var(--text-secondary)',
                border: activeTopic === t ? 'none' : '1px solid var(--border)',
                transition: 'all var(--transition-fast)', cursor: 'pointer'
              }}
              onClick={() => setActiveTopic(t)}>
              {topicLabels[t] || t}
            </button>
          ))}
        </div>
      )}

      {marketplaceLoading && (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>
          Loading trending skills...
        </div>
      )}

      {!marketplaceLoading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: 12 }}>
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <div style={{ fontSize: 14 }}>No skills found</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>Try a different search term or topic</div>
        </div>
      )}

      {!marketplaceLoading && filtered.filter(s => !s.error).map((s, i) => (
        <div key={s.name || i} style={{
          display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px',
          background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)', marginBottom: 8,
          transition: 'all var(--transition-fast)'
        }}>
          {/* Rank badge */}
          {s.rank && (
            <div style={{
              width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: s.rank <= 3 ? 'var(--accent)' : 'var(--bg-secondary)',
              color: s.rank <= 3 ? '#fff' : 'var(--text-muted)',
              fontSize: 12, fontWeight: 700, flexShrink: 0
            }}>
              {s.rank}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              {s.name}
              {s.topic && <span style={{ fontSize: 10, color: 'var(--accent)', background: 'var(--accent-glow)', padding: '1px 6px', borderRadius: 4, fontWeight: 500 }}>{topicLabels[s.topic] || s.topic}</span>}
              {s.skillDir && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600, background: 'rgba(52,199,89,0.15)', color: '#34c759' }}>DIRECT</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>{s.description}</div>
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              {s.installs && <span style={{ fontSize: 11, color: 'var(--accent)' }}>⬇ {s.installs} installs</span>}
              {s.rank && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>#{s.rank} trending</span>}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
            {(() => {
              const installed = installedSkillNames.has(s.name.toLowerCase()) || (s.skillDir && installedSkillIds.has(s.skillDir.toLowerCase()));
              if (installed) return <span style={{ fontSize: 11, color: '#34c759', fontWeight: 600, padding: '5px 14px' }}>✓ Installed</span>;
              return <>
                <button className="btn-primary" style={{ padding: '5px 14px', fontSize: 12 }}
                  onClick={() => handleInstall(s)}
                  disabled={installing === s.name}>
                  {installing === s.name ? 'Installing...' : (s.skillDir ? 'Install' : 'Try Install')}
                </button>
                {resultMsg?.id === s.name && (
                  <span style={{ fontSize: 11, color: resultMsg.success ? 'var(--green)' : 'var(--red)' }}>
                    {resultMsg.msg}
                  </span>
                )}
              </>;
            })()}
          </div>
        </div>
      ))}
      {!marketplaceLoading && marketplaceSkills.filter(s => s.error).length > 0 && (
        <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
          Could not fetch marketplace. Showing curated trending list instead.
        </div>
      )}
    </div>
  );
}

function AgentForm({ editingAgent, llmConfig, onSave, onCancel }: {
  editingAgent: any; llmConfig: LLMConfig; onSave: (agent: any) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState(editingAgent || { name: '', description: '', model: '', systemPrompt: '', skills: [] });
  const [customModel, setCustomModel] = useState(false);
  // Derived model options from LLM config
  const modelOptions = llmConfig.model ? [llmConfig.model, 'gpt-4o', 'gpt-4o-mini', 'gpt-4', 'gpt-3.5-turbo', 'claude-3-5-sonnet', 'claude-3-opus', 'custom'] : ['gpt-4o', 'gpt-4o-mini', 'gpt-4', 'gpt-3.5-turbo', 'claude-3-5-sonnet', 'claude-3-opus', 'custom'];
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>{editingAgent ? 'Edit Agent' : 'New Agent'}</div>
      <div className="field">
        <label>Name</label>
        <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Agent name" />
      </div>
      <div className="field">
        <label>Description</label>
        <textarea rows={2} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What this agent does" />
      </div>
      <div className="field">
        <label>Model</label>
        {customModel ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={form.model} onChange={e => setForm(p => ({ ...p, model: e.target.value }))} placeholder="Enter model name..." style={{ flex: 1 }} />
            <button className="btn-cancel" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => { setCustomModel(false); setForm(p => ({ ...p, model: '' })); }}>预设</button>
          </div>
        ) : (
          <select value={form.model} onChange={e => {
            if (e.target.value === 'custom') { setCustomModel(true); setForm(p => ({ ...p, model: '' })); }
            else setForm(p => ({ ...p, model: e.target.value }));
          }}>
            <option value="">Default model</option>
            {modelOptions.filter(m => m !== 'custom').map(m => <option key={m} value={m}>{m}{m === llmConfig.model ? ' (LLM configured)' : ''}</option>)}
            <option value="custom">Other (type custom)...</option>
          </select>
        )}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>LLM config model: <code>{llmConfig.model || '(not set)'}</code></div>
      </div>
      <div className="field">
        <label>System Prompt</label>
        <textarea rows={4} value={form.systemPrompt} onChange={e => setForm(p => ({ ...p, systemPrompt: e.target.value }))} placeholder="Instructions for the agent..." />
      </div>
      <div className="btn-row">
        <button className="btn-primary" onClick={() => onSave(form)}>Save</button>
        <button className="btn-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function SkillForm({ editingSkill, onSave, onCancel }: {
  editingSkill: any; onSave: (skill: any) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState(editingSkill || { name: '', description: '', id: '', trigger: '', systemPrompt: '' });
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>{editingSkill ? 'Edit Skill' : 'New Skill'}</div>
      <div className="field">
        <label>ID</label>
        <input value={form.id} onChange={e => setForm(p => ({ ...p, id: e.target.value }))} placeholder="my-skill" disabled={!!editingSkill} />
      </div>
      <div className="field">
        <label>Name</label>
        <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="My Skill" />
      </div>
      <div className="field">
        <label>Description</label>
        <textarea rows={2} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What this skill does" />
      </div>
      <div className="field">
        <label>Trigger / Keyword</label>
        <input value={form.trigger} onChange={e => setForm(p => ({ ...p, trigger: e.target.value }))} placeholder="e.g. translate, summarize" />
      </div>
      <div className="field">
        <label>System Prompt</label>
        <textarea rows={6} value={form.systemPrompt} onChange={e => setForm(p => ({ ...p, systemPrompt: e.target.value }))} placeholder="Skill instructions..." />
      </div>
      <div className="btn-row">
        <button className="btn-primary" onClick={() => onSave(form)}>Save</button>
        <button className="btn-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default App;