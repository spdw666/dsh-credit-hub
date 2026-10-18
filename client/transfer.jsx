import React, { useEffect, useRef, useState } from 'react';

const MAX_INPUT = 4 * 1024 * 1024;
const MAX_DOWNLOAD = 2 * 1024 * 1024;
const utf8Size = value => new TextEncoder().encode(JSON.stringify(value)).length;
export async function readTransferFiles(files) {
  if (!files.length || files.length > 128) throw new Error('请选择 1–128 个 JSON 或 ZIP 文件。');
  let total = 0;
  const results = [];
  for (const file of files) {
    total += file.size;
    if (total > MAX_INPUT) throw new Error('文件总大小超出 4 MiB，请分批导入。');
    if (!/\.(json|zip)$/i.test(file.name)) throw new Error('请选择 JSON 或 ZIP 账号文件。');
    if (/\.zip$/i.test(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let index = 0; index < bytes.length; index += 16384) binary += String.fromCharCode(...bytes.subarray(index, index + 16384));
      results.push({ format: 'zip', content: btoa(binary) });
    } else {
      // Keep BOM/encoding intact: the engine's decoder understands UTF-8/UTF-16.
      const bytes = new Uint8Array(await file.arrayBuffer());
      const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
      results.push({ format: 'json', content: new TextDecoder(encoding, { fatal: true }).decode(bytes) });
    }
  }
  const body = { files: results };
  if (utf8Size({ ...body, duplicatePolicy: 'replace' }) > MAX_INPUT - 4096) throw new Error('编码后的请求超出 4 MiB，请减少文件或分批导入。');
  return body;
}
export function decodeAccountDownload(download) {
  if (!download || typeof download.filename !== 'string' || !/^[a-zA-Z0-9_.-]+\.(json|zip)$/.test(download.filename) || download.filename.includes('..') || !['application/json; charset=utf-8', 'application/json', 'application/zip'].includes(download.mimeType)) throw new Error('导出文件描述不正确，请重新导出。');
  const content = download.contentBase64;
  if (typeof content !== 'string' || !content.length || content.length > MAX_DOWNLOAD || content.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) throw new Error('导出内容超限或格式不正确，请分批导出。');
  const binary = atob(content);
  if (btoa(binary) !== content) throw new Error('导出内容校验失败，请重新导出。');
  return { filename: download.filename, blob: new Blob([Uint8Array.from(binary, character => character.charCodeAt(0))], { type: download.mimeType }) };
}
export function saveAccountDownload(download) {
  const { filename, blob } = decodeAccountDownload(download);
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor);
  try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
  return filename;
}
function Action({ primary, children, ...props }) { return <button type="button" className={`credit-hub__button${primary ? ' credit-hub__button--primary' : ''}`} {...props}>{children}</button>; }

