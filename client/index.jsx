import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { styles } from './styles.js';
import { AccountTransfer } from './transfer.jsx';
import { installNativeNotifications } from './notifications.js';
import { DiscoveryPanel, ForecastPanel, NotificationSettings, UpdatePanel, SchedulerControls } from './operations.jsx';

export const name = 'credit-hub-client';
export const inject = ['slots', 'layout', 'connection'];
const PANEL = 'credit-hub';
const tabs = [['accounts', '账户'], ['routes', '模型路由'], ['tasks', '签到任务'], ['usage', '用量记录'], ['relay', '接力策略'], ['settings', '设置']];

/** Connection owns browser/desktop authentication, IPC and error envelopes. */
export function createCreditHubApi(ctx) {
  const call = async (method, payload, signal) => {
    const result = await ctx.connection.rpc.call('/api', `creditHub/${method}`, { args: payload }, signal);
    if (result?.ok !== true) throw new Error(result?.error?.message || '积分中枢连接中断，请刷新后重试。');
    return result.value;
  };
  return {
    taskState: new Map(),
    snapshot: signal => call('snapshot', {}, signal),
    request: async (input, signal) => {
      const result = await call('request', { input }, signal);
      if (result?.status >= 400) throw new Error(result.body?.error?.message || result.body?.error || result.body?.message || `操作返回 HTTP ${result.status}`);
      return result;
    },
  };
}

const array = value => Array.isArray(value) ? value : [];
const text = (value, fallback = '—') => value === undefined || value === null || value === '' ? fallback : String(value);
const quantity = value => typeof value === 'number' ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value) : text(value);
const timestamp = value => {
  if (!value) return '尚无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text(value) : date.toLocaleString('zh-CN', { hour12: false });
};
function Icon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M3.5 9h17M8 13h3M8 16h6M16.5 13h.01"/></svg>;
}
function Button({ primary, children, ...props }) { return <button type="button" className={`credit-hub__button${primary ? ' credit-hub__button--primary' : ''}`} {...props}>{children}</button>; }
function Badge({ active, children, pending }) { return <span className={`credit-hub__badge${active ? ' credit-hub__badge--enabled' : pending ? ' credit-hub__badge--pending' : ''}`}>{children}</span>; }
function Empty({ title, children }) { return <div className="credit-hub__empty"><strong>{title}</strong>{children}</div>; }
function Table({ columns, children, empty, count }) { return count ? <div className="credit-hub__table-wrap"><table><thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{children}</tbody></table></div> : <Empty title={empty || '暂无记录'}>刷新本地快照以查看最新状态。</Empty>; }
function Check({ checked, onChange, children, disabled, ariaLabel }) { return <label className="credit-hub__check"><input type="checkbox" aria-label={ariaLabel} checked={!!checked} onChange={onChange} disabled={disabled}/>{children}</label>; }
export function accountConnectionLabel(account) {
  return account.setupRequired || account.connectionState === 'setup_required' ? '待独立配置' : account.connectionState === 'snapshot_required' ? '待凭据快照' : '未核验';
}

