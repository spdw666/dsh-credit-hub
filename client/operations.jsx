import React, { useEffect, useId, useRef, useState } from 'react';

const list = value => Array.isArray(value) ? value : [];
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const show = (value, fallback = '—') => ['string', 'number'].includes(typeof value) && value !== '' ? String(value) : fallback;
const number = value => Number.isFinite(value) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value) : '—';
const when = value => { const date = value ? new Date(value) : null; return date && Number.isFinite(+date) ? date.toLocaleString('zh-CN', { hour12: false }) : '尚无记录'; };
const operations = snapshot => object(snapshot.operations);
const settingsFor = (snapshot, key) => object(operations(snapshot).settings?.[key] || operations(snapshot)[key]?.settings);

export const notificationEvents = [
  ['checkin.failed', '签到失败'], ['credential.expiring', '凭据即将过期'],
  ['balance.low', '余额低于阈值'], ['relay.triggered', '接力触发'],
  ['request.failure_streak', '连续 3 次失败'], ['update.available', '发现新版本'],
];

/** A response may mutate local state only in the selection/edit generation it began in. */
export function createOperationGuard(initialScope = '') {
  let scope = initialScope, generation = 0, alive = true;
  return {
    select(next) { if (next !== scope || !alive) generation++; scope = next; alive = true; },
    change() { generation++; },
    capture() { const version = generation; return () => alive && version === generation; },
    dispose() { alive = false; generation++; },
  };
}
function useOperationGuard() {
  const ref = useRef(null);
  if (!ref.current) ref.current = createOperationGuard();
  useEffect(() => { ref.current.select(''); return () => ref.current.dispose(); }, []);
  return ref.current;
}
function useDraft(incoming) {
  const signature = JSON.stringify(incoming), [draft, setDraft] = useState(() => incoming), [dirty, setDirty] = useState(false);
  const guard = useOperationGuard();
  useEffect(() => { if (!dirty) setDraft(incoming); }, [signature]);
  const update = patch => { guard.change(); setDirty(true); setDraft(value => ({ ...value, ...patch })); };
  return { draft, dirty, update, guard, saved: patch => { setDirty(false); if (patch) setDraft(value => ({ ...value, ...patch })); } };
}
function Action({ primary, children, ...props }) { return <button type="button" className={`credit-hub__button${primary ? ' credit-hub__button--primary' : ''}`} {...props}>{children}</button>; }
function Check({ children, checked, disabled, onChange, label }) { return <label className="credit-hub__check"><input type="checkbox" aria-label={label} checked={!!checked} disabled={disabled} onChange={event => onChange(event.target.checked)}/>{children}</label>; }
function Rows({ columns, rows, empty, children, label }) {
  return rows.length ? <div className="credit-hub__table-wrap" role="region" aria-label={label} tabIndex={0}><table><thead><tr>{columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{children}</tbody></table></div> : <div className="credit-hub__notice"><p className="credit-hub__muted">{empty}</p></div>;
}
function Field({ label, children, id }) { return <><label htmlFor={id}>{label}</label>{children}</>; }
function Feedback({ children, error }) { return children ? <p role={error ? 'alert' : 'status'} className={`credit-hub__transfer-status${error ? ' credit-hub__notice--error' : ''}`}>{children}</p> : null; }
const post = (path, body = {}) => ({ method: 'POST', path, body });

const discoveryState = row => ({ connected: '已接入', added: '已接入', imported: '已接入', changed: '已更新接入', unchanged: '已接入，无变化', existing: '已接入', snapshot_required: '待登录态', login_required: '等待客户端登录', not_logged_in: '等待客户端登录', missing: '尚未发现', installed: '已发现，尚未接入', not_installed: '尚未安装', needs_setup: '待独立配置', unsupported: '待独立配置', error: '接入失败', failed: '接入失败', detected: '已发现', ready: '可接入' })[row.status] || show(row.status, row.installed ? '已发现' : '尚未发现');

export function DiscoveryPanel({ snapshot, busy, perform }) {
  const state = object(operations(snapshot).discovery), current = settingsFor(snapshot, 'discovery');
  const form = useDraft({ enabled: current.enabled ?? false, autoEnableRoutes: current.autoEnableRoutes ?? true, fetchModels: current.fetchModels ?? true, intervalSeconds: current.intervalSeconds ?? 60 });
  const rows = list(state.candidates), id = useId();
  const save = () => { const fresh = form.guard.capture(); return perform('保存 Agent 自动发现', post('/hub/operations', { discovery: { ...form.draft, intervalSeconds: Number(form.draft.intervalSeconds) } }), () => { if (fresh()) form.saved(); }); };
  return <section aria-label="Agent 自动发现与接入">
    <h2>后装 Agent 自动接入</h2>
    <p className="credit-hub__muted">定期检查受支持客户端。发现已登录的账号后，将凭据复制到插件独立目录并建立接入；原客户端文件保持只读。尚未登录或需要独立配置的客户端会留在下表。</p>
    <div className="credit-hub__form">
      <span>发现方式</span><Check checked={form.draft.enabled} disabled={busy} onChange={enabled => form.update({ enabled })}>启用后台自动发现</Check>
      <span>模型目录</span><Check checked={form.draft.fetchModels} disabled={busy} onChange={fetchModels => form.update({ fetchModels })}>接入后获取上游模型目录</Check>
      <span>模型路由</span><Check checked={form.draft.autoEnableRoutes} disabled={busy} onChange={autoEnableRoutes => form.update({ autoEnableRoutes })}>自动启用新发现的模型路由</Check>
      <Field label="检查间隔（秒）" id={`${id}-interval`}><input id={`${id}-interval`} type="number" min="10" max="86400" value={form.draft.intervalSeconds} disabled={busy} onChange={event => form.update({ intervalSeconds: event.target.value })}/></Field>
      <div className="credit-hub__wide credit-hub__toolbar"><Action primary disabled={busy || !form.dirty || !Number.isInteger(Number(form.draft.intervalSeconds)) || Number(form.draft.intervalSeconds) < 10 || Number(form.draft.intervalSeconds) > 86400} onClick={save}>保存发现设置</Action><Action disabled={busy || state.scanning} onClick={() => perform('扫描并接入新 Agent', post('/hub/discovery', { connect: true }))}>{state.scanning ? '正在扫描接入…' : '立即扫描并接入'}</Action></div>
    </div>
    <p className="credit-hub__muted">{state.running ? '后台发现运行中' : '后台发现尚未运行'} · 最近检查：{when(state.scannedAt || state.checkedAt)}。接入状态与模型目录核验分开显示；没有有效登录态时，不显示为已接入。</p>
    <Rows columns={['客户端 / 平台', '接入状态', '模型路由', '说明']} rows={rows} label="Agent 发现结果" empty="尚无发现记录。开启后台发现或点击“立即扫描并接入”，后装客户端会在下一轮检查。">{rows.map((row, index) => <tr key={row.id || `${row.platform}-${index}`}><td><span className="credit-hub__cell-main">{show(row.label, row.platform || '客户端')}</span><span className="credit-hub__cell-detail">{show(row.platform)}</span></td><td>{discoveryState(row)}{row.accountId && <span className="credit-hub__cell-detail">已建立独立账号</span>}</td><td>{Number.isFinite(row.routeCount) ? `${number(row.routeCount)} 条` : '尚无目录'}<span className="credit-hub__cell-detail">{({ ready: '目录已更新', cached: '使用缓存目录', error: '目录更新失败', failed: '目录更新失败', disabled: '目录获取已关闭', needs_setup: '目录需要配置', pending: '等待目录更新', not_requested: '尚未更新目录' })[row.catalogStatus] || show(row.catalogStatus, '目录未核验')}</span></td><td><span className="credit-hub__cell-detail">{show(row.reason || row.catalogReason, '—')}</span></td></tr>)}</Rows>
  </section>;
}

export function forecastHours(value) {
  if (!Number.isFinite(value) || value < 0) return '数据不足';
  if (value === 0) return '已到耗尽线';
  if (value < 1) return `约 ${Math.max(1, Math.round(value * 60))} 分钟`;
  return `约 ${number(value)} 小时`;
}
export function reserveSuggestionText(row) {
  if (!Number.isFinite(row.reservePercent)) return Number.isFinite(row.reserveCredits) ? `建议预留 ${number(row.reserveCredits)} ${show(row.unit, '额度')}；总额度未知，暂不换算百分比` : '样本不足或补充时间未知，暂不建议百分比';
  return `建议预留 ${number(row.reservePercent)}%${Number.isFinite(row.reserveCredits) ? `（${number(row.reserveCredits)} ${show(row.unit, '额度')}）` : ''}${row.reserveReason === 'engine_reserve_percent_limit_50' ? '；超过接力引擎 50% 上限' : row.canApplyReservePercent === false ? '；仅供参考，不适用于积分接力比例' : ''}`;
}
function coverageText(value) {
  if (typeof value === 'string') return value;
  if (Number.isFinite(value)) return `${number(value)} 天观测`;
  const coverage = object(value), parts = [];
  if (Number.isFinite(coverage.days ?? coverage.observedDays)) parts.push(`${number(coverage.days ?? coverage.observedDays)} 天观测`);
  if (Number.isFinite(coverage.observedHours ?? coverage.measuredHours)) parts.push(`${number(coverage.observedHours ?? coverage.measuredHours)} 小时观测`);
  if (Number.isFinite(coverage.measuredRows)) parts.push(`${number(coverage.measuredRows)} 个测量`);
  if (Number.isFinite(coverage.missingRows) && coverage.missingRows > 0) parts.push(`${number(coverage.missingRows)} 条计费缺失`);
  if (Number.isFinite(coverage.ratio)) parts.push(`7 天覆盖 ${number(coverage.ratio * 100)}%`);
  if (Number.isFinite(coverage.samples)) parts.push(`${number(coverage.samples)} 个样本`);
  return parts.join(' / ') || '观测覆盖未知';
}
export function renewalInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(+date)) return '';
  // datetime-local is deliberately labelled browser-local, not schedule timezone.
  const local = new Date(+date - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
export function buildForecastPatch(draft) {
  const safetyMultiplier = Number(draft.safetyMultiplier);
  if (!Number.isFinite(safetyMultiplier) || safetyMultiplier < 1 || safetyMultiplier > 5) throw new Error('预测安全系数应为 1–5。');
  const renewAtByAccount = {}, keys = Array.isArray(draft.changedRenewalIds) ? draft.changedRenewalIds : Object.keys(object(draft.renewAtByAccount));
  for (const accountId of keys) {
    if (!/^account-[a-f0-9]{12}$/.test(accountId)) throw new Error('账号引用已变化，请刷新本地快照后重新选择补充时间。');
    const value = draft.renewAtByAccount?.[accountId];
    if (value === null || value === '') { renewAtByAccount[accountId] = null; continue; }
    const date = new Date(value);
    if (!Number.isFinite(+date)) throw new Error('补充时间格式不正确，请重新选择日期与时刻。');
    renewAtByAccount[accountId] = date.toISOString();
  }
  return { forecast: { safetyMultiplier, renewAtByAccount } };
}
export function ForecastPanel({ snapshot, busy, perform }) {
  const forecast = object(operations(snapshot).forecast), rows = list(forecast.accounts), current = settingsFor(snapshot, 'forecast'), id = useId();
  const form = useDraft({ safetyMultiplier: current.safetyMultiplier ?? 1.25, renewAtByAccount: object(current.renewAtByAccount), changedRenewalIds: [] }), [error, setError] = useState('');
  const editRenewal = (accountId, value) => { setError(''); form.update({ renewAtByAccount: { ...form.draft.renewAtByAccount, [accountId]: value || null }, changedRenewalIds: [...new Set([...form.draft.changedRenewalIds, accountId])] }); };
  const save = () => { setError(''); let body; try { body = buildForecastPatch(form.draft); } catch (failure) { setError(failure.message); return; } const fresh = form.guard.capture(); return perform('保存额度预测参数', post('/hub/operations', body), () => { if (fresh()) form.saved({ changedRenewalIds: [] }); }); };
  const assumptions = Array.isArray(forecast.assumptions) ? forecast.assumptions.filter(item => typeof item === 'string') : typeof forecast.assumptions === 'string' ? [forecast.assumptions] : [];
  return <section aria-label="额度消耗预测">
    <h2>额度 burn-down 与预留建议</h2>
    <p className="credit-hub__muted">按最近 7 天同单位的实测消耗估算，预测不是官方账单。缺少余额、总额度或有效消耗样本时保留“数据不足”，不以 Token 数直接替代积分。</p>
    <div className="credit-hub__toolbar"><Action disabled={busy} onClick={() => perform('重算本地额度预测', { method: 'GET', path: '/hub/forecast' })}>重算本地预测</Action><span className="credit-hub__muted">不刷新上游余额</span></div>
    <details><summary>预测参数与续费时间</summary>
      <p className="credit-hub__muted">以下时间使用本机时区 {Intl.DateTimeFormat().resolvedOptions().timeZone || '本机时间'}。预留量 = 每小时消耗 × 距下次补充小时 × 安全系数；后端取未来续费与可用签到计划中的较早时刻。</p>
      <div className="credit-hub__form"><Field label="预测安全系数" id={`${id}-safety`}><input id={`${id}-safety`} type="number" min="1" max="5" step="0.05" value={form.draft.safetyMultiplier} disabled={busy} onChange={event => form.update({ safetyMultiplier: event.target.value })}/></Field></div>
      <Rows columns={['账号', '下次续费 / 补充时间（本机）', '操作']} rows={rows} label="逐账号下次补充时间" empty="接入账号后可为每个账号设置下次续费时间。">{rows.map((row, index) => <tr key={row.accountId || index}><td>{show(row.label, '账号')}</td><td><input type="datetime-local" aria-label={`${show(row.label, '账号')} · 下次续费或补充时间`} disabled={busy || !/^account-[a-f0-9]{12}$/.test(row.accountId || '')} value={renewalInputValue(form.draft.renewAtByAccount[row.accountId])} onChange={event => editRenewal(row.accountId, event.target.value)}/></td><td><Action disabled={busy || !form.draft.renewAtByAccount[row.accountId]} onClick={() => editRenewal(row.accountId, null)}>清除续费时间</Action></td></tr>)}</Rows>
      <p className="credit-hub__muted">留空或清除后只使用可用签到计划；已过的时间不计入预测。保存只影响额度预测，不启动签到、不修改账号，也不自动套用全局接力阈值。</p>
      <div className="credit-hub__toolbar"><Action primary disabled={busy || !form.dirty} onClick={save}>保存预测参数</Action></div><Feedback error>{error}</Feedback>
    </details>
    <Rows columns={['账户 / 数据覆盖', '消耗速度', '预计耗尽', '下次补充', '接力预留建议']} rows={rows} label="逐账号额度预测" empty="尚无可预测账号。先接入账号，再积累同单位余额与消耗记录；预测只读取本地测量。">{rows.map((row, index) => <tr key={row.accountId || index}><td><span className="credit-hub__cell-main">{show(row.label, '账号')}</span><span className="credit-hub__cell-detail">{coverageText(row.coverage)} · {({ upstream_credits: '上游计费积分', upstream_cost: '上游计费费用', balance_net_decrease: '余额净减少' })[row.source] || '来源待核验'}</span></td><td>{Number.isFinite(row.burnRatePerHour) ? `${number(row.burnRatePerHour)} ${show(row.unit, '额度')} / 小时` : '数据不足'}</td><td>{forecastHours(row.estimatedHours)}<span className="credit-hub__cell-detail">{row.exhaustAt ? when(row.exhaustAt) : ({ no_measured_burn: '观测期未测得消耗，不代表无限额度', insufficient_data: '等待更多有效样本', balance_stale: '余额已过时，请手动刷新', balance_expired: '已过额度有效期', missing_balance: '缺少同单位余额' })[row.status] || '尚无可靠耗尽时间'}</span></td><td>{row.nextReplenishAt ? when(row.nextReplenishAt) : '未设置签到 / 续费时间'}</td><td>{reserveSuggestionText(row)}<span className="credit-hub__cell-detail">{Number.isFinite(row.reserveSafetyFactor) ? `消耗速度 × 距补充小时 × ${number(row.reserveSafetyFactor)}。` : ''}仅为该账号的估算，不自动覆盖全局接力策略。</span>{list(row.assumptions).length > 0 && <details><summary>此账号预测依据</summary><ul>{row.assumptions.filter(item => typeof item === 'string').map((item, key) => <li key={key}>{item}</li>)}</ul></details>}</td></tr>)}</Rows>
    {assumptions.length > 0 && <details><summary>预测依据与假设</summary><ul>{assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
  </section>;
}

export function buildNotificationPatch(draft, webhookUrl = '') {
  const days = Number(draft.credentialWarnDays), credits = Number(draft.balanceCredits), percent = Number(draft.balancePercent), cooldown = Number(draft.cooldownMinutes) * 60;
  if (!Number.isFinite(days) || days < 0 || days > 90 || !Number.isFinite(credits) || credits < 0 || credits > 1e9 || !Number.isFinite(percent) || percent < 0 || percent > 100 || !Number.isFinite(cooldown) || cooldown < 0 || cooldown > 604800) throw new Error('请检查过期天数（0–90）、积分阈值、百分比（0–100）与去重间隔。');
  if (draft.webhookEnabled && !draft.webhookConfigured && !webhookUrl.trim()) throw new Error('请先填入 Webhook 地址，再启用该出口。');
  const patch = { enabled: !!draft.enabled, credentialWarnDays: days, balanceThreshold: { credits, percent }, cooldownSeconds: cooldown, mappings: {}, sinks: { native: { kind: 'native', enabled: !!draft.nativeEnabled } } };
  if (draft.webhookConfigured || webhookUrl.trim()) patch.sinks.webhook = { kind: 'webhook', enabled: !!draft.webhookEnabled };
  for (const [event] of notificationEvents) patch.mappings[event] = [...new Set(list(draft.mappings?.[event]).filter(sink => typeof sink === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(sink) && (sink !== 'webhook' || patch.sinks.webhook)))];
  if (webhookUrl.trim()) { const url = new URL(webhookUrl.trim()); if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) throw new Error('Webhook 地址需使用 HTTPS；本机测试可使用 loopback HTTP。'); if (url.username || url.password) throw new Error('请将认证内容保存在本地服务配置中，不放入 Webhook 地址用户名字段。'); patch.sinks.webhook.url = webhookUrl.trim(); }
  // No blank URL/header is emitted: the server deep-merges sink secrets locally.
  return { events: patch };
}
function notificationsDraft(snapshot) {
  const state = object(operations(snapshot).events), current = settingsFor(snapshot, 'events'), sinks = object(current.sinks || state.sinks);
  return { enabled: current.enabled ?? state.enabled ?? false, nativeEnabled: sinks.native?.enabled ?? true, webhookEnabled: sinks.webhook?.enabled ?? false, webhookConfigured: !!sinks.webhook, credentialWarnDays: current.credentialWarnDays ?? 7, balanceCredits: current.balanceThreshold?.credits ?? 100, balancePercent: current.balanceThreshold?.percent ?? 10, cooldownMinutes: (current.cooldownSeconds ?? 3600) / 60, mappings: { ...object(state.mappings), ...object(current.mappings) } };
}
export function NotificationSettings({ snapshot, busy, perform }) {
  const state = object(operations(snapshot).events), form = useDraft(notificationsDraft(snapshot)), id = useId();
  const [webhookUrl, setWebhookUrl] = useState(''), [error, setError] = useState('');
  const map = (event, sink, checked) => { const next = new Set(list(form.draft.mappings[event])); checked ? next.add(sink) : next.delete(sink); form.update({ mappings: { ...form.draft.mappings, [event]: [...next] } }); };
  const save = () => {
    setError(''); let body;
    try { body = buildNotificationPatch(form.draft, webhookUrl); } catch (failure) { setError(failure.message); return; }
    const fresh = form.guard.capture();
    return perform('保存事件通知', post('/hub/operations', body), () => { if (fresh()) { form.saved(); setWebhookUrl(''); } });
  };
  const recent = list(state.recent).slice(0, 10);
  return <section aria-label="事件通知设置">
    <h2>事件出口与通知</h2>
    <p className="credit-hub__muted">每类事件可映射到 DSH 通知或 Webhook / IM。外发内容只含脱敏摘要；同一事件按去重间隔合并，失败投递会保留状态。</p>
    <div className="credit-hub__form">
      <span>事件出口</span><Check checked={form.draft.enabled} disabled={busy} onChange={enabled => form.update({ enabled })}>启用事件通知</Check>
      <span>DSH 通知</span><Check checked={form.draft.nativeEnabled} disabled={busy} onChange={nativeEnabled => form.update({ nativeEnabled })}>发送宿主通知</Check>
      <span>Webhook / IM</span><Check checked={form.draft.webhookEnabled} disabled={busy} onChange={webhookEnabled => form.update({ webhookEnabled })}>启用 Webhook 出口</Check>
      <Field label="Webhook 地址" id={`${id}-webhook`}><input id={`${id}-webhook`} type="password" autoComplete="new-password" aria-describedby={`${id}-secret-help`} placeholder={form.draft.webhookConfigured ? '已配置；留空保留原地址' : 'https://HOST/…'} value={webhookUrl} disabled={busy} onChange={event => { form.guard.change(); setWebhookUrl(event.target.value); setError(''); }}/></Field>
      <p id={`${id}-secret-help`} className="credit-hub__wide credit-hub__muted">地址仅在本次保存时提交；留空保留已配置地址，不回显完整 URL 或认证头。自定义 IM 协议可由 Webhook 服务适配。</p>
      <Field label="凭据提前提醒（天）" id={`${id}-days`}><input id={`${id}-days`} type="number" min="0" max="90" value={form.draft.credentialWarnDays} disabled={busy} onChange={event => form.update({ credentialWarnDays: event.target.value })}/></Field>
      <Field label="余额提醒（积分）" id={`${id}-balance`}><input id={`${id}-balance`} type="number" min="0" max="1000000000" step="any" value={form.draft.balanceCredits} disabled={busy} onChange={event => form.update({ balanceCredits: event.target.value })}/></Field>
      <Field label="余额提醒（百分比）" id={`${id}-percent`}><input id={`${id}-percent`} type="number" min="0" max="100" step="any" value={form.draft.balancePercent} disabled={busy} onChange={event => form.update({ balancePercent: event.target.value })}/></Field>
      <Field label="事件去重（分钟）" id={`${id}-cooldown`}><input id={`${id}-cooldown`} type="number" min="0" max="10080" value={form.draft.cooldownMinutes} disabled={busy} onChange={event => form.update({ cooldownMinutes: event.target.value })}/></Field>
    </div>
    <p className="credit-hub__muted">积分余额低于固定值或已知总额百分比任一阈值时提醒；连续失败由后端累计，成功请求会重置。</p>
    <Rows columns={['事件', 'DSH 通知', 'Webhook / IM']} rows={notificationEvents} label="事件到出口映射">{notificationEvents.map(([event, label]) => <tr key={event}><td>{label}</td><td><Check label={`${label} · DSH 通知`} checked={list(form.draft.mappings[event]).includes('native')} disabled={busy} onChange={checked => map(event, 'native', checked)}>通知</Check></td><td><Check label={`${label} · Webhook`} checked={list(form.draft.mappings[event]).includes('webhook')} disabled={busy || (!form.draft.webhookConfigured && !webhookUrl.trim())} onChange={checked => map(event, 'webhook', checked)}>Webhook</Check></td></tr>)}</Rows>
    <div className="credit-hub__toolbar"><Action primary disabled={busy || (!form.dirty && !webhookUrl.trim())} onClick={save}>保存事件通知</Action><Action disabled={busy || !state.enabled} onClick={() => perform('发送测试通知', post('/hub/events/test'))}>发送测试通知</Action><span className="credit-hub__muted">等待投递 {number(state.pending)} · 等待宿主接收 {number(state.nativePending)}</span></div>
    <Feedback error>{error}</Feedback>
    {recent.length > 0 && <details><summary>最近事件与投递状态</summary><Rows columns={['时间', '事件', '投递状态']} rows={recent} label="最近事件">{recent.map((event, index) => <tr key={event.id || index}><td>{when(event.at || event.createdAt)}</td><td><span className="credit-hub__cell-main">{notificationEvents.find(([key]) => key === event.type)?.[1] || show(event.type, '事件')}</span><span className="credit-hub__cell-detail">{show(event.message || event.summary, '已记录脱敏事件')}</span></td><td>{show(event.deliveryStatus || event.status, '已进入事件队列')}</td></tr>)}</Rows></details>}
  </section>;
}

export function buildUpdatePatch(draft) {
  const repository = String(draft.repository || '').trim(), feedUrl = String(draft.feedUrl || '').trim();
  if (repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('GitHub 仓库请填写 OWNER/REPO，不含网址或分支。');
  if (feedUrl && !draft.clearFeed) { const url = new URL(feedUrl); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('更新清单请使用不含用户名和密码的 HTTPS 地址。'); }
  const intervalHours = Number(draft.intervalHours);
  if (!Number.isFinite(intervalHours) || intervalHours < .25 || intervalHours > 168) throw new Error('检查间隔应为 0.25–168 小时。');
  return { updates: { enabled: !!draft.enabled, repository, ...(draft.clearFeed ? { feedUrl: '' } : feedUrl ? { feedUrl } : {}), intervalHours } };
}
export function publicReleaseLink(value) {
  try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) return null; url.search = ''; url.hash = ''; return url.href; } catch { return null; }
}
export function UpdatePanel({ snapshot, busy, perform }) {
  const state = object(operations(snapshot).updates), current = settingsFor(snapshot, 'updates'), form = useDraft({ enabled: current.enabled ?? true, repository: String(current.repository || '').replace(/^git\+/, '').replace(/\.git$/, '').replace(/^https:\/\/github.com\//, ''), feedUrl: '', clearFeed: false, intervalHours: current.intervalHours ?? 1 }), id = useId();
  const [error, setError] = useState('');
  const save = () => { setError(''); let body; try { body = buildUpdatePatch(form.draft); } catch (failure) { setError(failure.message); return; } const fresh = form.guard.capture(); return perform('保存云更新设置', post('/hub/operations', body), () => { if (fresh()) form.saved({ feedUrl: '', clearFeed: false }); }); };
  const releaseUrl = publicReleaseLink(state.releaseUrl);
  return <section aria-label="云更新设置">
    <h2>版本更新提醒</h2>
    <div className="credit-hub__notice" role={state.updateAvailable ? 'status' : undefined}><strong>{state.updateAvailable ? `发现新版本 ${show(state.availableVersion)}` : state.configured ? ({ check_failed: '更新检查失败，可重新检查', current: '当前未发现更新', checking: '正在检查更新…', up_to_date: '已是最新版本', never_checked: '尚未执行版本检查' })[state.status] || '更新检测已配置' : '尚未配置线上发布来源'}</strong><p className="credit-hub__muted">已安装 {show(state.installedVersion, snapshot.pluginVersion || '—')} · 最近检查 {when(state.checkedAt)}</p>{releaseUrl && <a href={releaseUrl} target="_blank" rel="noopener noreferrer">查看发布说明</a>}</div>
    <p className="credit-hub__muted">定期检测已发布版本；发现更新后按事件出口提醒，不在后台覆盖正在使用的插件。市场安装仍由 DSH 插件市场执行，本地 link 安装只显示更新信息。</p>
    <div className="credit-hub__form">
      <span>后台检查</span><Check checked={form.draft.enabled} disabled={busy} onChange={enabled => form.update({ enabled })}>启用云版本检测</Check>
      <Field label="GitHub 仓库" id={`${id}-repository`}><input id={`${id}-repository`} placeholder="OWNER/REPO" value={form.draft.repository} disabled={busy} onChange={event => form.update({ repository: event.target.value })}/></Field>
      <Field label="HTTPS 更新清单" id={`${id}-feed`}><input id={`${id}-feed`} type="password" autoComplete="new-password" placeholder="可选；留空保留现有清单" value={form.draft.feedUrl} disabled={busy || form.draft.clearFeed} onChange={event => form.update({ feedUrl: event.target.value })}/></Field>
      <span>清单来源</span><Check checked={form.draft.clearFeed} disabled={busy} onChange={clearFeed => form.update({ clearFeed })}>清除已有清单，改用 GitHub 仓库</Check>
      <Field label="检查间隔（小时）" id={`${id}-interval`}><input id={`${id}-interval`} type="number" min="0.25" max="168" step="0.25" value={form.draft.intervalHours} disabled={busy} onChange={event => form.update({ intervalHours: event.target.value })}/></Field>
      <div className="credit-hub__wide credit-hub__toolbar"><Action primary disabled={busy || !form.dirty} onClick={save}>保存更新来源</Action><Action disabled={busy || !state.configured || state.status === 'checking'} onClick={() => perform('检查云版本', post('/hub/updates'))}>立即检查更新</Action></div>
    </div>
    <Feedback error>{error}</Feedback>
  </section>;
}

export function missingAccountIds(rows, selection) {
  const allowed = new Set(list(rows).map(row => row.accountId).filter(id => typeof id === 'string' && id));
  return [...new Set(list(selection).filter(id => allowed.has(id)))];
}
export function buildSchedulerPatch(draft) {
  const maxConcurrency = Number(draft.maxConcurrency), startupSpreadSeconds = Number(draft.startupSpreadSeconds);
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 32 || !Number.isFinite(startupSpreadSeconds) || startupSpreadSeconds < 0 || startupSpreadSeconds > 86400) throw new Error('并发上限应为 1–32；启动补跑分散应为 0–86400 秒。');
  const windows = {};
  for (const [platform, window] of Object.entries(object(draft.windows))) {
    if (window === null) continue;
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(window.start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(window.end) || window.start === window.end) throw new Error(`${platform} 的窗口应为不同的有效 HH:MM 时刻。`);
    windows[platform] = { start: window.start, end: window.end };
  }
  return { windows, maxConcurrency, startupSpreadSeconds, startup: !!draft.startup };
}
export function SchedulerControls({ snapshot, busy, perform }) {
  const schedule = object(snapshot.schedule), state = object(schedule.status), current = object(schedule.settings), form = useDraft({ windows: object(current.windows), maxConcurrency: current.maxConcurrency ?? 2, startupSpreadSeconds: current.startupSpreadSeconds ?? 300, startup: current.startup ?? false });
  const [selection, setSelection] = useState([]), [platform, setPlatform] = useState(''), [start, setStart] = useState('00:05'), [end, setEnd] = useState('00:40'), [error, setError] = useState('');
  const guard = useOperationGuard(), id = useId(), missing = list(state.todayMissing), selectedIds = missingAccountIds(missing, selection);
  const platforms = [...new Set([...list(snapshot.accounts).map(account => account.platform), ...Object.keys(form.draft.windows)].filter(Boolean))].sort();
  const selectedPlatform = platform || platforms[0] || '', windows = Object.entries(form.draft.windows).filter(([, window]) => window !== null);
  const signature = JSON.stringify(selectedIds); guard.select(signature);
  const toggle = accountId => { guard.change(); setSelection(values => values.includes(accountId) ? values.filter(value => value !== accountId) : [...values, accountId]); };
  const manual = accountIds => { const fresh = guard.capture(); return perform('补签今日未完成账号', post('/hub/scheduler/manual', { ...(accountIds ? { accountIds } : {}), missingOnly: true }), () => { if (fresh()) setSelection([]); }); };
  const save = () => { setError(''); let body; try { body = buildSchedulerPatch(form.draft); } catch (failure) { setError(failure.message); return; } const fresh = form.guard.capture(); return perform('保存窗口与并发设置', post('/hub/scheduler', body), () => { if (fresh()) form.saved(); }); };
  const accountLabel = accountId => list(snapshot.accounts).find(account => account.id === accountId)?.label || '账号';
  return <section aria-label="签到调度窗口与补签">
    <h2>今日未签到</h2>
    <p className="credit-hub__muted">仅列出今日未确认成功的账号。启动补跑只自动处理今日未尝试项；已经尝试但失败的账号保留在这里，由你决定是否手动补签。</p>
    <div className="credit-hub__summary"><span>今日已尝试 <strong>{number(typeof state.todayAttempted === 'number' ? state.todayAttempted : Array.isArray(state.todayAttempted) ? state.todayAttempted.length : undefined)}</strong></span><span>等待执行 <strong>{number(Array.isArray(state.queue) ? state.queue.length : typeof state.queue === 'number' ? state.queue : undefined)}</strong></span><span>执行中 <strong>{number(Array.isArray(state.running) ? state.running.length : typeof state.running === 'number' ? state.running : undefined)}</strong></span></div>
    <Rows columns={['账号 / 平台', '今日状态', '计划执行', '操作']} rows={missing} label="今日未签到账号" empty={state.todayMissing ? '今日没有待补签账号；此处只读取本地调度状态。' : '尚无今日调度状态。刷新本地快照后可查看未签到账号。'}>{missing.map((row, index) => <tr key={`${row.accountId}-${row.task || index}`}><td><Check label={`补签选择 · ${accountLabel(row.accountId)} · ${row.platform || ''}`} checked={selectedIds.includes(row.accountId)} disabled={busy || !row.accountId} onChange={() => toggle(row.accountId)}>{accountLabel(row.accountId)}</Check><span className="credit-hub__cell-detail">{show(row.platform)} · {show(row.task, '签到')}</span></td><td>{row.attemptedToday ? '今日已尝试，尚未成功' : '今日尚未尝试'}<span className="credit-hub__cell-detail">{show(row.status, row.automaticEligible ? '符合自动补跑条件' : '等待手动处理')}</span></td><td>{row.plannedAt ? when(row.plannedAt) : '尚未排入窗口'}</td><td><Action disabled={busy || !row.accountId} onClick={() => manual([row.accountId])}>补签此账号</Action></td></tr>)}</Rows>
    {missing.length > 0 && <div className="credit-hub__toolbar"><Action disabled={busy} onClick={() => { guard.change(); setSelection(missingAccountIds(missing, missing.map(row => row.accountId))); }}>全选未签到账号</Action><Action primary disabled={busy || !selectedIds.length} onClick={() => manual(selectedIds)}>补签已选（{selectedIds.length}）</Action><Action disabled={busy} onClick={() => manual()}>补签全部未完成</Action></div>}
    <details><summary>时间窗口、随机抖动与并发</summary>
      <p className="credit-hub__muted">窗口按排程时区 {show(current.timezone, 'Asia/Shanghai')} 计算。每个账号在窗口内分散执行；手动补签同样遵循全局并发上限。</p>
      <div className="credit-hub__form">
        <Field label="全局并发上限" id={`${id}-concurrency`}><input id={`${id}-concurrency`} type="number" min="1" max="32" value={form.draft.maxConcurrency} disabled={busy} onChange={event => form.update({ maxConcurrency: event.target.value })}/></Field>
        <Field label="启动补跑分散（秒）" id={`${id}-spread`}><input id={`${id}-spread`} type="number" min="0" max="86400" value={form.draft.startupSpreadSeconds} disabled={busy} onChange={event => form.update({ startupSpreadSeconds: event.target.value })}/></Field>
        <span>启动补跑</span><Check checked={form.draft.startup} disabled={busy} onChange={startup => form.update({ startup })}>启动后分散补跑今日未尝试账号</Check>
      </div>
      <h2>平台独立窗口</h2><p className="credit-hub__muted">未覆盖的平台使用默认排程时间；跨午夜窗口的凌晨、夜间部分按各自本地日期去重。下方 00:05–00:40 仅为新增窗口的可编辑初始值，点击添加后才保存。</p>
      <div className="credit-hub__toolbar"><select aria-label="新增窗口平台" value={selectedPlatform} disabled={busy || !platforms.length} onChange={event => setPlatform(event.target.value)}>{platforms.length ? platforms.map(item => <option key={item} value={item}>{item}</option>) : <option value="">先接入账号</option>}</select><input type="time" aria-label="新增窗口开始" value={start} disabled={busy} onChange={event => setStart(event.target.value)}/><span>至</span><input type="time" aria-label="新增窗口结束" value={end} disabled={busy} onChange={event => setEnd(event.target.value)}/><Action disabled={busy || !selectedPlatform || !start || !end} onClick={() => form.update({ windows: { ...form.draft.windows, [selectedPlatform]: { start, end } } })}>添加 / 替换窗口</Action></div>
      <Rows columns={['平台', '开始', '结束', '操作']} rows={windows} label="平台签到时间窗口" empty="尚无独立窗口，所有平台使用默认排程时间。">{windows.map(([key, window]) => <tr key={key}><td>{key}</td><td><input type="time" aria-label={`${key} 窗口开始`} value={window.start} disabled={busy} onChange={event => form.update({ windows: { ...form.draft.windows, [key]: { ...window, start: event.target.value } } })}/></td><td><input type="time" aria-label={`${key} 窗口结束`} value={window.end} disabled={busy} onChange={event => form.update({ windows: { ...form.draft.windows, [key]: { ...window, end: event.target.value } } })}/></td><td><Action disabled={busy} onClick={() => { const next = { ...form.draft.windows }; delete next[key]; form.update({ windows: next }); }}>恢复默认窗口</Action></td></tr>)}</Rows>
      <div className="credit-hub__toolbar"><Action primary disabled={busy || !form.dirty} onClick={save}>保存窗口与并发</Action></div><Feedback error>{error}</Feedback>
    </details>
  </section>;
}

export function OperationsSettings(props) { return <><DiscoveryPanel {...props}/><NotificationSettings {...props}/><UpdatePanel {...props}/></>; }