export function AccountTransfer({ mode, accounts, busy, perform, onClose }) {
  const [input, setInput] = useState(null), [fileNames, setFileNames] = useState('');
  const [preview, setPreview] = useState(null), [policy, setPolicy] = useState('skip');
  const [selection, setSelection] = useState([]), [format, setFormat] = useState('json');
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [reading, setReading] = useState(false);
  const generation = useRef(0), alive = useRef(true), fileInput = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const isImport = mode === 'import', workbuddy = accounts.filter(account => account.platform === 'workbuddy');
  const toggle = id => setSelection(values => values.includes(id) ? values.filter(value => value !== id) : [...values, id]);
  const selectFiles = async event => {
    const version = ++generation.current, files = [...event.target.files];
    setInput(null); setPreview(null); setMessage(''); setError(''); setReading(true); setFileNames(files.map(file => file.name).join('、'));
    if (!files.length) { setReading(false); return; }
    try { const body = await readTransferFiles(files); if (alive.current && version === generation.current) setInput(body); }
    catch (failure) { if (alive.current && version === generation.current) setError(failure.message); }
    finally { if (alive.current && version === generation.current) setReading(false); }
  };
  const previewImport = () => {
    const version = generation.current;
    setError(''); setMessage(''); setPreview(null);
    return perform('预览导入账号', { method: 'POST', path: '/admin/workbuddy/accounts/import/preview', body: input }, response => {
      if (alive.current && version === generation.current) setPreview(response.body);
    });
  };
  const commitImport = async () => {
    const version = generation.current;
    setMessage('');
    const ok = await perform('导入账号', { method: 'POST', path: '/admin/workbuddy/accounts/import/commit', body: { ...input, duplicatePolicy: policy } }, response => {
      if (!alive.current || version !== generation.current) return;
      const body = response.body;
      setMessage(`已新增 ${body.imported || 0} 个，替换 ${body.replaced || 0} 个，跳过 ${body.skipped || 0} 个账号。`);
      setPreview(null); setInput(null); setFileNames('');
      if (fileInput.current) fileInput.current.value = '';
    });
    return ok;
  };
  const exportAccounts = () => {
    setMessage(''); setError('');
    return perform('导出账号', { method: 'POST', path: '/admin/workbuddy/accounts/export', body: { format, accountIds: selection } }, response => {
      if (!alive.current) return;
      const filename = saveAccountDownload(response.body?.download);
      setMessage(`已生成 ${response.body.accountCount} 个账号的文件 ${filename}；已交给 DSH 下载，请在下载目录查看。`);
    });
  };
  return <section className="credit-hub__transfer" aria-label={isImport ? '导入账号文件' : '导出账号文件'}>
    <h2>{isImport ? '导入账号' : '导出账号'}</h2>
    <p className="credit-hub__muted">支持 WorkBuddy 国内 / 国际账号：JSON、ZIP 与 workbuddy-switch JSON。文件包含登录凭据；只在你选择文件或点击导出时传输，不显示在操作记录中。</p>
    {isImport ? <>
      <label className="credit-hub__transfer-file">选择账号文件<input ref={fileInput} type="file" aria-label="选择账号文件" accept=".json,.zip,application/json,application/zip" multiple disabled={busy || reading} onChange={selectFiles}/></label>
      {fileNames && <p className="credit-hub__muted">{reading ? '正在读取文件…' : '已选择：'}{fileNames}</p>}
      <div className="credit-hub__toolbar"><label>重复账号 <select aria-label="重复账号处理" disabled={busy} value={policy} onChange={event => setPolicy(event.target.value)}><option value="skip">跳过，保留当前登录态</option><option value="replace">替换登录态，保留当前开关</option></select></label><Action disabled={busy || reading || !input} onClick={previewImport}>预览导入</Action><Action primary disabled={busy || !input || !preview?.valid || reading} onClick={commitImport}>确认导入</Action><Action disabled={busy} onClick={onClose}>关闭</Action></div>
      {preview && <div className="credit-hub__transfer-list" aria-label="导入预览"><p>{preview.valid ? '校验通过' : '校验存在错误'} · {preview.count || 0} 个账号；确认前不会写入。</p>{(preview.entries || []).map((entry, index) => <p key={index}>{entry.label} · {entry.edition === 'ai' ? '国际' : '国内'} · {entry.duplicate ? '重复账号' : '新账号'}{entry.expired ? ' · 登录态已过期' : ''}{entry.hasRefreshToken === false ? ' · 仅有访问态' : ''}</p>)}{(preview.errors || []).map((item, index) => <p key={`error-${index}`} role="alert">{item.index === null ? '' : `第 ${item.index + 1} 个账号：`}{item.message}</p>)}</div>}
    </> : <>
      <div className="credit-hub__toolbar"><label>文件格式 <select aria-label="导出文件格式" disabled={busy} value={format} onChange={event => setFormat(event.target.value)}><option value="json">JSON</option><option value="zip">ZIP（多账号）</option><option value="switch-json">workbuddy-switch JSON</option></select></label><Action disabled={busy || !workbuddy.length} onClick={() => setSelection(workbuddy.map(account => account.id))}>全选 WorkBuddy</Action><Action disabled={busy || !selection.length} onClick={() => setSelection([])}>清空选择</Action></div>
      <div className="credit-hub__transfer-list">{workbuddy.length ? workbuddy.map(account => <label key={account.id} className="credit-hub__check"><input type="checkbox" aria-label={`导出 ${account.label}`} checked={selection.includes(account.id)} disabled={busy} onChange={() => toggle(account.id)}/>{account.label}</label>) : <p>尚无 WorkBuddy 账号，请先导入或添加。</p>}</div>
      <div className="credit-hub__toolbar"><Action primary disabled={busy || !selection.length} onClick={exportAccounts}>导出已选账号（{selection.length}）</Action><Action disabled={busy} onClick={onClose}>关闭</Action></div>
    </>}
    {error && <p className="credit-hub__transfer-status" role="alert">{error}</p>}{message && <p className="credit-hub__transfer-status" role="status">{message}</p>}
  </section>;
}