export function Accounts({ snapshot, busy, perform }) {
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState('all');
  const [capture, setCapture] = useState(false);
  const [captureLabel, setCaptureLabel] = useState('');
  const [transfer, setTransfer] = useState('');
  const [removal, setRemoval] = useState(null);
  const accounts = array(snapshot.accounts);
  const platforms = [...new Set(accounts.map(account => account.platform))];
  const visible = accounts.filter(account => (platform === 'all' || account.platform === platform) && `${account.label} ${account.platform}`.toLowerCase().includes(query.toLowerCase()));
  const update = (account, values) => perform('保存账户设置', { method: 'POST', path: '/hub/accounts', body: { accountId: account.id, ...values } });
  return <>
    <div className="credit-hub__toolbar"><input className="credit-hub__search" aria-label="搜索账户" placeholder="搜索账户名称或平台" value={query} onChange={event => setQuery(event.target.value)}/><select aria-label="按平台筛选" value={platform} onChange={event => setPlatform(event.target.value)}><option value="all">全部平台</option>{platforms.map(item => <option key={item} value={item}>{item}</option>)}</select><Button onClick={() => setCapture(value => !value)} disabled={busy}>添加当前 WorkBuddy 账户</Button><Button disabled={busy} onClick={() => perform('刷新上游余额', { method: 'GET', path: '/admin/balances?refresh=1' })}>手动刷新余额</Button><Button disabled={busy} onClick={() => setTransfer(transfer === 'import' ? '' : 'import')}>导入账号</Button><Button disabled={busy} onClick={() => setTransfer(transfer === 'export' ? '' : 'export')}>导出账号</Button></div>
    {transfer && <AccountTransfer key={transfer} mode={transfer} accounts={accounts} busy={busy} perform={perform} onClose={() => setTransfer('')}/>}
    {capture && <form className="credit-hub__inline-form" onSubmit={event => { event.preventDefault(); perform('添加当前 WorkBuddy 账户', { method: 'POST', path: '/admin/workbuddy/capture', body: { ...(captureLabel.trim() ? { label: captureLabel.trim() } : {}) } }).then(ok => { if (ok) setCapture(false); }); }}><input aria-label="新账户备注" placeholder="账户备注（可选）" value={captureLabel} onChange={event => setCaptureLabel(event.target.value)}/><button className="credit-hub__button credit-hub__button--primary" disabled={busy} type="submit">读取当前客户端并添加</button><Button onClick={() => setCapture(false)}>取消</Button></form>}
    <details className="credit-hub__operation-details"><summary>后装 Agent 自动发现与接入</summary><DiscoveryPanel snapshot={snapshot} busy={busy} perform={perform}/></details>
    <p className="credit-hub__muted">“模型调用”只控制积分调用资格；停用模型调用后，自动签到与任务仍由独立排程控制。余额仅在点击刷新时请求上游。</p>
    {removal && <div role="alert" className="credit-hub__notice"><strong>删除账号：{removal.label || removal.platform}</strong><p>删除该账号、模型引用及独占的插件凭据快照，并阻止自动发现重新导入同一身份。原客户端与无凭据历史记录保留。</p><div className="credit-hub__toolbar"><Button disabled={busy} onClick={() => perform('删除账号', {method:'POST',path:'/hub/accounts/remove',body:{accountId:removal.id,confirm:true}}).then(ok=>{if(ok)setRemoval(null);})}>确认删除，不保留登录凭据</Button><Button disabled={busy} onClick={()=>setRemoval(null)}>取消</Button></div></div>}
    <Table columns={['账户', '平台', '模型调用', '账户状态', '凭据方式 / 核验', '操作']} count={visible.length} empty={accounts.length ? '没有匹配的账户' : '还没有账户'}>{visible.map((account, index) => <tr key={account.id || index}><td><span className="credit-hub__cell-main">{account.label || `账户${index + 1}`}</span></td><td>{text(account.platform)}</td><td><Check ariaLabel={`${account.label || `账户${index + 1}`} · 模型调用`} checked={account.inferenceEnabled !== false} disabled={busy} onChange={event => update(account, { inferenceEnabled: event.target.checked })}>{account.inferenceEnabled !== false ? '参与调用' : '已停用'}</Check></td><td><Check ariaLabel={`${account.label || `账户${index + 1}`} · 账户状态`} checked={account.enabled !== false} disabled={busy} onChange={event => update(account, { enabled: event.target.checked })}>{account.enabled !== false ? '启用' : '停用'}</Check></td><td><span className="credit-hub__cell-detail">{({ file: '独立文件快照', desktop: '客户端快照', 'api-key': 'API Key' })[account.credentialMode] || text(account.credentialMode, '本地凭据')}</span><Badge pending={account.connectionState !== 'not_checked'}>{accountConnectionLabel(account)}</Badge></td><td><Button disabled={busy} aria-label={`删除 ${account.label || account.platform} 账号`} onClick={()=>setRemoval(account)}>删除账号</Button></td></tr>)}</Table>
  </>;
}

function Routes({ snapshot, busy, perform }) {
  const [query, setQuery] = useState('');
  const routes = array(snapshot.routes).filter(route => `${route.name} ${array(route.targets).map(target => target.model).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <div className="credit-hub__toolbar"><input className="credit-hub__search" aria-label="搜索模型路由" placeholder="搜索路由或模型" value={query} onChange={event => setQuery(event.target.value)}/><Button disabled={busy} onClick={() => perform('更新上游模型目录', { method: 'GET', path: '/admin/model-directory?refresh=1' })}>手动更新模型目录</Button><Button disabled={busy} onClick={() => perform('启动已导入模型体检', { method: 'POST', path: '/admin/model-tests', body: { scope: 'imported' } })}>体检已导入模型</Button></div>
    <p className="credit-hub__muted">路由以 <strong>credit-hub</strong> 提供方接入 DSH 模型选择器。更新目录与体检会请求上游；启停路由只修改独立配置。</p>
    <Table columns={['模型路由', '候选模型', '目标数', '状态']} count={routes.length} empty="还没有模型路由">{routes.map((route, index) => <tr key={route.id || index}><td><span className="credit-hub__cell-main">{route.name || route.id}</span></td><td><span className="credit-hub__cell-detail">{array(route.targets).slice(0, 4).map(target => target.model || target.modelId || '已配置模型').join(' / ') || '尚未配置目标'}{route.targetCount > 4 ? ' …' : ''}</span></td><td>{quantity(route.targetCount ?? array(route.targets).length)}</td><td><Check ariaLabel={`${route.name || route.id} · 路由启用`} checked={route.enabled !== false} disabled={busy} onChange={event => perform('保存路由状态', { method: 'POST', path: '/hub/routes', body: { routeId: route.id, enabled: event.target.checked } })}>{route.enabled !== false ? '已启用' : '已停用'}</Check></td></tr>)}</Table>
  </>;
}

const jobState = value => ({ pending: '等待执行', queued: '等待执行', running: '执行中', cancelling: '正在取消', cancelled: '已取消', timed_out: '本轮已超时', completed: '已完成', succeeded: '已完成', failed: '执行失败', accepted: '已受理' })[value] || text(value, '已受理');
const phaseName = phase => ({ queued: '排队', init: '初始化', query: '查询任务', accept: '接受任务', execution: '执行任务', progress_poll: '等待官方进度', claim: '领取奖励', finished: '本轮结束', cancelling: '等待取消确认' })[phase] || text(phase);
const taskState = task => task.claimed ? '官方已结算' : task.claimable ? '官方确认可领取' : task.lastReceipt?.status === 'task_accounting_pending' ? '等待官方入账' : task.locked ? '前置条件未完成' : task.accepted ? '已接受，尚未结算' : '尚未接受';
/** A response belongs to one account-selection generation, including A → B → A. */
export function createAccountResponseGuard(initialAccount) {
  let account = initialAccount, generation = 0, active = true;
  return {
    select(next) { if (next !== account || !active) generation++; account = next; active = true; },
    capture() { const version = generation, selected = account; return () => active && version === generation && selected === account; },
    dispose() { active = false; generation++; },
  };
}
function Job({ value, accountLabel, onRefresh, onCancel, busy }) {
  if (!value) return null;
  const state = value.status || value.state || 'accepted';
  const processed = value.progress?.processed ?? value.progress?.completed ?? value.completedCount ?? value.processed;
  const total = value.progress?.total ?? value.totalCount ?? value.total;
  const terminal = ['completed', 'succeeded', 'failed', 'cancelled', 'timed_out'].includes(state);
  const elapsed = Math.max(0, Math.floor((value.progress?.elapsedMs || 0) / 1000));
  const tasks = array(value.result?.tasks || value.snapshot?.tasks);
  return <><div className="credit-hub__notice"><div className="credit-hub__toolbar"><strong>{accountLabel || '账户任务'}</strong><Badge active={state === 'completed' || state === 'succeeded'} pending={!terminal}>{jobState(state)}</Badge><Button disabled={busy} onClick={onRefresh}>刷新任务进度</Button>{!terminal && <Button disabled={busy} onClick={onCancel}>取消任务</Button>}</div><dl className="credit-hub__kv"><dt>当前阶段</dt><dd>{value.progress?.phase ? phaseName(value.progress.phase) : text(value.stage || value.progress?.stage || value.message, terminal ? '任务已结束' : '等待任务状态更新')}</dd><dt>处理进度</dt><dd>{processed === undefined ? '尚未返回计数' : `${quantity(processed)} / ${quantity(total)}`}</dd><dt>已经耗时</dt><dd>{Math.floor(elapsed / 60)} 分 {elapsed % 60} 秒</dd><dt>开始时间</dt><dd>{timestamp(value.startedAt || value.createdAt)}</dd><dt>最近更新</dt><dd>{timestamp(value.updatedAt || value.finishedAt || value.completedAt)}</dd></dl>{typeof total === 'number' && total > 0 && typeof processed === 'number' && <div className="credit-hub__progress" role="progressbar" aria-label="任务处理进度" aria-valuenow={processed} aria-valuemin={0} aria-valuemax={total}><span style={{ width: `${Math.min(100, Math.max(0, processed / total * 100))}%` }}/></div>}<p className="credit-hub__muted">“已完成”表示本轮动作结束，积分结算单独列在下表。取消后，已提交动作继续保留待确认。</p></div>{tasks.length > 0 && <Table columns={['任务', '官方进度', '奖励', '结算状态']} count={tasks.length}>{tasks.map((task, index) => <tr key={task.taskCode || index}><td>{task.title || task.name || '任务'}</td><td>{quantity(task.current ?? task.progress)} / {quantity(task.target)}</td><td>{text(task.reward)}</td><td><Badge active={task.claimed} pending={!task.claimed}>{taskState(task)}</Badge></td></tr>)}</Table>}</>;
}
function Tasks({ snapshot, busy, perform, api }) {
  const accounts = array(snapshot.accounts);
  const workbuddy = accounts.filter(account => String(account.platform).toLowerCase().includes('workbuddy'));
  const [accountId, setAccountId] = useState('');
  const [job, setJob] = useState(null);
  const [jobId, setJobId] = useState('');
  const [jobError, setJobError] = useState('');
  const selected = workbuddy.find(account => account.id === accountId) || workbuddy[0];
  const accountGuard = useRef(null);
  if (!accountGuard.current) accountGuard.current = createAccountResponseGuard(selected?.id);
  accountGuard.current.select(selected?.id);
  const jobIdRef = useRef(jobId);
  jobIdRef.current = jobId;
  useEffect(() => {
    const id = selected?.id;
    accountGuard.current.select(id);
    const isCurrent = accountGuard.current.capture();
    const controller = new AbortController();
    const cached = id ? api.taskState?.get(id) : null;
    setJob(cached?.job || null); setJobId(cached?.jobId || ''); setJobError('');
    if (id) api.request({ method: 'GET', path: `/admin/workbuddy/task-jobs?accountId=${encodeURIComponent(id)}` }, controller.signal).then(response => {
      if (!isCurrent()) return;
      const running = response.body?.job;
      if (running?.jobId) { setJob(running); setJobId(running.jobId); }
    }, failure => { if (isCurrent() && !controller.signal.aborted) setJobError(failure.message); });
    return () => { controller.abort(); accountGuard.current.dispose(); };
  }, [api, selected?.id]);
  useEffect(() => {
    if (jobId && job?.accountId) api.taskState?.set(job.accountId, { job, jobId });
  }, [api, job, jobId]);
  const refreshJob = useCallback(async () => {
    if (!jobId) return;
    const isCurrent = accountGuard.current.capture();
    const requestedJob = jobId;
    try { const result = await api.request({ method: 'GET', path: `/admin/workbuddy/task-jobs/${encodeURIComponent(requestedJob)}` }); if (!isCurrent() || jobIdRef.current !== requestedJob) return; setJob(result.body?.job || result.body); setJobError(''); } catch (error) { if (isCurrent() && jobIdRef.current === requestedJob) setJobError(error.message); }
  }, [api, jobId]);
  useEffect(() => {
    const state = job?.status || job?.state;
    if (!jobId || ['completed', 'succeeded', 'failed', 'cancelled', 'timed_out'].includes(state)) return;
    const timer = setInterval(refreshJob, 3000);
    return () => clearInterval(timer);
  }, [refreshJob, jobId, job?.status, job?.state]);
  const action = async kind => {
    const isCurrent = accountGuard.current.capture();
    const origin = selected;
    const ok = await perform(`${origin?.label || 'WorkBuddy'} · ${kind === 'query' ? '查询任务' : kind === 'run' ? '执行任务' : '领取任务'}`, { method: 'POST', path: '/admin/workbuddy/task-jobs', body: { ...(origin ? { accountId: origin.id } : {}), action: kind } }, response => {
      if (!isCurrent()) return;
      const body = response.body;
      const next = body?.job || body;
      const id = body?.jobId || next?.id || next?.jobId;
      if (id) { setJobId(id); setJob(next); }
    });
    return ok;
  };
  const cancel = () => {
    const isCurrent = accountGuard.current.capture();
    const requestedJob = jobId;
    return perform(`${selected?.label || 'WorkBuddy'} · 取消任务`, { method: 'POST', path: `/admin/workbuddy/task-jobs/${encodeURIComponent(requestedJob)}/cancel`, body: {} }, response => {
      if (isCurrent() && jobIdRef.current === requestedJob) setJob(response.body?.job || response.body);
    });
  };
  return <>
    <div className="credit-hub__notice"><strong>自动排程{snapshot.schedulerRunning || snapshot.schedule?.settings?.enabled ? '已启用' : '未启用'}</strong><p className="credit-hub__muted">本次预览默认关闭自动签到和任务。进入此页面只读取缓存；下方按钮分别发起明确的上游操作。</p></div>
    <SchedulerControls snapshot={snapshot} busy={busy} perform={perform}/>
    <h2>签到</h2><p className="credit-hub__muted">手动签到使用已导入账户；模型调用停用状态不影响签到资格。</p><div className="credit-hub__toolbar"><Button primary disabled={busy || !accounts.length} onClick={() => perform('执行全部账户签到', { method: 'POST', path: '/admin/claim', body: {} })}>全部账户签到</Button></div>
    <h2>WorkBuddy 任务</h2><div className="credit-hub__toolbar"><select aria-label="选择 WorkBuddy 账户" value={selected?.id || ''} disabled={!workbuddy.length} onChange={event => setAccountId(event.target.value)}>{workbuddy.length ? workbuddy.map(account => <option key={account.id} value={account.id}>{account.label}</option>) : <option value="">尚无 WorkBuddy 账户</option>}</select><Button disabled={busy || !selected} onClick={() => action('query')}>查询任务</Button><Button primary disabled={busy || !selected} onClick={() => action('run')}>执行任务</Button><Button disabled={busy || !selected} onClick={() => action('claim')}>领取已完成任务</Button></div>
    {jobError && <div role="alert" className="credit-hub__notice credit-hub__notice--error">{jobError}</div>}
    <Job value={job} accountLabel={selected?.label} onRefresh={refreshJob} busy={busy} onCancel={cancel}/>
    <h2>最近签到记录</h2><RecordTable records={array(snapshot.records).filter(record => /claim|checkin|签到/i.test(`${record.type} ${record.action} ${record.kind} ${record.task}`)).slice(0, 20)} empty="尚无签到记录"/>
  </>;
}

function RecordTable({ records, empty }) {
  return <Table columns={['时间', '操作', '平台 / 模型', '结果']} count={records.length} empty={empty}>{records.map((record, index) => <tr key={index}><td>{timestamp(record.at || record.time || record.timestamp || record.startedAt || record.createdAt)}</td><td>{text(record.action || record.task || record.type || record.kind, '请求')}</td><td><span className="credit-hub__cell-main">{text(record.model || record.platform || record.routeName)}</span></td><td>{text(record.status || record.outcome || record.result?.status, record.ok === true ? '成功' : record.ok === false ? '失败' : '已记录')}</td></tr>)}</Table>;
}
function Usage({ snapshot, busy, perform }) {
  const [range, setRange] = useState('24h');
  const [activity, setActivity] = useState(null);
  const records = activity ? array(activity.records || activity.events || activity.items || activity) : array(snapshot.usage?.records);
  const usage = activity?.usage || activity?.kpis || snapshot.usage || {};
  const known = records.map(record => Number.isFinite(record.totalTokens) ? record.totalTokens : Number.isFinite(record.inputTokens) && Number.isFinite(record.outputTokens) ? record.inputTokens + record.outputTokens : null).filter(Number.isFinite);
  const knownTokens = usage.knownTokens ?? (known.length ? known.reduce((sum, value) => sum + value, 0) : undefined);
  return <><ForecastPanel snapshot={snapshot} busy={busy} perform={perform}/><div className="credit-hub__toolbar"><select aria-label="记录时间范围" value={range} onChange={event => setRange(event.target.value)}><option value="24h">最近 24 小时</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option><option value="all">全部记录</option></select><Button disabled={busy} onClick={() => perform('读取本地请求记录', { method: 'GET', path: `/hub/activity?range=${range}` }, response => setActivity(response.body))}>读取记录</Button></div><div className="credit-hub__summary"><span>已返回 tokens <strong>{quantity(knownTokens)}</strong></span><span>估算输入 tokens <strong>{quantity(usage.estimatedInputTokens)}</strong></span><span>请求数 <strong>{quantity(usage.requests ?? usage.requestCount ?? usage.total ?? records.length)}</strong></span></div><RecordTable records={records.slice(0, 100)} empty="尚无请求记录"/><p className="credit-hub__muted">记录来自独立本地账本，读取记录不请求上游。{activity ? '统计按所选时间范围汇总；' : 'Token 统计仅汇总当前最多 100 条记录；'}已返回 Token 与估算输入分开显示，缺少测量时显示“—”。</p></>;
}

function Relay({ snapshot, busy, perform }) {
  const relay = snapshot.relay || {};
  const settings = relay.settings || relay.config || relay;
  const [enabled, setEnabled] = useState(!!settings.enabled);
  const [reservePercent, setReservePercent] = useState(settings.reservePercent ?? '');
  const [reserveCredits, setReserveCredits] = useState(settings.reserveCredits ?? '');
  const [dirty, setDirty] = useState(false);
  const touch = setter => event => { setter(event.target.type === 'checkbox' ? event.target.checked : event.target.value); setDirty(true); };
  const save = () => {
    const body = { enabled };
    if (reservePercent !== '') body.reservePercent = Number(reservePercent);
    if (reserveCredits !== '') body.reserveCredits = Number(reserveCredits);
    perform('保存接力策略', { method: 'POST', path: '/admin/model-relay', body }).then(ok => { if (ok) setDirty(false); });
  };
  return <><p className="credit-hub__muted">接力只在独立的积分中枢账户池内选择同一模型候选。完整消息、工具与输出预算随请求保留。</p><div className="credit-hub__form"><label htmlFor="hub-relay-enabled">自动接力</label><Check checked={enabled} disabled={busy} onChange={touch(setEnabled)}>启用账户接力</Check><label htmlFor="hub-reserve-percent">保留积分比例（%）</label><input id="hub-reserve-percent" type="number" min="0" max="50" value={reservePercent} placeholder="沿用现有值" onChange={touch(setReservePercent)}/><label htmlFor="hub-reserve-credits">保留积分数量</label><input id="hub-reserve-credits" type="number" min="0" max="100000" value={reserveCredits} placeholder="沿用现有值" onChange={touch(setReserveCredits)}/><div className="credit-hub__wide"><Button primary disabled={busy || !dirty} onClick={save}>保存策略</Button></div></div><h2>运行状态</h2><dl className="credit-hub__kv"><dt>独立引擎</dt><dd><Badge active={!!snapshot.worker?.pid}>{snapshot.worker?.pid ? '运行中' : '等待连接'}</Badge></dd><dt>路由候选</dt><dd>{quantity(snapshot.counts?.routes)} 条路由</dd><dt>自动调度</dt><dd>{snapshot.schedulerRunning ? '已启用' : '已关闭'}</dd></dl></>;
}

function Settings({ snapshot, busy, perform }) {
  const current = snapshot.schedule?.settings || {};
  const [enabled, setEnabled] = useState(!!current.enabled);
  const [hour, setHour] = useState(current.hour ?? 9);
  const [minute, setMinute] = useState(current.minute ?? 0);
  const [timezone, setTimezone] = useState(current.timezone || 'Asia/Shanghai');
  const [dirty, setDirty] = useState(false);
  const change = setter => event => { setter(event.target.type === 'checkbox' ? event.target.checked : event.target.value); setDirty(true); };
  return <><h2>独立排程</h2><p className="credit-hub__muted">设置仅保存到积分中枢的新目录，不改变原 AI 网关与原 DSH 的排程。</p><div className="credit-hub__form"><label>自动签到与任务</label><Check checked={enabled} disabled={busy} onChange={change(setEnabled)}>启用每日自动排程</Check><label htmlFor="hub-timezone">时区</label><input id="hub-timezone" value={timezone} onChange={change(setTimezone)}/><label htmlFor="hub-hour">执行时刻</label><div className="credit-hub__toolbar"><input id="hub-hour" type="number" min="0" max="23" aria-label="执行小时" value={hour} onChange={change(setHour)}/><span>时</span><input type="number" min="0" max="59" aria-label="执行分钟" value={minute} onChange={change(setMinute)}/><span>分</span></div><div className="credit-hub__wide"><Button primary disabled={busy || !dirty} onClick={() => perform('保存独立排程', { method: 'POST', path: '/hub/scheduler', body: { enabled, hour: Number(hour), minute: Number(minute), timezone } }).then(ok => { if (ok) setDirty(false); })}>保存排程</Button></div></div><NotificationSettings snapshot={snapshot} busy={busy} perform={perform}/><UpdatePanel snapshot={snapshot} busy={busy} perform={perform}/><h2>版本兼容状态</h2><p className="credit-hub__muted">{snapshot.compatibility?.mode === "native-provider" ? "原生模型提供方已注册" : snapshot.compatibility?.mode === "management-only" ? "当前宿主使用管理页模式；模型服务接口未就绪" : "兼容层随宿主能力启用"}。旧版没有侧栏主面板时，从设置中的“积分中枢”进入。</p><h2>本地预览</h2><dl className="credit-hub__kv"><dt>插件</dt><dd>积分中枢 {text(snapshot.pluginVersion)}</dd><dt>独立引擎版本</dt><dd>{text(snapshot.version)}</dd><dt>模型提供方</dt><dd>credit-hub</dd><dt>运行时</dt><dd>Node {text(snapshot.worker?.nodeVersion)}</dd><dt>最新快照</dt><dd>{timestamp(snapshot.checkedAt)}</dd><dt>自动发布</dt><dd>未启用；当前仅本地预览</dd></dl></>;
}

/** Only whitelisted display fields reach the action receipt; never dump API payloads. */
function receipt(response) {
  const body = response?.body || {};
  const job = body.job || body;
  const state = job.status || job.state;
  const message = typeof body.message === 'string' ? body.message.slice(0, 250) : '';
  return { accepted: response?.status === 202, status: response?.status, state: state ? jobState(state) : null, message };
}
export function HubView({ api }) {
  const [tab, setTab] = useState('accounts');
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const alive = useRef(true);
  const tabId = useId();
  const refresh = useCallback(async () => {
    setLoading(true);
    try { const next = await api.snapshot(); if (alive.current) { setSnapshot(next); setError(''); } } catch (failure) { if (alive.current) setError(failure.message); } finally { if (alive.current) setLoading(false); }
  }, [api]);
  useEffect(() => { alive.current = true; refresh(); return () => { alive.current = false; }; }, [refresh]);
  const perform = useCallback(async (label, input, onResult) => {
    setBusy(label); setError('');
    try {
      const response = await api.request(input);
      if (!alive.current) return false;
      onResult?.(response);
      setResult({ label, ...receipt(response), at: Date.now() });
      await refresh();
      return true;
    } catch (failure) { if (alive.current) setError(`${label}：${failure.message}`); return false; } finally { if (alive.current) setBusy(''); }
  }, [api, refresh]);
  const props = { snapshot: snapshot || {}, api, busy: !!busy, perform };
  const panels = { accounts: Accounts, routes: Routes, tasks: Tasks, usage: Usage, relay: Relay, settings: Settings };
  const Panel = panels[tab];
  const changeTab = (event, index) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[next][0]);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
  };
  return <section className="credit-hub" aria-label="积分中枢"><div className="credit-hub__inner"><header className="credit-hub__header"><div><h1>积分中枢</h1><p className="credit-hub__muted">账户、模型与任务，在 DSH 内统一管理。</p></div><Button disabled={loading || !!busy} onClick={refresh}>{loading ? '读取中…' : '刷新本地快照'}</Button></header>{snapshot && <div className="credit-hub__summary"><span>账户<strong>{quantity(snapshot.counts?.accounts)}</strong></span><span>平台<strong>{quantity(snapshot.counts?.platforms)}</strong></span><span>启用路由<strong>{quantity(snapshot.counts?.enabledRoutes)} / {quantity(snapshot.counts?.routes)}</strong></span><span>独立预览 · {snapshot.schedulerRunning ? '自动排程已启用' : '自动排程关闭'}</span></div>}<div role="tablist" className="credit-hub__tabs" aria-label="积分中枢页面">{tabs.map(([key, label], index) => <button key={key} id={`${tabId}-tab-${key}`} role="tab" className="credit-hub__tab" aria-selected={tab === key} aria-controls={`${tabId}-panel`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={event => changeTab(event, index)}>{label}</button>)}</div>{error && <div className="credit-hub__notice credit-hub__notice--error" role="alert">{error} <button type="button" className="credit-hub__text-button" onClick={refresh}>重新连接</button></div>}{busy && <div role="status" aria-live="polite" className="credit-hub__notice">{busy}… 正在等待操作结果。</div>}<div id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-tab-${tab}`} aria-busy={loading && !snapshot}>{!snapshot ? <Empty title={loading ? '正在读取独立引擎快照' : '尚未连接积分中枢'}>{loading ? '首次载入只读本地账户与路由，不请求上游。' : '点击重新连接以重试。'}</Empty> : <Panel key={tab} {...props}/>}</div>{result && <aside className="credit-hub__result" aria-live="polite"><h2>最近操作</h2><p><strong>{result.label}</strong> · {result.accepted ? '已受理，等待执行结果' : result.state || '操作已返回'}</p>{result.message && <p className="credit-hub__muted">{result.message}</p>}<span className="credit-hub__muted">{timestamp(result.at)} · HTTP {result.status}</span></aside>}</div></section>;
}

export function apply(ctx) {
  const api = createCreditHubApi(ctx);
  ctx.effect(()=>installNativeNotifications({api,onOpen:()=>ctx.layout?.selectPanel?.(PANEL)}),'credit-hub: global event notifications');
  ctx.effect(() => {
    const element = document.createElement('style');
    element.dataset.creditHub = 'styles';
    element.textContent = styles;
    document.head.append(element);
    return () => element.remove();
  }, 'credit-hub: native styles');
  const render = () => <HubView api={api}/>;
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, render));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 25, label: () => '积分中枢' }, owner => <Icon size={owner?.size || 18}/>));
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: PANEL, order: 46, label: () => '积分中枢' }, render));
  ctx.effect(() => () => { if (ctx.layout?.panelInfo?.getSnapshot()?.activePanelId === PANEL) ctx.layout?.selectPanel?.(null); }, 'credit-hub: panel cleanup');
}
