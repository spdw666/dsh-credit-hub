globalThis.__ModuleLoader__.load({id:'dsh-credit-hub',factory:(require)=>{const module={exports:{}};const exports=module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/index.jsx
var index_exports = {};
__export(index_exports, {
  Accounts: () => Accounts,
  HubView: () => HubView,
  accountConnectionLabel: () => accountConnectionLabel,
  apply: () => apply,
  createAccountResponseGuard: () => createAccountResponseGuard,
  createCreditHubApi: () => createCreditHubApi,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var import_react3 = __toESM(require("react"), 1);

// client/styles.js
var styles = String.raw`
.credit-hub {
  --hub-bg: var(--dsw-alias-bg-base, #fff);
  --hub-layer: var(--dsw-alias-bg-layer-1, #f7f8fa);
  --hub-text: var(--dsw-alias-label-primary, #202124);
  --hub-muted: var(--dsw-alias-label-secondary, #5d6470);
  --hub-line: var(--dsw-alias-border-l3, #e4e7ec);
  --hub-accent: var(--dsw-alias-brand-primary, #4169e1);
  --hub-accent-text: var(--dsw-alias-brand-text, #315bc9);
  --hub-action-bg: var(--dsw-alias-button-primary-fill, #1b1b1c);
  --hub-action-text: var(--dsw-alias-label-primary-foreground, #fff);
  --hub-action-hover: var(--dsw-alias-button-primary-hover, #43454a);
  --hub-disabled-bg: var(--dsw-alias-button-primary-dimmed, #ebeef2);
  --hub-hover: var(--dsw-alias-interactive-bg-hover, #f0f2f6);
  --hub-selected: var(--dsw-alias-interactive-bg-active, #edf2ff);
  --hub-space-xs: 4px; --hub-space-sm: 8px; --hub-space-md: 12px;
  --hub-space-lg: 16px; --hub-space-xl: 24px;
  --hub-radius: 8px; --hub-row: 44px;
  container-name: credit-hub; container-type: inline-size;
  box-sizing: border-box; width: 100%; height: 100%; min-height: 0;
  color: var(--hub-text); background: var(--hub-bg);
  font: 14px/1.55 var(--dsh-font-family-text, inherit);
  overflow: auto; scrollbar-color: var(--dsw-alias-scrollbar-bg-l2, #bdc2cc) transparent;
}
.credit-hub *, .credit-hub *::before, .credit-hub *::after { box-sizing: border-box; }
.credit-hub ::selection { background: var(--hub-selected); color: var(--hub-text); }
.credit-hub input, .credit-hub select { caret-color: var(--hub-accent); }
.credit-hub :focus-visible { outline: 2px solid var(--hub-accent); outline-offset: 3px; }
.credit-hub__inner { padding: var(--hub-space-xl); max-width: 1360px; min-width: 0; margin: 0 auto; }
.credit-hub__header { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--hub-space-lg); }
.credit-hub h1 { font-size: 22px; line-height: 1.4; font-weight: 650; margin: 0 0 var(--hub-space-xs); }
.credit-hub h2 { font-size: 16px; font-weight: 600; margin: var(--hub-space-xl) 0 var(--hub-space-sm); }
.credit-hub p { margin: 0 0 var(--hub-space-md); max-width: 74ch; }
.credit-hub__muted { color: var(--hub-muted); }
.credit-hub__summary { display: flex; flex-wrap: wrap; gap: var(--hub-space-sm) var(--hub-space-xl); margin: var(--hub-space-lg) 0; font-size: 13px; color: var(--hub-muted); }
.credit-hub__summary strong { color: var(--hub-text); font-weight: 600; margin-left: var(--hub-space-xs); font-variant-numeric: tabular-nums; }
.credit-hub__tabs { display: flex; gap: var(--hub-space-xs); border-bottom: 1px solid var(--hub-line); overflow-x: auto; margin: 0 0 var(--hub-space-xl); }
.credit-hub__tab { position: relative; flex: 0 0 auto; border: 0; padding: var(--hub-space-md) var(--hub-space-lg); color: var(--hub-muted); background: transparent; font: inherit; cursor: pointer; }
.credit-hub__tab:hover { color: var(--hub-text); background: var(--hub-hover); }
.credit-hub__tab[aria-selected="true"] { color: var(--hub-accent-text); font-weight: 600; }
.credit-hub__tab[aria-selected="true"]::after { content: ''; position: absolute; left: var(--hub-space-lg); right: var(--hub-space-lg); bottom: 0; height: 2px; background: var(--hub-accent); }
.credit-hub__toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--hub-space-sm); margin: 0 0 var(--hub-space-lg); }
.credit-hub__toolbar > .credit-hub__search { flex: 1 1 220px; max-width: 380px; }
.credit-hub button.credit-hub__button { min-height: 34px; border: 1px solid var(--hub-line); border-radius: var(--hub-radius); padding: var(--hub-space-xs) var(--hub-space-md); color: var(--hub-text); background: var(--hub-bg); font: inherit; cursor: pointer; white-space: nowrap; }
.credit-hub button.credit-hub__button:hover:not(:disabled) { background: var(--hub-hover); }
.credit-hub button.credit-hub__button--primary { color: var(--hub-action-text); border-color: transparent; background: var(--hub-action-bg); }
.credit-hub button.credit-hub__button--primary:hover:not(:disabled) { background: var(--hub-action-hover); }
.credit-hub button.credit-hub__button:disabled, .credit-hub input:disabled, .credit-hub select:disabled { opacity: 1; cursor: not-allowed; color: var(--hub-muted); background: var(--hub-disabled-bg); border-color: var(--hub-line); }
.credit-hub input:not([type="checkbox"]), .credit-hub select { min-height: 34px; max-width: 100%; border: 1px solid var(--hub-line); border-radius: var(--hub-radius); padding: var(--hub-space-xs) var(--hub-space-sm); background: var(--hub-bg); color: var(--hub-text); font: inherit; }
.credit-hub input::placeholder { color: var(--hub-muted); opacity: 1; }
.credit-hub input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--hub-accent); margin: 0 var(--hub-space-sm) 0 0; vertical-align: middle; }
.credit-hub__check { display: inline-flex; align-items: center; min-height: 34px; gap: var(--hub-space-xs); cursor: pointer; white-space: nowrap; }
.credit-hub__table-wrap { max-width: 100%; overflow-x: auto; border-top: 1px solid var(--hub-line); }
.credit-hub table { width: 100%; min-width: 660px; border-collapse: collapse; text-align: left; color: var(--hub-text); font-variant-numeric: tabular-nums; }
.credit-hub th:first-child, .credit-hub td:first-child { min-width: 150px; width: 185px; }
.credit-hub th { padding: var(--hub-space-md); font-size: 12px; font-weight: 500; color: var(--hub-muted); background: var(--hub-layer); white-space: nowrap; }
.credit-hub td { height: var(--hub-row); border-bottom: 1px solid var(--hub-line); padding: var(--hub-space-sm) var(--hub-space-md); vertical-align: middle; }
.credit-hub tbody tr:hover { background: var(--hub-hover); }
.credit-hub__cell-main { display: block; font-weight: 550; }
.credit-hub__cell-detail { display: block; color: var(--hub-muted); font-size: 12px; margin-top: 2px; max-width: 480px; overflow-wrap: anywhere; }
.credit-hub__badge { display: inline-flex; align-items: center; gap: 6px; color: var(--hub-muted); font-size: 12px; white-space: nowrap; }
.credit-hub__badge::before { content: ''; width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: currentColor; }
.credit-hub__badge--enabled { color: var(--dsw-alias-state-success, #26734d); }
.credit-hub__badge--pending { color: var(--dsw-alias-state-warning, #8b6516); }
.credit-hub__notice { padding: var(--hub-space-md) var(--hub-space-lg); background: var(--hub-layer); border-radius: var(--hub-radius); margin-bottom: var(--hub-space-lg); }
.credit-hub__notice p:last-child { margin-bottom: 0; }
.credit-hub__notice--error { color: var(--dsw-alias-state-danger, #b33c35); }
.credit-hub__empty { padding: 48px var(--hub-space-xl); text-align: center; color: var(--hub-muted); }
.credit-hub__empty strong { display: block; font-weight: 550; color: var(--hub-text); margin-bottom: var(--hub-space-sm); }
.credit-hub__form { max-width: 640px; display: grid; grid-template-columns: minmax(130px, 180px) minmax(0, 1fr); gap: var(--hub-space-lg); align-items: center; margin-top: var(--hub-space-lg); }
.credit-hub__form label { color: var(--hub-muted); }
.credit-hub__form .credit-hub__wide { grid-column: 1 / -1; }
.credit-hub__form input[type="number"] { width: 130px; }
.credit-hub__kv { display: grid; grid-template-columns: minmax(120px, 180px) minmax(0, 1fr); max-width: 760px; gap: var(--hub-space-sm) var(--hub-space-lg); }
.credit-hub__kv dt { color: var(--hub-muted); }
.credit-hub__kv dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.credit-hub__progress { height: 6px; width: 100%; background: var(--hub-line); border-radius: 3px; overflow: hidden; margin: var(--hub-space-sm) 0; }
.credit-hub__progress > span { display: block; height: 100%; background: var(--hub-accent); transition: width .2s ease-out; }
.credit-hub__inline-form { display: flex; flex-wrap: wrap; gap: var(--hub-space-sm); margin: 0 0 var(--hub-space-lg); }
.credit-hub__transfer { margin-bottom: var(--hub-space-xl); padding: var(--hub-space-lg); border: 1px solid var(--hub-line); border-radius: var(--hub-radius); }
.credit-hub__transfer h2 { margin-top: 0; }
.credit-hub__transfer-file { display: grid; gap: var(--hub-space-sm); margin-bottom: var(--hub-space-lg); }
.credit-hub__transfer-file input::file-selector-button { font: inherit; color: var(--hub-text); background: var(--hub-layer); border: 1px solid var(--hub-line); border-radius: 4px; padding: var(--hub-space-xs) var(--hub-space-sm); margin-right: var(--hub-space-sm); cursor: pointer; }
.credit-hub__transfer-list { max-height: 240px; overflow: auto; margin-bottom: var(--hub-space-lg); }
.credit-hub__transfer-list .credit-hub__check { display: flex; white-space: normal; overflow-wrap: anywhere; }
.credit-hub__transfer-status { margin-top: var(--hub-space-md); overflow-wrap: anywhere; }
.credit-hub__text-button { appearance: none; padding: 0; border: 0; font: inherit; background: transparent; color: var(--hub-accent-text); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.credit-hub__result { margin-top: var(--hub-space-xl); padding-top: var(--hub-space-lg); border-top: 1px solid var(--hub-line); }
.credit-hub__result h2 { margin-top: 0; }
.credit-hub details { margin: var(--hub-space-md) 0; }
.credit-hub summary { cursor: pointer; padding: var(--hub-space-sm) 0; color: var(--hub-text); }
.credit-hub section[aria-label] + section[aria-label] { margin-top: var(--hub-space-xl); padding-top: var(--hub-space-lg); border-top: 1px solid var(--hub-line); }
@container credit-hub (max-width: 680px) {
  .credit-hub__inner { padding: var(--hub-space-lg); }
  .credit-hub__header { flex-wrap: wrap; }
  .credit-hub__tabs { flex-wrap: wrap; overflow: visible; }
  .credit-hub__tab { flex: 1 0 calc(33.333% - var(--hub-space-sm)); min-height: 40px; padding: var(--hub-space-sm) var(--hub-space-xs); text-align: center; }
  .credit-hub__form { grid-template-columns: 1fr; gap: var(--hub-space-sm); }
  .credit-hub__form label:not(.credit-hub__check) { margin-top: var(--hub-space-sm); }
  .credit-hub__kv { grid-template-columns: 110px 1fr; }
}
@container credit-hub (max-width: 380px) { .credit-hub__tab { flex-basis: calc(50% - var(--hub-space-sm)); } }
@media (prefers-reduced-motion: reduce) { .credit-hub *, .credit-hub *::before, .credit-hub *::after { transition: none !important; } }
.credit-hub__notification-center { position: fixed; z-index: 1500; right: 16px; top: 56px; width: min(360px, calc(100vw - 32px)); display: grid; gap: 8px; font: 14px/1.5 sans-serif; color: var(--dsw-alias-label-primary, #202124); }
.credit-hub__notification { padding: 14px; border: 1px solid var(--dsw-alias-border-l3, #e4e7ec); border-radius: 8px; background: var(--dsw-alias-bg-layer-2, #fff); }
.credit-hub__notification p { margin: 6px 0 12px; overflow-wrap: anywhere; }
.credit-hub__notification button { margin-right: 8px; padding: 4px 10px; border: 1px solid var(--dsw-alias-border-l3, #e4e7ec); border-radius: 6px; color: inherit; background: var(--dsw-alias-bg-base, #fff); cursor: pointer; font: inherit; }
`;

// client/transfer.jsx
var import_react = __toESM(require("react"), 1);
var MAX_INPUT = 4 * 1024 * 1024;
var MAX_DOWNLOAD = 2 * 1024 * 1024;
var utf8Size = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
async function readTransferFiles(files) {
  if (!files.length || files.length > 128) throw new Error("\u8BF7\u9009\u62E9 1\u2013128 \u4E2A JSON \u6216 ZIP \u6587\u4EF6\u3002");
  let total = 0;
  const results = [];
  for (const file of files) {
    total += file.size;
    if (total > MAX_INPUT) throw new Error("\u6587\u4EF6\u603B\u5927\u5C0F\u8D85\u51FA 4 MiB\uFF0C\u8BF7\u5206\u6279\u5BFC\u5165\u3002");
    if (!/\.(json|zip)$/i.test(file.name)) throw new Error("\u8BF7\u9009\u62E9 JSON \u6216 ZIP \u8D26\u53F7\u6587\u4EF6\u3002");
    if (/\.zip$/i.test(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 16384) binary += String.fromCharCode(...bytes.subarray(index, index + 16384));
      results.push({ format: "zip", content: btoa(binary) });
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const encoding = bytes[0] === 255 && bytes[1] === 254 ? "utf-16le" : bytes[0] === 254 && bytes[1] === 255 ? "utf-16be" : "utf-8";
      results.push({ format: "json", content: new TextDecoder(encoding, { fatal: true }).decode(bytes) });
    }
  }
  const body = { files: results };
  if (utf8Size({ ...body, duplicatePolicy: "replace" }) > MAX_INPUT - 4096) throw new Error("\u7F16\u7801\u540E\u7684\u8BF7\u6C42\u8D85\u51FA 4 MiB\uFF0C\u8BF7\u51CF\u5C11\u6587\u4EF6\u6216\u5206\u6279\u5BFC\u5165\u3002");
  return body;
}
function decodeAccountDownload(download) {
  if (!download || typeof download.filename !== "string" || !/^[a-zA-Z0-9_.-]+\.(json|zip)$/.test(download.filename) || download.filename.includes("..") || !["application/json; charset=utf-8", "application/json", "application/zip"].includes(download.mimeType)) throw new Error("\u5BFC\u51FA\u6587\u4EF6\u63CF\u8FF0\u4E0D\u6B63\u786E\uFF0C\u8BF7\u91CD\u65B0\u5BFC\u51FA\u3002");
  const content = download.contentBase64;
  if (typeof content !== "string" || !content.length || content.length > MAX_DOWNLOAD || content.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) throw new Error("\u5BFC\u51FA\u5185\u5BB9\u8D85\u9650\u6216\u683C\u5F0F\u4E0D\u6B63\u786E\uFF0C\u8BF7\u5206\u6279\u5BFC\u51FA\u3002");
  const binary = atob(content);
  if (btoa(binary) !== content) throw new Error("\u5BFC\u51FA\u5185\u5BB9\u6821\u9A8C\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u5BFC\u51FA\u3002");
  return { filename: download.filename, blob: new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type: download.mimeType }) };
}
function saveAccountDownload(download) {
  const { filename, blob } = decodeAccountDownload(download);
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3e4);
  }
  return filename;
}
function Action({ primary, children, ...props }) {
  return /* @__PURE__ */ import_react.default.createElement("button", { type: "button", className: `credit-hub__button${primary ? " credit-hub__button--primary" : ""}`, ...props }, children);
}
function AccountTransfer({ mode, accounts, busy, perform, onClose }) {
  const [input, setInput] = (0, import_react.useState)(null), [fileNames, setFileNames] = (0, import_react.useState)("");
  const [preview, setPreview] = (0, import_react.useState)(null), [policy, setPolicy] = (0, import_react.useState)("skip");
  const [selection, setSelection] = (0, import_react.useState)([]), [format, setFormat] = (0, import_react.useState)("json");
  const [message, setMessage] = (0, import_react.useState)(""), [error, setError] = (0, import_react.useState)(""), [reading, setReading] = (0, import_react.useState)(false);
  const generation = (0, import_react.useRef)(0), alive = (0, import_react.useRef)(true), fileInput = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  const isImport = mode === "import", workbuddy = accounts.filter((account) => account.platform === "workbuddy");
  const toggle = (id) => setSelection((values) => values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
  const selectFiles = async (event) => {
    const version = ++generation.current, files = [...event.target.files];
    setInput(null);
    setPreview(null);
    setMessage("");
    setError("");
    setReading(true);
    setFileNames(files.map((file) => file.name).join("\u3001"));
    if (!files.length) {
      setReading(false);
      return;
    }
    try {
      const body = await readTransferFiles(files);
      if (alive.current && version === generation.current) setInput(body);
    } catch (failure) {
      if (alive.current && version === generation.current) setError(failure.message);
    } finally {
      if (alive.current && version === generation.current) setReading(false);
    }
  };
  const previewImport = () => {
    const version = generation.current;
    setError("");
    setMessage("");
    setPreview(null);
    return perform("\u9884\u89C8\u5BFC\u5165\u8D26\u53F7", { method: "POST", path: "/admin/workbuddy/accounts/import/preview", body: input }, (response) => {
      if (alive.current && version === generation.current) setPreview(response.body);
    });
  };
  const commitImport = async () => {
    const version = generation.current;
    setMessage("");
    const ok = await perform("\u5BFC\u5165\u8D26\u53F7", { method: "POST", path: "/admin/workbuddy/accounts/import/commit", body: { ...input, duplicatePolicy: policy } }, (response) => {
      if (!alive.current || version !== generation.current) return;
      const body = response.body;
      setMessage(`\u5DF2\u65B0\u589E ${body.imported || 0} \u4E2A\uFF0C\u66FF\u6362 ${body.replaced || 0} \u4E2A\uFF0C\u8DF3\u8FC7 ${body.skipped || 0} \u4E2A\u8D26\u53F7\u3002`);
      setPreview(null);
      setInput(null);
      setFileNames("");
      if (fileInput.current) fileInput.current.value = "";
    });
    return ok;
  };
  const exportAccounts = () => {
    setMessage("");
    setError("");
    return perform("\u5BFC\u51FA\u8D26\u53F7", { method: "POST", path: "/admin/workbuddy/accounts/export", body: { format, accountIds: selection } }, (response) => {
      if (!alive.current) return;
      const filename = saveAccountDownload(response.body?.download);
      setMessage(`\u5DF2\u751F\u6210 ${response.body.accountCount} \u4E2A\u8D26\u53F7\u7684\u6587\u4EF6 ${filename}\uFF1B\u5DF2\u4EA4\u7ED9 DSH \u4E0B\u8F7D\uFF0C\u8BF7\u5728\u4E0B\u8F7D\u76EE\u5F55\u67E5\u770B\u3002`);
    });
  };
  return /* @__PURE__ */ import_react.default.createElement("section", { className: "credit-hub__transfer", "aria-label": isImport ? "\u5BFC\u5165\u8D26\u53F7\u6587\u4EF6" : "\u5BFC\u51FA\u8D26\u53F7\u6587\u4EF6" }, /* @__PURE__ */ import_react.default.createElement("h2", null, isImport ? "\u5BFC\u5165\u8D26\u53F7" : "\u5BFC\u51FA\u8D26\u53F7"), /* @__PURE__ */ import_react.default.createElement("p", { className: "credit-hub__muted" }, "\u652F\u6301 WorkBuddy \u56FD\u5185 / \u56FD\u9645\u8D26\u53F7\uFF1AJSON\u3001ZIP \u4E0E workbuddy-switch JSON\u3002\u6587\u4EF6\u5305\u542B\u767B\u5F55\u51ED\u636E\uFF1B\u53EA\u5728\u4F60\u9009\u62E9\u6587\u4EF6\u6216\u70B9\u51FB\u5BFC\u51FA\u65F6\u4F20\u8F93\uFF0C\u4E0D\u663E\u793A\u5728\u64CD\u4F5C\u8BB0\u5F55\u4E2D\u3002"), isImport ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("label", { className: "credit-hub__transfer-file" }, "\u9009\u62E9\u8D26\u53F7\u6587\u4EF6", /* @__PURE__ */ import_react.default.createElement("input", { ref: fileInput, type: "file", "aria-label": "\u9009\u62E9\u8D26\u53F7\u6587\u4EF6", accept: ".json,.zip,application/json,application/zip", multiple: true, disabled: busy || reading, onChange: selectFiles })), fileNames && /* @__PURE__ */ import_react.default.createElement("p", { className: "credit-hub__muted" }, reading ? "\u6B63\u5728\u8BFB\u53D6\u6587\u4EF6\u2026" : "\u5DF2\u9009\u62E9\uFF1A", fileNames), /* @__PURE__ */ import_react.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react.default.createElement("label", null, "\u91CD\u590D\u8D26\u53F7 ", /* @__PURE__ */ import_react.default.createElement("select", { "aria-label": "\u91CD\u590D\u8D26\u53F7\u5904\u7406", disabled: busy, value: policy, onChange: (event) => setPolicy(event.target.value) }, /* @__PURE__ */ import_react.default.createElement("option", { value: "skip" }, "\u8DF3\u8FC7\uFF0C\u4FDD\u7559\u5F53\u524D\u767B\u5F55\u6001"), /* @__PURE__ */ import_react.default.createElement("option", { value: "replace" }, "\u66FF\u6362\u767B\u5F55\u6001\uFF0C\u4FDD\u7559\u5F53\u524D\u5F00\u5173"))), /* @__PURE__ */ import_react.default.createElement(Action, { disabled: busy || reading || !input, onClick: previewImport }, "\u9884\u89C8\u5BFC\u5165"), /* @__PURE__ */ import_react.default.createElement(Action, { primary: true, disabled: busy || !input || !preview?.valid || reading, onClick: commitImport }, "\u786E\u8BA4\u5BFC\u5165"), /* @__PURE__ */ import_react.default.createElement(Action, { disabled: busy, onClick: onClose }, "\u5173\u95ED")), preview && /* @__PURE__ */ import_react.default.createElement("div", { className: "credit-hub__transfer-list", "aria-label": "\u5BFC\u5165\u9884\u89C8" }, /* @__PURE__ */ import_react.default.createElement("p", null, preview.valid ? "\u6821\u9A8C\u901A\u8FC7" : "\u6821\u9A8C\u5B58\u5728\u9519\u8BEF", " \xB7 ", preview.count || 0, " \u4E2A\u8D26\u53F7\uFF1B\u786E\u8BA4\u524D\u4E0D\u4F1A\u5199\u5165\u3002"), (preview.entries || []).map((entry, index) => /* @__PURE__ */ import_react.default.createElement("p", { key: index }, entry.label, " \xB7 ", entry.edition === "ai" ? "\u56FD\u9645" : "\u56FD\u5185", " \xB7 ", entry.duplicate ? "\u91CD\u590D\u8D26\u53F7" : "\u65B0\u8D26\u53F7", entry.expired ? " \xB7 \u767B\u5F55\u6001\u5DF2\u8FC7\u671F" : "", entry.hasRefreshToken === false ? " \xB7 \u4EC5\u6709\u8BBF\u95EE\u6001" : "")), (preview.errors || []).map((item, index) => /* @__PURE__ */ import_react.default.createElement("p", { key: `error-${index}`, role: "alert" }, item.index === null ? "" : `\u7B2C ${item.index + 1} \u4E2A\u8D26\u53F7\uFF1A`, item.message)))) : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react.default.createElement("label", null, "\u6587\u4EF6\u683C\u5F0F ", /* @__PURE__ */ import_react.default.createElement("select", { "aria-label": "\u5BFC\u51FA\u6587\u4EF6\u683C\u5F0F", disabled: busy, value: format, onChange: (event) => setFormat(event.target.value) }, /* @__PURE__ */ import_react.default.createElement("option", { value: "json" }, "JSON"), /* @__PURE__ */ import_react.default.createElement("option", { value: "zip" }, "ZIP\uFF08\u591A\u8D26\u53F7\uFF09"), /* @__PURE__ */ import_react.default.createElement("option", { value: "switch-json" }, "workbuddy-switch JSON"))), /* @__PURE__ */ import_react.default.createElement(Action, { disabled: busy || !workbuddy.length, onClick: () => setSelection(workbuddy.map((account) => account.id)) }, "\u5168\u9009 WorkBuddy"), /* @__PURE__ */ import_react.default.createElement(Action, { disabled: busy || !selection.length, onClick: () => setSelection([]) }, "\u6E05\u7A7A\u9009\u62E9")), /* @__PURE__ */ import_react.default.createElement("div", { className: "credit-hub__transfer-list" }, workbuddy.length ? workbuddy.map((account) => /* @__PURE__ */ import_react.default.createElement("label", { key: account.id, className: "credit-hub__check" }, /* @__PURE__ */ import_react.default.createElement("input", { type: "checkbox", "aria-label": `\u5BFC\u51FA ${account.label}`, checked: selection.includes(account.id), disabled: busy, onChange: () => toggle(account.id) }), account.label)) : /* @__PURE__ */ import_react.default.createElement("p", null, "\u5C1A\u65E0 WorkBuddy \u8D26\u53F7\uFF0C\u8BF7\u5148\u5BFC\u5165\u6216\u6DFB\u52A0\u3002")), /* @__PURE__ */ import_react.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react.default.createElement(Action, { primary: true, disabled: busy || !selection.length, onClick: exportAccounts }, "\u5BFC\u51FA\u5DF2\u9009\u8D26\u53F7\uFF08", selection.length, "\uFF09"), /* @__PURE__ */ import_react.default.createElement(Action, { disabled: busy, onClick: onClose }, "\u5173\u95ED"))), error && /* @__PURE__ */ import_react.default.createElement("p", { className: "credit-hub__transfer-status", role: "alert" }, error), message && /* @__PURE__ */ import_react.default.createElement("p", { className: "credit-hub__transfer-status", role: "status" }, message));
}

// client/notifications.js
function installNativeNotifications({ api, onOpen, document: doc = globalThis.document, setInterval: repeat = setInterval, clearInterval: cancel = clearInterval }) {
  if (!doc?.body) return () => {
  };
  let closed = false, flight = false;
  const seen = /* @__PURE__ */ new Set(), timeouts = /* @__PURE__ */ new Set(), center = doc.createElement("aside");
  center.className = "credit-hub__notification-center";
  center.setAttribute("aria-label", "\u79EF\u5206\u4E2D\u67A2\u901A\u77E5");
  doc.body.append(center);
  const visible = () => doc.hidden !== true && doc.visibilityState !== "hidden" && (typeof doc.hasFocus !== "function" || doc.hasFocus());
  async function poll() {
    if (closed || flight || !visible()) return;
    flight = true;
    try {
      const response = await api.request({ method: "GET", path: "/hub/events/pending" });
      if (closed || !visible()) return;
      const acknowledgements = [];
      for (const item of response.body?.items ?? []) {
        if (seen.has(item.deliveryId)) {
          acknowledgements.push(item.deliveryId);
          continue;
        }
        if (center.children.length >= 5) break;
        const event = item.event ?? {}, card = doc.createElement("section"), title = doc.createElement("strong"), copy = doc.createElement("p"), open = doc.createElement("button"), close = doc.createElement("button");
        card.className = "credit-hub__notification";
        card.setAttribute("role", event.severity === "error" ? "alert" : "status");
        title.textContent = event.title || "\u79EF\u5206\u4E2D\u67A2\u4E8B\u4EF6";
        const data = event.data ?? {};
        const detail = event.type === "update.available" ? `\u7248\u672C ${data.currentVersion || "\u5F53\u524D"} \u2192 ${data.latestVersion || "\u65B0\u7248\u672C"}\uFF0C\u8BF7\u6253\u5F00\u63D2\u4EF6\u5E02\u573A\u68C0\u67E5\u66F4\u65B0\u3002` : event.type === "credential.expiring" ? `\u51ED\u636E\u5C06\u5728 ${Number.isFinite(data.remainingDays) ? data.remainingDays.toFixed(1) : "\u82E5\u5E72"} \u5929\u5185\u8FC7\u671F\u3002` : event.type === "balance.low" ? `\u4F59\u989D ${data.value ?? "\u2014"} ${data.unit || ""} \u5DF2\u8DCC\u7834\u8BBE\u7F6E\u9608\u503C\u3002` : event.type === "request.failure_streak" ? `\u8FDE\u7EED ${data.streak || 3} \u6B21\u8BF7\u6C42\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u8D26\u6237\u4E0E\u4E0A\u6E38\u72B6\u6001\u3002` : event.type === "relay.triggered" ? "\u5F53\u524D\u8BF7\u6C42\u5DF2\u8F6C\u5165\u63A5\u529B\u5019\u9009\u3002" : "\u7B7E\u5230\u5931\u8D25\uFF0C\u8BF7\u5728\u4ECA\u65E5\u672A\u7B7E\u5230\u5217\u8868\u6838\u5BF9\u5E76\u624B\u52A8\u8865\u7B7E\u3002";
        copy.textContent = (event.accountLabel ? event.accountLabel + " \xB7 " : "") + detail;
        open.type = "button";
        open.textContent = "\u6253\u5F00\u79EF\u5206\u4E2D\u67A2";
        open.onclick = () => onOpen?.();
        close.type = "button";
        close.textContent = "\u5173\u95ED";
        close.onclick = () => card.remove();
        card.append(title, copy, open, close);
        center.append(card);
        seen.add(item.deliveryId);
        acknowledgements.push(item.deliveryId);
        const expiry = globalThis.setTimeout?.(() => {
          card.remove();
          timeouts.delete(expiry);
        }, 15e3);
        if (expiry) timeouts.add(expiry);
      }
      if (acknowledgements.length && !closed) await api.request({ method: "POST", path: "/hub/events/ack", body: { deliveryIds: acknowledgements } });
    } catch {
    } finally {
      flight = false;
    }
  }
  const resume = () => {
    if (visible()) void poll();
  };
  doc.addEventListener?.("visibilitychange", resume);
  doc.defaultView?.addEventListener?.("focus", resume);
  const timer = repeat(() => void poll(), 3e3);
  timer?.unref?.();
  return () => {
    closed = true;
    cancel(timer);
    doc.removeEventListener?.("visibilitychange", resume);
    doc.defaultView?.removeEventListener?.("focus", resume);
    for (const timer2 of timeouts) globalThis.clearTimeout?.(timer2);
    center.remove();
  };
}

// client/operations.jsx
var import_react2 = __toESM(require("react"), 1);
var list = (value) => Array.isArray(value) ? value : [];
var object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
var show = (value, fallback = "\u2014") => ["string", "number"].includes(typeof value) && value !== "" ? String(value) : fallback;
var number = (value) => Number.isFinite(value) ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value) : "\u2014";
var when = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(+date) ? date.toLocaleString("zh-CN", { hour12: false }) : "\u5C1A\u65E0\u8BB0\u5F55";
};
var operations = (snapshot) => object(snapshot.operations);
var settingsFor = (snapshot, key) => object(operations(snapshot).settings?.[key] || operations(snapshot)[key]?.settings);
var notificationEvents = [
  ["checkin.failed", "\u7B7E\u5230\u5931\u8D25"],
  ["credential.expiring", "\u51ED\u636E\u5373\u5C06\u8FC7\u671F"],
  ["balance.low", "\u4F59\u989D\u4F4E\u4E8E\u9608\u503C"],
  ["relay.triggered", "\u63A5\u529B\u89E6\u53D1"],
  ["request.failure_streak", "\u8FDE\u7EED 3 \u6B21\u5931\u8D25"],
  ["update.available", "\u53D1\u73B0\u65B0\u7248\u672C"]
];
function createOperationGuard(initialScope = "") {
  let scope = initialScope, generation = 0, alive = true;
  return {
    select(next) {
      if (next !== scope || !alive) generation++;
      scope = next;
      alive = true;
    },
    change() {
      generation++;
    },
    capture() {
      const version = generation;
      return () => alive && version === generation;
    },
    dispose() {
      alive = false;
      generation++;
    }
  };
}
function useOperationGuard() {
  const ref = (0, import_react2.useRef)(null);
  if (!ref.current) ref.current = createOperationGuard();
  (0, import_react2.useEffect)(() => {
    ref.current.select("");
    return () => ref.current.dispose();
  }, []);
  return ref.current;
}
function useDraft(incoming) {
  const signature = JSON.stringify(incoming), [draft, setDraft] = (0, import_react2.useState)(() => incoming), [dirty, setDirty] = (0, import_react2.useState)(false);
  const guard = useOperationGuard();
  (0, import_react2.useEffect)(() => {
    if (!dirty) setDraft(incoming);
  }, [signature]);
  const update = (patch) => {
    guard.change();
    setDirty(true);
    setDraft((value) => ({ ...value, ...patch }));
  };
  return { draft, dirty, update, guard, saved: (patch) => {
    setDirty(false);
    if (patch) setDraft((value) => ({ ...value, ...patch }));
  } };
}
function Action2({ primary, children, ...props }) {
  return /* @__PURE__ */ import_react2.default.createElement("button", { type: "button", className: `credit-hub__button${primary ? " credit-hub__button--primary" : ""}`, ...props }, children);
}
function Check({ children, checked, disabled, onChange, label }) {
  return /* @__PURE__ */ import_react2.default.createElement("label", { className: "credit-hub__check" }, /* @__PURE__ */ import_react2.default.createElement("input", { type: "checkbox", "aria-label": label, checked: !!checked, disabled, onChange: (event) => onChange(event.target.checked) }), children);
}
function Rows({ columns, rows, empty, children, label }) {
  return rows.length ? /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__table-wrap", role: "region", "aria-label": label, tabIndex: 0 }, /* @__PURE__ */ import_react2.default.createElement("table", null, /* @__PURE__ */ import_react2.default.createElement("thead", null, /* @__PURE__ */ import_react2.default.createElement("tr", null, columns.map((column) => /* @__PURE__ */ import_react2.default.createElement("th", { scope: "col", key: column }, column)))), /* @__PURE__ */ import_react2.default.createElement("tbody", null, children))) : /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__notice" }, /* @__PURE__ */ import_react2.default.createElement("p", { className: "credit-hub__muted" }, empty));
}
function Field({ label, children, id }) {
  return /* @__PURE__ */ import_react2.default.createElement(import_react2.default.Fragment, null, /* @__PURE__ */ import_react2.default.createElement("label", { htmlFor: id }, label), children);
}
function Feedback({ children, error }) {
  return children ? /* @__PURE__ */ import_react2.default.createElement("p", { role: error ? "alert" : "status", className: `credit-hub__transfer-status${error ? " credit-hub__notice--error" : ""}` }, children) : null;
}
var post = (path, body = {}) => ({ method: "POST", path, body });
var discoveryState = (row) => ({ connected: "\u5DF2\u63A5\u5165", added: "\u5DF2\u63A5\u5165", imported: "\u5DF2\u63A5\u5165", changed: "\u5DF2\u66F4\u65B0\u63A5\u5165", unchanged: "\u5DF2\u63A5\u5165\uFF0C\u65E0\u53D8\u5316", existing: "\u5DF2\u63A5\u5165", snapshot_required: "\u5F85\u767B\u5F55\u6001", login_required: "\u7B49\u5F85\u5BA2\u6237\u7AEF\u767B\u5F55", not_logged_in: "\u7B49\u5F85\u5BA2\u6237\u7AEF\u767B\u5F55", missing: "\u5C1A\u672A\u53D1\u73B0", installed: "\u5DF2\u53D1\u73B0\uFF0C\u5C1A\u672A\u63A5\u5165", not_installed: "\u5C1A\u672A\u5B89\u88C5", needs_setup: "\u5F85\u72EC\u7ACB\u914D\u7F6E", unsupported: "\u5F85\u72EC\u7ACB\u914D\u7F6E", error: "\u63A5\u5165\u5931\u8D25", failed: "\u63A5\u5165\u5931\u8D25", detected: "\u5DF2\u53D1\u73B0", ready: "\u53EF\u63A5\u5165" })[row.status] || show(row.status, row.installed ? "\u5DF2\u53D1\u73B0" : "\u5C1A\u672A\u53D1\u73B0");
function DiscoveryPanel({ snapshot, busy, perform }) {
  const state = object(operations(snapshot).discovery), current = settingsFor(snapshot, "discovery");
  const form = useDraft({ enabled: current.enabled ?? false, autoEnableRoutes: current.autoEnableRoutes ?? true, fetchModels: current.fetchModels ?? true, intervalSeconds: current.intervalSeconds ?? 60 });
  const rows = list(state.candidates), id = (0, import_react2.useId)();
  const save = () => {
    const fresh = form.guard.capture();
    return perform("\u4FDD\u5B58 Agent \u81EA\u52A8\u53D1\u73B0", post("/hub/operations", { discovery: { ...form.draft, intervalSeconds: Number(form.draft.intervalSeconds) } }), () => {
      if (fresh()) form.saved();
    });
  };
  return /* @__PURE__ */ import_react2.default.createElement("section", { "aria-label": "Agent \u81EA\u52A8\u53D1\u73B0\u4E0E\u63A5\u5165" }, /* @__PURE__ */ import_react2.default.createElement("h2", null, "\u540E\u88C5 Agent \u81EA\u52A8\u63A5\u5165"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "credit-hub__muted" }, "\u5B9A\u671F\u68C0\u67E5\u53D7\u652F\u6301\u5BA2\u6237\u7AEF\u3002\u53D1\u73B0\u5DF2\u767B\u5F55\u7684\u8D26\u53F7\u540E\uFF0C\u5C06\u51ED\u636E\u590D\u5236\u5230\u63D2\u4EF6\u72EC\u7ACB\u76EE\u5F55\u5E76\u5EFA\u7ACB\u63A5\u5165\uFF1B\u539F\u5BA2\u6237\u7AEF\u6587\u4EF6\u4FDD\u6301\u53EA\u8BFB\u3002\u5C1A\u672A\u767B\u5F55\u6216\u9700\u8981\u72EC\u7ACB\u914D\u7F6E\u7684\u5BA2\u6237\u7AEF\u4F1A\u7559\u5728\u4E0B\u8868\u3002"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__form" }, /* @__PURE__ */ import_react2.default.createElement("span", null, "\u53D1\u73B0\u65B9\u5F0F"), /* @__PURE__ */ import_react2.default.createElement(Check, { checked: form.draft.enabled, disabled: busy, onChange: (enabled) => form.update({ enabled }) }, "\u542F\u7528\u540E\u53F0\u81EA\u52A8\u53D1\u73B0"), /* @__PURE__ */ import_react2.default.createElement("span", null, "\u6A21\u578B\u76EE\u5F55"), /* @__PURE__ */ import_react2.default.createElement(Check, { checked: form.draft.fetchModels, disabled: busy, onChange: (fetchModels) => form.update({ fetchModels }) }, "\u63A5\u5165\u540E\u83B7\u53D6\u4E0A\u6E38\u6A21\u578B\u76EE\u5F55"), /* @__PURE__ */ import_react2.default.createElement("span", null, "\u6A21\u578B\u8DEF\u7531"), /* @__PURE__ */ import_react2.default.createElement(Check, { checked: form.draft.autoEnableRoutes, disabled: busy, onChange: (autoEnableRoutes) => form.update({ autoEnableRoutes }) }, "\u81EA\u52A8\u542F\u7528\u65B0\u53D1\u73B0\u7684\u6A21\u578B\u8DEF\u7531"), /* @__PURE__ */ import_react2.default.createElement(Field, { label: "\u68C0\u67E5\u95F4\u9694\uFF08\u79D2\uFF09", id: `${id}-interval` }, /* @__PURE__ */ import_react2.default.createElement("input", { id: `${id}-interval`, type: "number", min: "10", max: "86400", value: form.draft.intervalSeconds, disabled: busy, onChange: (event) => form.update({ intervalSeconds: event.target.value }) })), /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__wide credit-hub__toolbar" }, /* @__PURE__ */ import_react2.default.createElement(Action2, { primary: true, disabled: busy || !form.dirty || !Number.isInteger(Number(form.draft.intervalSeconds)) || Number(form.draft.intervalSeconds) < 10 || Number(form.draft.intervalSeconds) > 86400, onClick: save }, "\u4FDD\u5B58\u53D1\u73B0\u8BBE\u7F6E"), /* @__PURE__ */ import_react2.default.createElement(Action2, { disabled: busy || state.scanning, onClick: () => perform("\u626B\u63CF\u5E76\u63A5\u5165\u65B0 Agent", post("/hub/discovery", { connect: true })) }, state.scanning ? "\u6B63\u5728\u626B\u63CF\u63A5\u5165\u2026" : "\u7ACB\u5373\u626B\u63CF\u5E76\u63A5\u5165"))), /* @__PURE__ */ import_react2.default.createElement("p", { className: "credit-hub__muted" }, state.running ? "\u540E\u53F0\u53D1\u73B0\u8FD0\u884C\u4E2D" : "\u540E\u53F0\u53D1\u73B0\u5C1A\u672A\u8FD0\u884C", " \xB7 \u6700\u8FD1\u68C0\u67E5\uFF1A", when(state.scannedAt || state.checkedAt), "\u3002\u63A5\u5165\u72B6\u6001\u4E0E\u6A21\u578B\u76EE\u5F55\u6838\u9A8C\u5206\u5F00\u663E\u793A\uFF1B\u6CA1\u6709\u6709\u6548\u767B\u5F55\u6001\u65F6\uFF0C\u4E0D\u663E\u793A\u4E3A\u5DF2\u63A5\u5165\u3002"), /* @__PURE__ */ import_react2.default.createElement(Rows, { columns: ["\u5BA2\u6237\u7AEF / \u5E73\u53F0", "\u63A5\u5165\u72B6\u6001", "\u6A21\u578B\u8DEF\u7531", "\u8BF4\u660E"], rows, label: "Agent \u53D1\u73B0\u7ED3\u679C", empty: "\u5C1A\u65E0\u53D1\u73B0\u8BB0\u5F55\u3002\u5F00\u542F\u540E\u53F0\u53D1\u73B0\u6216\u70B9\u51FB\u201C\u7ACB\u5373\u626B\u63CF\u5E76\u63A5\u5165\u201D\uFF0C\u540E\u88C5\u5BA2\u6237\u7AEF\u4F1A\u5728\u4E0B\u4E00\u8F6E\u68C0\u67E5\u3002" }, rows.map((row, index) => /* @__PURE__ */ import_react2.default.createElement("tr", { key: row.id || `${row.platform}-${index}` }, /* @__PURE__ */ import_react2.default.createElement("td", null, /* @__PURE__ */ import_react2.default.createElement("span", { className: "credit-hub__cell-main" }, show(row.label, row.platform || "\u5BA2\u6237\u7AEF")), /* @__PURE__ */ import_react2.default.createElement("span", { className: "credit-hub__cell-detail" }, show(row.platform))), /* @__PURE__ */ import_react2.default.createElement("td", null, discoveryState(row), row.accountId && /* @__PURE__ */ import_react2.default.createElement("span", { className: "credit-hub__cell-detail" }, "\u5DF2\u5EFA\u7ACB\u72EC\u7ACB\u8D26\u53F7")), /* @__PURE__ */ import_react2.default.createElement("td", null, Number.isFinite(row.routeCount) ? `${number(row.routeCount)} \u6761` : "\u5C1A\u65E0\u76EE\u5F55", /* @__PURE__ */ import_react2.default.createElement("span", { className: "credit-hub__cell-detail" }, { ready: "\u76EE\u5F55\u5DF2\u66F4\u65B0", cached: "\u4F7F\u7528\u7F13\u5B58\u76EE\u5F55", error: "\u76EE\u5F55\u66F4\u65B0\u5931\u8D25", failed: "\u76EE\u5F55\u66F4\u65B0\u5931\u8D25", disabled: "\u76EE\u5F55\u83B7\u53D6\u5DF2\u5173\u95ED", needs_setup: "\u76EE\u5F55\u9700\u8981\u914D\u7F6E", pending: "\u7B49\u5F85\u76EE\u5F55\u66F4\u65B0", not_requested: "\u5C1A\u672A\u66F4\u65B0\u76EE\u5F55" }[row.catalogStatus] || show(row.catalogStatus, "\u76EE\u5F55\u672A\u6838\u9A8C"))), /* @__PURE__ */ import_react2.default.createElement("td", null, /* @__PURE__ */ import_react2.default.createElement("span", { className: "credit-hub__cell-detail" }, show(row.reason || row.catalogReason, "\u2014")))))));
}
function forecastHours(value) {
  if (!Number.isFinite(value) || value < 0) return "\u6570\u636E\u4E0D\u8DB3";
  if (value === 0) return "\u5DF2\u5230\u8017\u5C3D\u7EBF";
  if (value < 1) return `\u7EA6 ${Math.max(1, Math.round(value * 60))} \u5206\u949F`;
  return `\u7EA6 ${number(value)} \u5C0F\u65F6`;
}
function reserveSuggestionText(row) {
  if (!Number.isFinite(row.reservePercent)) return Number.isFinite(row.reserveCredits) ? `\u5EFA\u8BAE\u9884\u7559 ${number(row.reserveCredits)} ${show(row.unit, "\u989D\u5EA6")}\uFF1B\u603B\u989D\u5EA6\u672A\u77E5\uFF0C\u6682\u4E0D\u6362\u7B97\u767E\u5206\u6BD4` : "\u6837\u672C\u4E0D\u8DB3\u6216\u8865\u5145\u65F6\u95F4\u672A\u77E5\uFF0C\u6682\u4E0D\u5EFA\u8BAE\u767E\u5206\u6BD4";
  return `\u5EFA\u8BAE\u9884\u7559 ${number(row.reservePercent)}%${Number.isFinite(row.reserveCredits) ? `\uFF08${number(row.reserveCredits)} ${show(row.unit, "\u989D\u5EA6")}\uFF09` : ""}${row.reserveReason === "engine_reserve_percent_limit_50" ? "\uFF1B\u8D85\u8FC7\u63A5\u529B\u5F15\u64CE 50% \u4E0A\u9650" : row.canApplyReservePercent === false ? "\uFF1B\u4EC5\u4F9B\u53C2\u8003\uFF0C\u4E0D\u9002\u7528\u4E8E\u79EF\u5206\u63A5\u529B\u6BD4\u4F8B" : ""}`;
}
function coverageText(value) {
  if (typeof value === "string") return value;
  if (Number.isFinite(value)) return `${number(value)} \u5929\u89C2\u6D4B`;
  const coverage = object(value), parts = [];
  if (Number.isFinite(coverage.days ?? coverage.observedDays)) parts.push(`${number(coverage.days ?? coverage.observedDays)} \u5929\u89C2\u6D4B`);
  if (Number.isFinite(coverage.observedHours ?? coverage.measuredHours)) parts.push(`${number(coverage.observedHours ?? coverage.measuredHours)} \u5C0F\u65F6\u89C2\u6D4B`);
  if (Number.isFinite(coverage.measuredRows)) parts.push(`${number(coverage.measuredRows)} \u4E2A\u6D4B\u91CF`);
  if (Number.isFinite(coverage.missingRows) && coverage.missingRows > 0) parts.push(`${number(coverage.missingRows)} \u6761\u8BA1\u8D39\u7F3A\u5931`);
  if (Number.isFinite(coverage.ratio)) parts.push(`7 \u5929\u8986\u76D6 ${number(coverage.ratio * 100)}%`);
  if (Number.isFinite(coverage.samples)) parts.push(`${number(coverage.samples)} \u4E2A\u6837\u672C`);
  return parts.join(" / ") || "\u89C2\u6D4B\u8986\u76D6\u672A\u77E5";
}
function renewalInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(+date)) return "";
  const local = new Date(+date - date.getTimezoneOffset() * 6e4);
  return local.toISOString().slice(0, 16);
}
function buildForecastPatch(draft) {
  const safetyMultiplier = Number(draft.safetyMultiplier);
  if (!Number.isFinite(safetyMultiplier) || safetyMultiplier < 1 || safetyMultiplier > 5) throw new Error("\u9884\u6D4B\u5B89\u5168\u7CFB\u6570\u5E94\u4E3A 1\u20135\u3002");
  const renewAtByAccount = {}, keys = Array.isArray(draft.changedRenewalIds) ? draft.changedRenewalIds : Object.keys(object(draft.renewAtByAccount));
  for (const accountId of keys) {
    if (!/^account-[a-f0-9]{12}$/.test(accountId)) throw new Error("\u8D26\u53F7\u5F15\u7528\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u672C\u5730\u5FEB\u7167\u540E\u91CD\u65B0\u9009\u62E9\u8865\u5145\u65F6\u95F4\u3002");
    const value = draft.renewAtByAccount?.[accountId];
    if (value === null || value === "") {
      renewAtByAccount[accountId] = null;
      continue;
    }
    const date = new Date(value);
    if (!Number.isFinite(+date)) throw new Error("\u8865\u5145\u65F6\u95F4\u683C\u5F0F\u4E0D\u6B63\u786E\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u65E5\u671F\u4E0E\u65F6\u523B\u3002");
    renewAtByAccount[accountId] = date.toISOString();
  }
  return { forecast: { safetyMultiplier, renewAtByAccount } };
}
function ForecastPanel({ snapshot, busy, perform }) {
  const forecast = object(operations(snapshot).forecast), rows = list(forecast.accounts), current = settingsFor(snapshot, "forecast"), id = (0, import_react2.useId)();
  const form = useDraft({ safetyMultiplier: current.safetyMultiplier ?? 1.25, renewAtByAccount: object(current.renewAtByAccount), changedRenewalIds: [] }), [error, setError] = (0, import_react2.useState)("");
  const editRenewal = (accountId, value) => {
    setError("");
    form.update({ renewAtByAccount: { ...form.draft.renewAtByAccount, [accountId]: value || null }, changedRenewalIds: [.../* @__PURE__ */ new Set([...form.draft.changedRenewalIds, accountId])] });
  };
  const save = () => {
    setError("");
    let body;
    try {
      body = buildForecastPatch(form.draft);
    } catch (failure) {
      setError(failure.message);
      return;
    }
    const fresh = form.guard.capture();
    return perform("\u4FDD\u5B58\u989D\u5EA6\u9884\u6D4B\u53C2\u6570", post("/hub/operations", body), () => {
      if (fresh()) form.saved({ changedRenewalIds: [] });
    });
  };
  const assumptions = Array.isArray(forecast.assumptions) ? forecast.assumptions.filter((item) => typeof item === "string") : typeof forecast.assumptions === "string" ? [forecast.assumptions] : [];
  return /* @__PURE__ */ import_react2.default.createElement("section", { "aria-label": "\u989D\u5EA6\u6D88\u8017\u9884\u6D4B" }, /* @__PURE__ */ import_react2.default.createElement("h2", null, "\u989D\u5EA6 burn-down \u4E0E\u9884\u7559\u5EFA\u8BAE"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "credit-hub__muted" }, "\u6309\u6700\u8FD1 7 \u5929\u540C\u5355\u4F4D\u7684\u5B9E\u6D4B\u6D88\u8017\u4F30\u7B97\uFF0C\u9884\u6D4B\u4E0D\u662F\u5B98\u65B9\u8D26\u5355\u3002\u7F3A\u5C11\u4F59\u989D\u3001\u603B\u989D\u5EA6\u6216\u6709\u6548\u6D88\u8017\u6837\u672C\u65F6\u4FDD\u7559\u201C\u6570\u636E\u4E0D\u8DB3\u201D\uFF0C\u4E0D\u4EE5 Token \u6570\u76F4\u63A5\u66FF\u4EE3\u79EF\u5206\u3002"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react2.default.createElement(Action2, { disabled: busy, onClick: () => perform("\u91CD\u7B97\u672C\u5730\u989D\u5EA6\u9884\u6D4B", { method: "GET", path: "/hub/forecast" }) }, "\u91CD\u7B97\u672C\u5730\u9884\u6D4B"), /* @__PURE__ */ import_react2.default.createElement("span", { className: "credit-hub__muted" }, "\u4E0D\u5237\u65B0\u4E0A\u6E38\u4F59\u989D")), /* @__PURE__ */ import_react2.default.createElement("details", null, /* @__PURE__ */ import_react2.default.createElement("summary", null, "\u9884\u6D4B\u53C2\u6570\u4E0E\u7EED\u8D39\u65F6\u95F4"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "credit-hub__muted" }, "\u4EE5\u4E0B\u65F6\u95F4\u4F7F\u7528\u672C\u673A\u65F6\u533A ", Intl.DateTimeFormat().resolvedOptions().timeZone || "\u672C\u673A\u65F6\u95F4", "\u3002\u9884\u7559\u91CF = \u6BCF\u5C0F\u65F6\u6D88\u8017 \xD7 \u8DDD\u4E0B\u6B21\u8865\u5145\u5C0F\u65F6 \xD7 \u5B89\u5168\u7CFB\u6570\uFF1B\u540E\u7AEF\u53D6\u672A\u6765\u7EED\u8D39\u4E0E\u53EF\u7528\u7B7E\u5230\u8BA1\u5212\u4E2D\u7684\u8F83\u65E9\u65F6\u523B\u3002"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__form" }, /* @__PURE__ */ import_react2.default.createElement(Field, { label: "\u9884\u6D4B\u5B89\u5168\u7CFB\u6570", id: `${id}-safety` }, /* @__PURE__ */ import_react2.default.createElement("input", { id: `${id}-safety`, type: "number", min: "1", max: "5", step: "0.05", value: form.draft.safetyMultiplier, disabled: busy, onChange: (event) => form.update({ safetyMultiplier: event.target.value }) }))), /* @__PURE__ */ import_react2.default.createElement(Rows, { columns: ["\u8D26\u53F7", "\u4E0B\u6B21\u7EED\u8D39 / \u8865\u5145\u65F6\u95F4\uFF08\u672C\u673A\uFF09", "\u64CD\u4F5C"], rows, label: "\u9010\u8D26\u53F7\u4E0B\u6B21\u8865\u5145\u65F6\u95F4", empty: "\u63A5\u5165\u8D26\u53F7\u540E\u53EF\u4E3A\u6BCF\u4E2A\u8D26\u53F7\u8BBE\u7F6E\u4E0B\u6B21\u7EED\u8D39\u65F6\u95F4\u3002" }, rows.map((row, index) => /* @__PURE__ */ import_react2.default.createElement("tr", { key: row.accountId || index }, /* @__PURE__ */ import_react2.default.createElement("td", null, show(row.label, "\u8D26\u53F7")), /* @__PURE__ */ import_react2.default.createElement("td", null, /* @__PURE__ */ import_react2.default.createElement("input", { type: "datetime-local", "aria-label": `${show(row.label, "\u8D26\u53F7")} \xB7 \u4E0B\u6B21\u7EED\u8D39\u6216\u8865\u5145\u65F6\u95F4`, disabled: busy || !/^account-[a-f0-9]{12}$/.test(row.accountId || ""), value: renewalInputValue(form.draft.renewAtByAccount[row.accountId]), onChange: (event) => editRenewal(row.accountId, event.target.value) })), /* @__PURE__ */ import_react2.default.createElement("td", null, /* @__PURE__ */ import_react2.default.createElement(Action2, { disabled: busy || !form.draft.renewAtByAccount[row.accountId], onClick: () => editRenewal(row.accountId, null) }, "\u6E05\u9664\u7EED\u8D39\u65F6\u95F4"))))), /* @__PURE__ */ import_react2.default.createElement("p", { className: "credit-hub__muted" }, "\u7559\u7A7A\u6216\u6E05\u9664\u540E\u53EA\u4F7F\u7528\u53EF\u7528\u7B7E\u5230\u8BA1\u5212\uFF1B\u5DF2\u8FC7\u7684\u65F6\u95F4\u4E0D\u8BA1\u5165\u9884\u6D4B\u3002\u4FDD\u5B58\u53EA\u5F71\u54CD\u989D\u5EA6\u9884\u6D4B\uFF0C\u4E0D\u542F\u52A8\u7B7E\u5230\u3001\u4E0D\u4FEE\u6539\u8D26\u53F7\uFF0C\u4E5F\u4E0D\u81EA\u52A8\u5957\u7528\u5168\u5C40\u63A5\u529B\u9608\u503C\u3002"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react2.default.createElement(Action2, { primary: true, disabled: busy || !form.dirty, onClick: save }, "\u4FDD\u5B58\u9884\u6D4B\u53C2\u6570")), /* @__PURE__ */ import_react2.default.createElement(Feedback, { error: true }, error)), /* @__PURE__ */ import_react2.default.createElement(Rows, { columns: ["\u8D26\u6237 / \u6570\u636E\u8986\u76D6", "\u6D88\u8017\u901F\u5EA6", "\u9884\u8BA1\u8017\u5C3D", "\u4E0B\u6B21\u8865\u5145", "\u63A5\u529B\u9884\u7559\u5EFA\u8BAE"], rows, label: "\u9010\u8D26\u53F7\u989D\u5EA6\u9884\u6D4B", empty: "\u5C1A\u65E0\u53EF\u9884\u6D4B\u8D26\u53F7\u3002\u5148\u63A5\u5165\u8D26\u53F7\uFF0C\u518D\u79EF\u7D2F\u540C\u5355\u4F4D\u4F59\u989D\u4E0E\u6D88\u8017\u8BB0\u5F55\uFF1B\u9884\u6D4B\u53EA\u8BFB\u53D6\u672C\u5730\u6D4B\u91CF\u3002" }, rows.map((row, index) => /* @__PURE__ */ import_react2.default.createElement("tr", { key: row.accountId || index }, /* @__PURE__ */ import_react2.default.createElement("td", null, /* @__PURE__ */ import_react2.default.createElement("span", { className: "credit-hub__cell-main" }, show(row.label, "\u8D26\u53F7")), /* @__PURE__ */ import_react2.default.createElement("span", { className: "credit-hub__cell-detail" }, coverageText(row.coverage), " \xB7 ", { upstream_credits: "\u4E0A\u6E38\u8BA1\u8D39\u79EF\u5206", upstream_cost: "\u4E0A\u6E38\u8BA1\u8D39\u8D39\u7528", balance_net_decrease: "\u4F59\u989D\u51C0\u51CF\u5C11" }[row.source] || "\u6765\u6E90\u5F85\u6838\u9A8C")), /* @__PURE__ */ import_react2.default.createElement("td", null, Number.isFinite(row.burnRatePerHour) ? `${number(row.burnRatePerHour)} ${show(row.unit, "\u989D\u5EA6")} / \u5C0F\u65F6` : "\u6570\u636E\u4E0D\u8DB3"), /* @__PURE__ */ import_react2.default.createElement("td", null, forecastHours(row.estimatedHours), /* @__PURE__ */ import_react2.default.createElement("span", { className: "credit-hub__cell-detail" }, row.exhaustAt ? when(row.exhaustAt) : { no_measured_burn: "\u89C2\u6D4B\u671F\u672A\u6D4B\u5F97\u6D88\u8017\uFF0C\u4E0D\u4EE3\u8868\u65E0\u9650\u989D\u5EA6", insufficient_data: "\u7B49\u5F85\u66F4\u591A\u6709\u6548\u6837\u672C", balance_stale: "\u4F59\u989D\u5DF2\u8FC7\u65F6\uFF0C\u8BF7\u624B\u52A8\u5237\u65B0", balance_expired: "\u5DF2\u8FC7\u989D\u5EA6\u6709\u6548\u671F", missing_balance: "\u7F3A\u5C11\u540C\u5355\u4F4D\u4F59\u989D" }[row.status] || "\u5C1A\u65E0\u53EF\u9760\u8017\u5C3D\u65F6\u95F4")), /* @__PURE__ */ import_react2.default.createElement("td", null, row.nextReplenishAt ? when(row.nextReplenishAt) : "\u672A\u8BBE\u7F6E\u7B7E\u5230 / \u7EED\u8D39\u65F6\u95F4"), /* @__PURE__ */ import_react2.default.createElement("td", null, reserveSuggestionText(row), /* @__PURE__ */ import_react2.default.createElement("span", { className: "credit-hub__cell-detail" }, Number.isFinite(row.reserveSafetyFactor) ? `\u6D88\u8017\u901F\u5EA6 \xD7 \u8DDD\u8865\u5145\u5C0F\u65F6 \xD7 ${number(row.reserveSafetyFactor)}\u3002` : "", "\u4EC5\u4E3A\u8BE5\u8D26\u53F7\u7684\u4F30\u7B97\uFF0C\u4E0D\u81EA\u52A8\u8986\u76D6\u5168\u5C40\u63A5\u529B\u7B56\u7565\u3002"), list(row.assumptions).length > 0 && /* @__PURE__ */ import_react2.default.createElement("details", null, /* @__PURE__ */ import_react2.default.createElement("summary", null, "\u6B64\u8D26\u53F7\u9884\u6D4B\u4F9D\u636E"), /* @__PURE__ */ import_react2.default.createElement("ul", null, row.assumptions.filter((item) => typeof item === "string").map((item, key) => /* @__PURE__ */ import_react2.default.createElement("li", { key }, item)))))))), assumptions.length > 0 && /* @__PURE__ */ import_react2.default.createElement("details", null, /* @__PURE__ */ import_react2.default.createElement("summary", null, "\u9884\u6D4B\u4F9D\u636E\u4E0E\u5047\u8BBE"), /* @__PURE__ */ import_react2.default.createElement("ul", null, assumptions.map((item, index) => /* @__PURE__ */ import_react2.default.createElement("li", { key: index }, item)))));
}
function buildNotificationPatch(draft, webhookUrl = "") {
  const days = Number(draft.credentialWarnDays), credits = Number(draft.balanceCredits), percent = Number(draft.balancePercent), cooldown = Number(draft.cooldownMinutes) * 60;
  if (!Number.isFinite(days) || days < 0 || days > 90 || !Number.isFinite(credits) || credits < 0 || credits > 1e9 || !Number.isFinite(percent) || percent < 0 || percent > 100 || !Number.isFinite(cooldown) || cooldown < 0 || cooldown > 604800) throw new Error("\u8BF7\u68C0\u67E5\u8FC7\u671F\u5929\u6570\uFF080\u201390\uFF09\u3001\u79EF\u5206\u9608\u503C\u3001\u767E\u5206\u6BD4\uFF080\u2013100\uFF09\u4E0E\u53BB\u91CD\u95F4\u9694\u3002");
  if (draft.webhookEnabled && !draft.webhookConfigured && !webhookUrl.trim()) throw new Error("\u8BF7\u5148\u586B\u5165 Webhook \u5730\u5740\uFF0C\u518D\u542F\u7528\u8BE5\u51FA\u53E3\u3002");
  const patch = { enabled: !!draft.enabled, credentialWarnDays: days, balanceThreshold: { credits, percent }, cooldownSeconds: cooldown, mappings: {}, sinks: { native: { kind: "native", enabled: !!draft.nativeEnabled } } };
  if (draft.webhookConfigured || webhookUrl.trim()) patch.sinks.webhook = { kind: "webhook", enabled: !!draft.webhookEnabled };
  for (const [event] of notificationEvents) patch.mappings[event] = [...new Set(list(draft.mappings?.[event]).filter((sink) => typeof sink === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(sink) && (sink !== "webhook" || patch.sinks.webhook)))];
  if (webhookUrl.trim()) {
    const url = new URL(webhookUrl.trim());
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname))) throw new Error("Webhook \u5730\u5740\u9700\u4F7F\u7528 HTTPS\uFF1B\u672C\u673A\u6D4B\u8BD5\u53EF\u4F7F\u7528 loopback HTTP\u3002");
    if (url.username || url.password) throw new Error("\u8BF7\u5C06\u8BA4\u8BC1\u5185\u5BB9\u4FDD\u5B58\u5728\u672C\u5730\u670D\u52A1\u914D\u7F6E\u4E2D\uFF0C\u4E0D\u653E\u5165 Webhook \u5730\u5740\u7528\u6237\u540D\u5B57\u6BB5\u3002");
    patch.sinks.webhook.url = webhookUrl.trim();
  }
  return { events: patch };
}
function notificationsDraft(snapshot) {
  const state = object(operations(snapshot).events), current = settingsFor(snapshot, "events"), sinks = object(current.sinks || state.sinks);
  return { enabled: current.enabled ?? state.enabled ?? false, nativeEnabled: sinks.native?.enabled ?? true, webhookEnabled: sinks.webhook?.enabled ?? false, webhookConfigured: !!sinks.webhook, credentialWarnDays: current.credentialWarnDays ?? 7, balanceCredits: current.balanceThreshold?.credits ?? 100, balancePercent: current.balanceThreshold?.percent ?? 10, cooldownMinutes: (current.cooldownSeconds ?? 3600) / 60, mappings: { ...object(state.mappings), ...object(current.mappings) } };
}
function NotificationSettings({ snapshot, busy, perform }) {
  const state = object(operations(snapshot).events), form = useDraft(notificationsDraft(snapshot)), id = (0, import_react2.useId)();
  const [webhookUrl, setWebhookUrl] = (0, import_react2.useState)(""), [error, setError] = (0, import_react2.useState)("");
  const map = (event, sink, checked) => {
    const next = new Set(list(form.draft.mappings[event]));
    checked ? next.add(sink) : next.delete(sink);
    form.update({ mappings: { ...form.draft.mappings, [event]: [...next] } });
  };
  const save = () => {
    setError("");
    let body;
    try {
      body = buildNotificationPatch(form.draft, webhookUrl);
    } catch (failure) {
      setError(failure.message);
      return;
    }
    const fresh = form.guard.capture();
    return perform("\u4FDD\u5B58\u4E8B\u4EF6\u901A\u77E5", post("/hub/operations", body), () => {
      if (fresh()) {
        form.saved();
        setWebhookUrl("");
      }
    });
  };
  const recent = list(state.recent).slice(0, 10);
  return /* @__PURE__ */ import_react2.default.createElement("section", { "aria-label": "\u4E8B\u4EF6\u901A\u77E5\u8BBE\u7F6E" }, /* @__PURE__ */ import_react2.default.createElement("h2", null, "\u4E8B\u4EF6\u51FA\u53E3\u4E0E\u901A\u77E5"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "credit-hub__muted" }, "\u6BCF\u7C7B\u4E8B\u4EF6\u53EF\u6620\u5C04\u5230 DSH \u901A\u77E5\u6216 Webhook / IM\u3002\u5916\u53D1\u5185\u5BB9\u53EA\u542B\u8131\u654F\u6458\u8981\uFF1B\u540C\u4E00\u4E8B\u4EF6\u6309\u53BB\u91CD\u95F4\u9694\u5408\u5E76\uFF0C\u5931\u8D25\u6295\u9012\u4F1A\u4FDD\u7559\u72B6\u6001\u3002"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__form" }, /* @__PURE__ */ import_react2.default.createElement("span", null, "\u4E8B\u4EF6\u51FA\u53E3"), /* @__PURE__ */ import_react2.default.createElement(Check, { checked: form.draft.enabled, disabled: busy, onChange: (enabled) => form.update({ enabled }) }, "\u542F\u7528\u4E8B\u4EF6\u901A\u77E5"), /* @__PURE__ */ import_react2.default.createElement("span", null, "DSH \u901A\u77E5"), /* @__PURE__ */ import_react2.default.createElement(Check, { checked: form.draft.nativeEnabled, disabled: busy, onChange: (nativeEnabled) => form.update({ nativeEnabled }) }, "\u53D1\u9001\u5BBF\u4E3B\u901A\u77E5"), /* @__PURE__ */ import_react2.default.createElement("span", null, "Webhook / IM"), /* @__PURE__ */ import_react2.default.createElement(Check, { checked: form.draft.webhookEnabled, disabled: busy, onChange: (webhookEnabled) => form.update({ webhookEnabled }) }, "\u542F\u7528 Webhook \u51FA\u53E3"), /* @__PURE__ */ import_react2.default.createElement(Field, { label: "Webhook \u5730\u5740", id: `${id}-webhook` }, /* @__PURE__ */ import_react2.default.createElement("input", { id: `${id}-webhook`, type: "password", autoComplete: "new-password", "aria-describedby": `${id}-secret-help`, placeholder: form.draft.webhookConfigured ? "\u5DF2\u914D\u7F6E\uFF1B\u7559\u7A7A\u4FDD\u7559\u539F\u5730\u5740" : "https://HOST/\u2026", value: webhookUrl, disabled: busy, onChange: (event) => {
    form.guard.change();
    setWebhookUrl(event.target.value);
    setError("");
  } })), /* @__PURE__ */ import_react2.default.createElement("p", { id: `${id}-secret-help`, className: "credit-hub__wide credit-hub__muted" }, "\u5730\u5740\u4EC5\u5728\u672C\u6B21\u4FDD\u5B58\u65F6\u63D0\u4EA4\uFF1B\u7559\u7A7A\u4FDD\u7559\u5DF2\u914D\u7F6E\u5730\u5740\uFF0C\u4E0D\u56DE\u663E\u5B8C\u6574 URL \u6216\u8BA4\u8BC1\u5934\u3002\u81EA\u5B9A\u4E49 IM \u534F\u8BAE\u53EF\u7531 Webhook \u670D\u52A1\u9002\u914D\u3002"), /* @__PURE__ */ import_react2.default.createElement(Field, { label: "\u51ED\u636E\u63D0\u524D\u63D0\u9192\uFF08\u5929\uFF09", id: `${id}-days` }, /* @__PURE__ */ import_react2.default.createElement("input", { id: `${id}-days`, type: "number", min: "0", max: "90", value: form.draft.credentialWarnDays, disabled: busy, onChange: (event) => form.update({ credentialWarnDays: event.target.value }) })), /* @__PURE__ */ import_react2.default.createElement(Field, { label: "\u4F59\u989D\u63D0\u9192\uFF08\u79EF\u5206\uFF09", id: `${id}-balance` }, /* @__PURE__ */ import_react2.default.createElement("input", { id: `${id}-balance`, type: "number", min: "0", max: "1000000000", step: "any", value: form.draft.balanceCredits, disabled: busy, onChange: (event) => form.update({ balanceCredits: event.target.value }) })), /* @__PURE__ */ import_react2.default.createElement(Field, { label: "\u4F59\u989D\u63D0\u9192\uFF08\u767E\u5206\u6BD4\uFF09", id: `${id}-percent` }, /* @__PURE__ */ import_react2.default.createElement("input", { id: `${id}-percent`, type: "number", min: "0", max: "100", step: "any", value: form.draft.balancePercent, disabled: busy, onChange: (event) => form.update({ balancePercent: event.target.value }) })), /* @__PURE__ */ import_react2.default.createElement(Field, { label: "\u4E8B\u4EF6\u53BB\u91CD\uFF08\u5206\u949F\uFF09", id: `${id}-cooldown` }, /* @__PURE__ */ import_react2.default.createElement("input", { id: `${id}-cooldown`, type: "number", min: "0", max: "10080", value: form.draft.cooldownMinutes, disabled: busy, onChange: (event) => form.update({ cooldownMinutes: event.target.value }) }))), /* @__PURE__ */ import_react2.default.createElement("p", { className: "credit-hub__muted" }, "\u79EF\u5206\u4F59\u989D\u4F4E\u4E8E\u56FA\u5B9A\u503C\u6216\u5DF2\u77E5\u603B\u989D\u767E\u5206\u6BD4\u4EFB\u4E00\u9608\u503C\u65F6\u63D0\u9192\uFF1B\u8FDE\u7EED\u5931\u8D25\u7531\u540E\u7AEF\u7D2F\u8BA1\uFF0C\u6210\u529F\u8BF7\u6C42\u4F1A\u91CD\u7F6E\u3002"), /* @__PURE__ */ import_react2.default.createElement(Rows, { columns: ["\u4E8B\u4EF6", "DSH \u901A\u77E5", "Webhook / IM"], rows: notificationEvents, label: "\u4E8B\u4EF6\u5230\u51FA\u53E3\u6620\u5C04" }, notificationEvents.map(([event, label]) => /* @__PURE__ */ import_react2.default.createElement("tr", { key: event }, /* @__PURE__ */ import_react2.default.createElement("td", null, label), /* @__PURE__ */ import_react2.default.createElement("td", null, /* @__PURE__ */ import_react2.default.createElement(Check, { label: `${label} \xB7 DSH \u901A\u77E5`, checked: list(form.draft.mappings[event]).includes("native"), disabled: busy, onChange: (checked) => map(event, "native", checked) }, "\u901A\u77E5")), /* @__PURE__ */ import_react2.default.createElement("td", null, /* @__PURE__ */ import_react2.default.createElement(Check, { label: `${label} \xB7 Webhook`, checked: list(form.draft.mappings[event]).includes("webhook"), disabled: busy || !form.draft.webhookConfigured && !webhookUrl.trim(), onChange: (checked) => map(event, "webhook", checked) }, "Webhook"))))), /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react2.default.createElement(Action2, { primary: true, disabled: busy || !form.dirty && !webhookUrl.trim(), onClick: save }, "\u4FDD\u5B58\u4E8B\u4EF6\u901A\u77E5"), /* @__PURE__ */ import_react2.default.createElement(Action2, { disabled: busy || !state.enabled, onClick: () => perform("\u53D1\u9001\u6D4B\u8BD5\u901A\u77E5", post("/hub/events/test")) }, "\u53D1\u9001\u6D4B\u8BD5\u901A\u77E5"), /* @__PURE__ */ import_react2.default.createElement("span", { className: "credit-hub__muted" }, "\u7B49\u5F85\u6295\u9012 ", number(state.pending), " \xB7 \u7B49\u5F85\u5BBF\u4E3B\u63A5\u6536 ", number(state.nativePending))), /* @__PURE__ */ import_react2.default.createElement(Feedback, { error: true }, error), recent.length > 0 && /* @__PURE__ */ import_react2.default.createElement("details", null, /* @__PURE__ */ import_react2.default.createElement("summary", null, "\u6700\u8FD1\u4E8B\u4EF6\u4E0E\u6295\u9012\u72B6\u6001"), /* @__PURE__ */ import_react2.default.createElement(Rows, { columns: ["\u65F6\u95F4", "\u4E8B\u4EF6", "\u6295\u9012\u72B6\u6001"], rows: recent, label: "\u6700\u8FD1\u4E8B\u4EF6" }, recent.map((event, index) => /* @__PURE__ */ import_react2.default.createElement("tr", { key: event.id || index }, /* @__PURE__ */ import_react2.default.createElement("td", null, when(event.at || event.createdAt)), /* @__PURE__ */ import_react2.default.createElement("td", null, /* @__PURE__ */ import_react2.default.createElement("span", { className: "credit-hub__cell-main" }, notificationEvents.find(([key]) => key === event.type)?.[1] || show(event.type, "\u4E8B\u4EF6")), /* @__PURE__ */ import_react2.default.createElement("span", { className: "credit-hub__cell-detail" }, show(event.message || event.summary, "\u5DF2\u8BB0\u5F55\u8131\u654F\u4E8B\u4EF6"))), /* @__PURE__ */ import_react2.default.createElement("td", null, show(event.deliveryStatus || event.status, "\u5DF2\u8FDB\u5165\u4E8B\u4EF6\u961F\u5217")))))));
}
function buildUpdatePatch(draft) {
  const repository = String(draft.repository || "").trim(), feedUrl = String(draft.feedUrl || "").trim();
  if (repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("GitHub \u4ED3\u5E93\u8BF7\u586B\u5199 OWNER/REPO\uFF0C\u4E0D\u542B\u7F51\u5740\u6216\u5206\u652F\u3002");
  if (feedUrl && !draft.clearFeed) {
    const url = new URL(feedUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("\u66F4\u65B0\u6E05\u5355\u8BF7\u4F7F\u7528\u4E0D\u542B\u7528\u6237\u540D\u548C\u5BC6\u7801\u7684 HTTPS \u5730\u5740\u3002");
  }
  const intervalHours = Number(draft.intervalHours);
  if (!Number.isFinite(intervalHours) || intervalHours < 0.25 || intervalHours > 168) throw new Error("\u68C0\u67E5\u95F4\u9694\u5E94\u4E3A 0.25\u2013168 \u5C0F\u65F6\u3002");
  return { updates: { enabled: !!draft.enabled, repository, ...draft.clearFeed ? { feedUrl: "" } : feedUrl ? { feedUrl } : {}, intervalHours } };
}
function publicReleaseLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
function UpdatePanel({ snapshot, busy, perform }) {
  const state = object(operations(snapshot).updates), current = settingsFor(snapshot, "updates"), form = useDraft({ enabled: current.enabled ?? true, repository: String(current.repository || "").replace(/^git\+/, "").replace(/\.git$/, "").replace(/^https:\/\/github.com\//, ""), feedUrl: "", clearFeed: false, intervalHours: current.intervalHours ?? 1 }), id = (0, import_react2.useId)();
  const [error, setError] = (0, import_react2.useState)("");
  const save = () => {
    setError("");
    let body;
    try {
      body = buildUpdatePatch(form.draft);
    } catch (failure) {
      setError(failure.message);
      return;
    }
    const fresh = form.guard.capture();
    return perform("\u4FDD\u5B58\u4E91\u66F4\u65B0\u8BBE\u7F6E", post("/hub/operations", body), () => {
      if (fresh()) form.saved({ feedUrl: "", clearFeed: false });
    });
  };
  const releaseUrl = publicReleaseLink(state.releaseUrl);
  return /* @__PURE__ */ import_react2.default.createElement("section", { "aria-label": "\u4E91\u66F4\u65B0\u8BBE\u7F6E" }, /* @__PURE__ */ import_react2.default.createElement("h2", null, "\u7248\u672C\u66F4\u65B0\u63D0\u9192"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__notice", role: state.updateAvailable ? "status" : void 0 }, /* @__PURE__ */ import_react2.default.createElement("strong", null, state.updateAvailable ? `\u53D1\u73B0\u65B0\u7248\u672C ${show(state.availableVersion)}` : state.configured ? { check_failed: "\u66F4\u65B0\u68C0\u67E5\u5931\u8D25\uFF0C\u53EF\u91CD\u65B0\u68C0\u67E5", current: "\u5F53\u524D\u672A\u53D1\u73B0\u66F4\u65B0", checking: "\u6B63\u5728\u68C0\u67E5\u66F4\u65B0\u2026", up_to_date: "\u5DF2\u662F\u6700\u65B0\u7248\u672C", never_checked: "\u5C1A\u672A\u6267\u884C\u7248\u672C\u68C0\u67E5" }[state.status] || "\u66F4\u65B0\u68C0\u6D4B\u5DF2\u914D\u7F6E" : "\u5C1A\u672A\u914D\u7F6E\u7EBF\u4E0A\u53D1\u5E03\u6765\u6E90"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "credit-hub__muted" }, "\u5DF2\u5B89\u88C5 ", show(state.installedVersion, snapshot.pluginVersion || "\u2014"), " \xB7 \u6700\u8FD1\u68C0\u67E5 ", when(state.checkedAt)), releaseUrl && /* @__PURE__ */ import_react2.default.createElement("a", { href: releaseUrl, target: "_blank", rel: "noopener noreferrer" }, "\u67E5\u770B\u53D1\u5E03\u8BF4\u660E")), /* @__PURE__ */ import_react2.default.createElement("p", { className: "credit-hub__muted" }, "\u5B9A\u671F\u68C0\u6D4B\u5DF2\u53D1\u5E03\u7248\u672C\uFF1B\u53D1\u73B0\u66F4\u65B0\u540E\u6309\u4E8B\u4EF6\u51FA\u53E3\u63D0\u9192\uFF0C\u4E0D\u5728\u540E\u53F0\u8986\u76D6\u6B63\u5728\u4F7F\u7528\u7684\u63D2\u4EF6\u3002\u5E02\u573A\u5B89\u88C5\u4ECD\u7531 DSH \u63D2\u4EF6\u5E02\u573A\u6267\u884C\uFF0C\u672C\u5730 link \u5B89\u88C5\u53EA\u663E\u793A\u66F4\u65B0\u4FE1\u606F\u3002"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__form" }, /* @__PURE__ */ import_react2.default.createElement("span", null, "\u540E\u53F0\u68C0\u67E5"), /* @__PURE__ */ import_react2.default.createElement(Check, { checked: form.draft.enabled, disabled: busy, onChange: (enabled) => form.update({ enabled }) }, "\u542F\u7528\u4E91\u7248\u672C\u68C0\u6D4B"), /* @__PURE__ */ import_react2.default.createElement(Field, { label: "GitHub \u4ED3\u5E93", id: `${id}-repository` }, /* @__PURE__ */ import_react2.default.createElement("input", { id: `${id}-repository`, placeholder: "OWNER/REPO", value: form.draft.repository, disabled: busy, onChange: (event) => form.update({ repository: event.target.value }) })), /* @__PURE__ */ import_react2.default.createElement(Field, { label: "HTTPS \u66F4\u65B0\u6E05\u5355", id: `${id}-feed` }, /* @__PURE__ */ import_react2.default.createElement("input", { id: `${id}-feed`, type: "password", autoComplete: "new-password", placeholder: "\u53EF\u9009\uFF1B\u7559\u7A7A\u4FDD\u7559\u73B0\u6709\u6E05\u5355", value: form.draft.feedUrl, disabled: busy || form.draft.clearFeed, onChange: (event) => form.update({ feedUrl: event.target.value }) })), /* @__PURE__ */ import_react2.default.createElement("span", null, "\u6E05\u5355\u6765\u6E90"), /* @__PURE__ */ import_react2.default.createElement(Check, { checked: form.draft.clearFeed, disabled: busy, onChange: (clearFeed) => form.update({ clearFeed }) }, "\u6E05\u9664\u5DF2\u6709\u6E05\u5355\uFF0C\u6539\u7528 GitHub \u4ED3\u5E93"), /* @__PURE__ */ import_react2.default.createElement(Field, { label: "\u68C0\u67E5\u95F4\u9694\uFF08\u5C0F\u65F6\uFF09", id: `${id}-interval` }, /* @__PURE__ */ import_react2.default.createElement("input", { id: `${id}-interval`, type: "number", min: "0.25", max: "168", step: "0.25", value: form.draft.intervalHours, disabled: busy, onChange: (event) => form.update({ intervalHours: event.target.value }) })), /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__wide credit-hub__toolbar" }, /* @__PURE__ */ import_react2.default.createElement(Action2, { primary: true, disabled: busy || !form.dirty, onClick: save }, "\u4FDD\u5B58\u66F4\u65B0\u6765\u6E90"), /* @__PURE__ */ import_react2.default.createElement(Action2, { disabled: busy || !state.configured || state.status === "checking", onClick: () => perform("\u68C0\u67E5\u4E91\u7248\u672C", post("/hub/updates")) }, "\u7ACB\u5373\u68C0\u67E5\u66F4\u65B0"))), /* @__PURE__ */ import_react2.default.createElement(Feedback, { error: true }, error));
}
function missingAccountIds(rows, selection) {
  const allowed = new Set(list(rows).map((row) => row.accountId).filter((id) => typeof id === "string" && id));
  return [...new Set(list(selection).filter((id) => allowed.has(id)))];
}
function buildSchedulerPatch(draft) {
  const maxConcurrency = Number(draft.maxConcurrency), startupSpreadSeconds = Number(draft.startupSpreadSeconds);
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 32 || !Number.isFinite(startupSpreadSeconds) || startupSpreadSeconds < 0 || startupSpreadSeconds > 86400) throw new Error("\u5E76\u53D1\u4E0A\u9650\u5E94\u4E3A 1\u201332\uFF1B\u542F\u52A8\u8865\u8DD1\u5206\u6563\u5E94\u4E3A 0\u201386400 \u79D2\u3002");
  const windows = {};
  for (const [platform, window] of Object.entries(object(draft.windows))) {
    if (window === null) continue;
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(window.start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(window.end) || window.start === window.end) throw new Error(`${platform} \u7684\u7A97\u53E3\u5E94\u4E3A\u4E0D\u540C\u7684\u6709\u6548 HH:MM \u65F6\u523B\u3002`);
    windows[platform] = { start: window.start, end: window.end };
  }
  return { windows, maxConcurrency, startupSpreadSeconds, startup: !!draft.startup };
}
function SchedulerControls({ snapshot, busy, perform }) {
  const schedule = object(snapshot.schedule), state = object(schedule.status), current = object(schedule.settings), form = useDraft({ windows: object(current.windows), maxConcurrency: current.maxConcurrency ?? 2, startupSpreadSeconds: current.startupSpreadSeconds ?? 300, startup: current.startup ?? false });
  const [selection, setSelection] = (0, import_react2.useState)([]), [platform, setPlatform] = (0, import_react2.useState)(""), [start, setStart] = (0, import_react2.useState)("00:05"), [end, setEnd] = (0, import_react2.useState)("00:40"), [error, setError] = (0, import_react2.useState)("");
  const guard = useOperationGuard(), id = (0, import_react2.useId)(), missing = list(state.todayMissing), selectedIds = missingAccountIds(missing, selection);
  const platforms = [...new Set([...list(snapshot.accounts).map((account) => account.platform), ...Object.keys(form.draft.windows)].filter(Boolean))].sort();
  const selectedPlatform = platform || platforms[0] || "", windows = Object.entries(form.draft.windows).filter(([, window]) => window !== null);
  const signature = JSON.stringify(selectedIds);
  guard.select(signature);
  const toggle = (accountId) => {
    guard.change();
    setSelection((values) => values.includes(accountId) ? values.filter((value) => value !== accountId) : [...values, accountId]);
  };
  const manual = (accountIds) => {
    const fresh = guard.capture();
    return perform("\u8865\u7B7E\u4ECA\u65E5\u672A\u5B8C\u6210\u8D26\u53F7", post("/hub/scheduler/manual", { ...accountIds ? { accountIds } : {}, missingOnly: true }), () => {
      if (fresh()) setSelection([]);
    });
  };
  const save = () => {
    setError("");
    let body;
    try {
      body = buildSchedulerPatch(form.draft);
    } catch (failure) {
      setError(failure.message);
      return;
    }
    const fresh = form.guard.capture();
    return perform("\u4FDD\u5B58\u7A97\u53E3\u4E0E\u5E76\u53D1\u8BBE\u7F6E", post("/hub/scheduler", body), () => {
      if (fresh()) form.saved();
    });
  };
  const accountLabel = (accountId) => list(snapshot.accounts).find((account) => account.id === accountId)?.label || "\u8D26\u53F7";
  return /* @__PURE__ */ import_react2.default.createElement("section", { "aria-label": "\u7B7E\u5230\u8C03\u5EA6\u7A97\u53E3\u4E0E\u8865\u7B7E" }, /* @__PURE__ */ import_react2.default.createElement("h2", null, "\u4ECA\u65E5\u672A\u7B7E\u5230"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "credit-hub__muted" }, "\u4EC5\u5217\u51FA\u4ECA\u65E5\u672A\u786E\u8BA4\u6210\u529F\u7684\u8D26\u53F7\u3002\u542F\u52A8\u8865\u8DD1\u53EA\u81EA\u52A8\u5904\u7406\u4ECA\u65E5\u672A\u5C1D\u8BD5\u9879\uFF1B\u5DF2\u7ECF\u5C1D\u8BD5\u4F46\u5931\u8D25\u7684\u8D26\u53F7\u4FDD\u7559\u5728\u8FD9\u91CC\uFF0C\u7531\u4F60\u51B3\u5B9A\u662F\u5426\u624B\u52A8\u8865\u7B7E\u3002"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__summary" }, /* @__PURE__ */ import_react2.default.createElement("span", null, "\u4ECA\u65E5\u5DF2\u5C1D\u8BD5 ", /* @__PURE__ */ import_react2.default.createElement("strong", null, number(typeof state.todayAttempted === "number" ? state.todayAttempted : Array.isArray(state.todayAttempted) ? state.todayAttempted.length : void 0))), /* @__PURE__ */ import_react2.default.createElement("span", null, "\u7B49\u5F85\u6267\u884C ", /* @__PURE__ */ import_react2.default.createElement("strong", null, number(Array.isArray(state.queue) ? state.queue.length : typeof state.queue === "number" ? state.queue : void 0))), /* @__PURE__ */ import_react2.default.createElement("span", null, "\u6267\u884C\u4E2D ", /* @__PURE__ */ import_react2.default.createElement("strong", null, number(Array.isArray(state.running) ? state.running.length : typeof state.running === "number" ? state.running : void 0)))), /* @__PURE__ */ import_react2.default.createElement(Rows, { columns: ["\u8D26\u53F7 / \u5E73\u53F0", "\u4ECA\u65E5\u72B6\u6001", "\u8BA1\u5212\u6267\u884C", "\u64CD\u4F5C"], rows: missing, label: "\u4ECA\u65E5\u672A\u7B7E\u5230\u8D26\u53F7", empty: state.todayMissing ? "\u4ECA\u65E5\u6CA1\u6709\u5F85\u8865\u7B7E\u8D26\u53F7\uFF1B\u6B64\u5904\u53EA\u8BFB\u53D6\u672C\u5730\u8C03\u5EA6\u72B6\u6001\u3002" : "\u5C1A\u65E0\u4ECA\u65E5\u8C03\u5EA6\u72B6\u6001\u3002\u5237\u65B0\u672C\u5730\u5FEB\u7167\u540E\u53EF\u67E5\u770B\u672A\u7B7E\u5230\u8D26\u53F7\u3002" }, missing.map((row, index) => /* @__PURE__ */ import_react2.default.createElement("tr", { key: `${row.accountId}-${row.task || index}` }, /* @__PURE__ */ import_react2.default.createElement("td", null, /* @__PURE__ */ import_react2.default.createElement(Check, { label: `\u8865\u7B7E\u9009\u62E9 \xB7 ${accountLabel(row.accountId)} \xB7 ${row.platform || ""}`, checked: selectedIds.includes(row.accountId), disabled: busy || !row.accountId, onChange: () => toggle(row.accountId) }, accountLabel(row.accountId)), /* @__PURE__ */ import_react2.default.createElement("span", { className: "credit-hub__cell-detail" }, show(row.platform), " \xB7 ", show(row.task, "\u7B7E\u5230"))), /* @__PURE__ */ import_react2.default.createElement("td", null, row.attemptedToday ? "\u4ECA\u65E5\u5DF2\u5C1D\u8BD5\uFF0C\u5C1A\u672A\u6210\u529F" : "\u4ECA\u65E5\u5C1A\u672A\u5C1D\u8BD5", /* @__PURE__ */ import_react2.default.createElement("span", { className: "credit-hub__cell-detail" }, show(row.status, row.automaticEligible ? "\u7B26\u5408\u81EA\u52A8\u8865\u8DD1\u6761\u4EF6" : "\u7B49\u5F85\u624B\u52A8\u5904\u7406"))), /* @__PURE__ */ import_react2.default.createElement("td", null, row.plannedAt ? when(row.plannedAt) : "\u5C1A\u672A\u6392\u5165\u7A97\u53E3"), /* @__PURE__ */ import_react2.default.createElement("td", null, /* @__PURE__ */ import_react2.default.createElement(Action2, { disabled: busy || !row.accountId, onClick: () => manual([row.accountId]) }, "\u8865\u7B7E\u6B64\u8D26\u53F7"))))), missing.length > 0 && /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react2.default.createElement(Action2, { disabled: busy, onClick: () => {
    guard.change();
    setSelection(missingAccountIds(missing, missing.map((row) => row.accountId)));
  } }, "\u5168\u9009\u672A\u7B7E\u5230\u8D26\u53F7"), /* @__PURE__ */ import_react2.default.createElement(Action2, { primary: true, disabled: busy || !selectedIds.length, onClick: () => manual(selectedIds) }, "\u8865\u7B7E\u5DF2\u9009\uFF08", selectedIds.length, "\uFF09"), /* @__PURE__ */ import_react2.default.createElement(Action2, { disabled: busy, onClick: () => manual() }, "\u8865\u7B7E\u5168\u90E8\u672A\u5B8C\u6210")), /* @__PURE__ */ import_react2.default.createElement("details", null, /* @__PURE__ */ import_react2.default.createElement("summary", null, "\u65F6\u95F4\u7A97\u53E3\u3001\u968F\u673A\u6296\u52A8\u4E0E\u5E76\u53D1"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "credit-hub__muted" }, "\u7A97\u53E3\u6309\u6392\u7A0B\u65F6\u533A ", show(current.timezone, "Asia/Shanghai"), " \u8BA1\u7B97\u3002\u6BCF\u4E2A\u8D26\u53F7\u5728\u7A97\u53E3\u5185\u5206\u6563\u6267\u884C\uFF1B\u624B\u52A8\u8865\u7B7E\u540C\u6837\u9075\u5FAA\u5168\u5C40\u5E76\u53D1\u4E0A\u9650\u3002"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__form" }, /* @__PURE__ */ import_react2.default.createElement(Field, { label: "\u5168\u5C40\u5E76\u53D1\u4E0A\u9650", id: `${id}-concurrency` }, /* @__PURE__ */ import_react2.default.createElement("input", { id: `${id}-concurrency`, type: "number", min: "1", max: "32", value: form.draft.maxConcurrency, disabled: busy, onChange: (event) => form.update({ maxConcurrency: event.target.value }) })), /* @__PURE__ */ import_react2.default.createElement(Field, { label: "\u542F\u52A8\u8865\u8DD1\u5206\u6563\uFF08\u79D2\uFF09", id: `${id}-spread` }, /* @__PURE__ */ import_react2.default.createElement("input", { id: `${id}-spread`, type: "number", min: "0", max: "86400", value: form.draft.startupSpreadSeconds, disabled: busy, onChange: (event) => form.update({ startupSpreadSeconds: event.target.value }) })), /* @__PURE__ */ import_react2.default.createElement("span", null, "\u542F\u52A8\u8865\u8DD1"), /* @__PURE__ */ import_react2.default.createElement(Check, { checked: form.draft.startup, disabled: busy, onChange: (startup) => form.update({ startup }) }, "\u542F\u52A8\u540E\u5206\u6563\u8865\u8DD1\u4ECA\u65E5\u672A\u5C1D\u8BD5\u8D26\u53F7")), /* @__PURE__ */ import_react2.default.createElement("h2", null, "\u5E73\u53F0\u72EC\u7ACB\u7A97\u53E3"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "credit-hub__muted" }, "\u672A\u8986\u76D6\u7684\u5E73\u53F0\u4F7F\u7528\u9ED8\u8BA4\u6392\u7A0B\u65F6\u95F4\uFF1B\u8DE8\u5348\u591C\u7A97\u53E3\u7684\u51CC\u6668\u3001\u591C\u95F4\u90E8\u5206\u6309\u5404\u81EA\u672C\u5730\u65E5\u671F\u53BB\u91CD\u3002\u4E0B\u65B9 00:05\u201300:40 \u4EC5\u4E3A\u65B0\u589E\u7A97\u53E3\u7684\u53EF\u7F16\u8F91\u521D\u59CB\u503C\uFF0C\u70B9\u51FB\u6DFB\u52A0\u540E\u624D\u4FDD\u5B58\u3002"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react2.default.createElement("select", { "aria-label": "\u65B0\u589E\u7A97\u53E3\u5E73\u53F0", value: selectedPlatform, disabled: busy || !platforms.length, onChange: (event) => setPlatform(event.target.value) }, platforms.length ? platforms.map((item) => /* @__PURE__ */ import_react2.default.createElement("option", { key: item, value: item }, item)) : /* @__PURE__ */ import_react2.default.createElement("option", { value: "" }, "\u5148\u63A5\u5165\u8D26\u53F7")), /* @__PURE__ */ import_react2.default.createElement("input", { type: "time", "aria-label": "\u65B0\u589E\u7A97\u53E3\u5F00\u59CB", value: start, disabled: busy, onChange: (event) => setStart(event.target.value) }), /* @__PURE__ */ import_react2.default.createElement("span", null, "\u81F3"), /* @__PURE__ */ import_react2.default.createElement("input", { type: "time", "aria-label": "\u65B0\u589E\u7A97\u53E3\u7ED3\u675F", value: end, disabled: busy, onChange: (event) => setEnd(event.target.value) }), /* @__PURE__ */ import_react2.default.createElement(Action2, { disabled: busy || !selectedPlatform || !start || !end, onClick: () => form.update({ windows: { ...form.draft.windows, [selectedPlatform]: { start, end } } }) }, "\u6DFB\u52A0 / \u66FF\u6362\u7A97\u53E3")), /* @__PURE__ */ import_react2.default.createElement(Rows, { columns: ["\u5E73\u53F0", "\u5F00\u59CB", "\u7ED3\u675F", "\u64CD\u4F5C"], rows: windows, label: "\u5E73\u53F0\u7B7E\u5230\u65F6\u95F4\u7A97\u53E3", empty: "\u5C1A\u65E0\u72EC\u7ACB\u7A97\u53E3\uFF0C\u6240\u6709\u5E73\u53F0\u4F7F\u7528\u9ED8\u8BA4\u6392\u7A0B\u65F6\u95F4\u3002" }, windows.map(([key, window]) => /* @__PURE__ */ import_react2.default.createElement("tr", { key }, /* @__PURE__ */ import_react2.default.createElement("td", null, key), /* @__PURE__ */ import_react2.default.createElement("td", null, /* @__PURE__ */ import_react2.default.createElement("input", { type: "time", "aria-label": `${key} \u7A97\u53E3\u5F00\u59CB`, value: window.start, disabled: busy, onChange: (event) => form.update({ windows: { ...form.draft.windows, [key]: { ...window, start: event.target.value } } }) })), /* @__PURE__ */ import_react2.default.createElement("td", null, /* @__PURE__ */ import_react2.default.createElement("input", { type: "time", "aria-label": `${key} \u7A97\u53E3\u7ED3\u675F`, value: window.end, disabled: busy, onChange: (event) => form.update({ windows: { ...form.draft.windows, [key]: { ...window, end: event.target.value } } }) })), /* @__PURE__ */ import_react2.default.createElement("td", null, /* @__PURE__ */ import_react2.default.createElement(Action2, { disabled: busy, onClick: () => {
    const next = { ...form.draft.windows };
    delete next[key];
    form.update({ windows: next });
  } }, "\u6062\u590D\u9ED8\u8BA4\u7A97\u53E3"))))), /* @__PURE__ */ import_react2.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react2.default.createElement(Action2, { primary: true, disabled: busy || !form.dirty, onClick: save }, "\u4FDD\u5B58\u7A97\u53E3\u4E0E\u5E76\u53D1")), /* @__PURE__ */ import_react2.default.createElement(Feedback, { error: true }, error)));
}

// client/index.jsx
var name = "credit-hub-client";
var inject = ["slots", "layout", "connection"];
var PANEL = "credit-hub";
var tabs = [["accounts", "\u8D26\u6237"], ["routes", "\u6A21\u578B\u8DEF\u7531"], ["tasks", "\u7B7E\u5230\u4EFB\u52A1"], ["usage", "\u7528\u91CF\u8BB0\u5F55"], ["relay", "\u63A5\u529B\u7B56\u7565"], ["settings", "\u8BBE\u7F6E"]];
function createCreditHubApi(ctx) {
  const call = async (method, payload, signal) => {
    const result = await ctx.connection.rpc.call("/api", `creditHub/${method}`, { args: payload }, signal);
    if (result?.ok !== true) throw new Error(result?.error?.message || "\u79EF\u5206\u4E2D\u67A2\u8FDE\u63A5\u4E2D\u65AD\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002");
    return result.value;
  };
  return {
    taskState: /* @__PURE__ */ new Map(),
    snapshot: (signal) => call("snapshot", {}, signal),
    request: async (input, signal) => {
      const result = await call("request", { input }, signal);
      if (result?.status >= 400) throw new Error(result.body?.error?.message || result.body?.error || result.body?.message || `\u64CD\u4F5C\u8FD4\u56DE HTTP ${result.status}`);
      return result;
    }
  };
}
var array = (value) => Array.isArray(value) ? value : [];
var text = (value, fallback = "\u2014") => value === void 0 || value === null || value === "" ? fallback : String(value);
var quantity = (value) => typeof value === "number" ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value) : text(value);
var timestamp = (value) => {
  if (!value) return "\u5C1A\u65E0\u8BB0\u5F55";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text(value) : date.toLocaleString("zh-CN", { hour12: false });
};
function Icon({ size = 18 }) {
  return /* @__PURE__ */ import_react3.default.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, /* @__PURE__ */ import_react3.default.createElement("rect", { x: "3.5", y: "4", width: "17", height: "16", rx: "3" }), /* @__PURE__ */ import_react3.default.createElement("path", { d: "M3.5 9h17M8 13h3M8 16h6M16.5 13h.01" }));
}
function Button({ primary, children, ...props }) {
  return /* @__PURE__ */ import_react3.default.createElement("button", { type: "button", className: `credit-hub__button${primary ? " credit-hub__button--primary" : ""}`, ...props }, children);
}
function Badge({ active, children, pending }) {
  return /* @__PURE__ */ import_react3.default.createElement("span", { className: `credit-hub__badge${active ? " credit-hub__badge--enabled" : pending ? " credit-hub__badge--pending" : ""}` }, children);
}
function Empty({ title, children }) {
  return /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__empty" }, /* @__PURE__ */ import_react3.default.createElement("strong", null, title), children);
}
function Table({ columns, children, empty, count }) {
  return count ? /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__table-wrap" }, /* @__PURE__ */ import_react3.default.createElement("table", null, /* @__PURE__ */ import_react3.default.createElement("thead", null, /* @__PURE__ */ import_react3.default.createElement("tr", null, columns.map((column) => /* @__PURE__ */ import_react3.default.createElement("th", { key: column, scope: "col" }, column)))), /* @__PURE__ */ import_react3.default.createElement("tbody", null, children))) : /* @__PURE__ */ import_react3.default.createElement(Empty, { title: empty || "\u6682\u65E0\u8BB0\u5F55" }, "\u5237\u65B0\u672C\u5730\u5FEB\u7167\u4EE5\u67E5\u770B\u6700\u65B0\u72B6\u6001\u3002");
}
function Check2({ checked, onChange, children, disabled, ariaLabel }) {
  return /* @__PURE__ */ import_react3.default.createElement("label", { className: "credit-hub__check" }, /* @__PURE__ */ import_react3.default.createElement("input", { type: "checkbox", "aria-label": ariaLabel, checked: !!checked, onChange, disabled }), children);
}
function accountConnectionLabel(account) {
  return account.setupRequired || account.connectionState === "setup_required" ? "\u5F85\u72EC\u7ACB\u914D\u7F6E" : account.connectionState === "snapshot_required" ? "\u5F85\u51ED\u636E\u5FEB\u7167" : "\u672A\u6838\u9A8C";
}
function Accounts({ snapshot, busy, perform }) {
  const [query, setQuery] = (0, import_react3.useState)("");
  const [platform, setPlatform] = (0, import_react3.useState)("all");
  const [capture, setCapture] = (0, import_react3.useState)(false);
  const [captureLabel, setCaptureLabel] = (0, import_react3.useState)("");
  const [transfer, setTransfer] = (0, import_react3.useState)("");
  const [removal, setRemoval] = (0, import_react3.useState)(null);
  const accounts = array(snapshot.accounts);
  const platforms = [...new Set(accounts.map((account) => account.platform))];
  const visible = accounts.filter((account) => (platform === "all" || account.platform === platform) && `${account.label} ${account.platform}`.toLowerCase().includes(query.toLowerCase()));
  const update = (account, values) => perform("\u4FDD\u5B58\u8D26\u6237\u8BBE\u7F6E", { method: "POST", path: "/hub/accounts", body: { accountId: account.id, ...values } });
  return /* @__PURE__ */ import_react3.default.createElement(import_react3.default.Fragment, null, /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react3.default.createElement("input", { className: "credit-hub__search", "aria-label": "\u641C\u7D22\u8D26\u6237", placeholder: "\u641C\u7D22\u8D26\u6237\u540D\u79F0\u6216\u5E73\u53F0", value: query, onChange: (event) => setQuery(event.target.value) }), /* @__PURE__ */ import_react3.default.createElement("select", { "aria-label": "\u6309\u5E73\u53F0\u7B5B\u9009", value: platform, onChange: (event) => setPlatform(event.target.value) }, /* @__PURE__ */ import_react3.default.createElement("option", { value: "all" }, "\u5168\u90E8\u5E73\u53F0"), platforms.map((item) => /* @__PURE__ */ import_react3.default.createElement("option", { key: item, value: item }, item))), /* @__PURE__ */ import_react3.default.createElement(Button, { onClick: () => setCapture((value) => !value), disabled: busy }, "\u6DFB\u52A0\u5F53\u524D WorkBuddy \u8D26\u6237"), /* @__PURE__ */ import_react3.default.createElement(Button, { disabled: busy, onClick: () => perform("\u5237\u65B0\u4E0A\u6E38\u4F59\u989D", { method: "GET", path: "/admin/balances?refresh=1" }) }, "\u624B\u52A8\u5237\u65B0\u4F59\u989D"), /* @__PURE__ */ import_react3.default.createElement(Button, { disabled: busy, onClick: () => setTransfer(transfer === "import" ? "" : "import") }, "\u5BFC\u5165\u8D26\u53F7"), /* @__PURE__ */ import_react3.default.createElement(Button, { disabled: busy, onClick: () => setTransfer(transfer === "export" ? "" : "export") }, "\u5BFC\u51FA\u8D26\u53F7")), transfer && /* @__PURE__ */ import_react3.default.createElement(AccountTransfer, { key: transfer, mode: transfer, accounts, busy, perform, onClose: () => setTransfer("") }), capture && /* @__PURE__ */ import_react3.default.createElement("form", { className: "credit-hub__inline-form", onSubmit: (event) => {
    event.preventDefault();
    perform("\u6DFB\u52A0\u5F53\u524D WorkBuddy \u8D26\u6237", { method: "POST", path: "/admin/workbuddy/capture", body: { ...captureLabel.trim() ? { label: captureLabel.trim() } : {} } }).then((ok) => {
      if (ok) setCapture(false);
    });
  } }, /* @__PURE__ */ import_react3.default.createElement("input", { "aria-label": "\u65B0\u8D26\u6237\u5907\u6CE8", placeholder: "\u8D26\u6237\u5907\u6CE8\uFF08\u53EF\u9009\uFF09", value: captureLabel, onChange: (event) => setCaptureLabel(event.target.value) }), /* @__PURE__ */ import_react3.default.createElement("button", { className: "credit-hub__button credit-hub__button--primary", disabled: busy, type: "submit" }, "\u8BFB\u53D6\u5F53\u524D\u5BA2\u6237\u7AEF\u5E76\u6DFB\u52A0"), /* @__PURE__ */ import_react3.default.createElement(Button, { onClick: () => setCapture(false) }, "\u53D6\u6D88")), /* @__PURE__ */ import_react3.default.createElement("details", { className: "credit-hub__operation-details" }, /* @__PURE__ */ import_react3.default.createElement("summary", null, "\u540E\u88C5 Agent \u81EA\u52A8\u53D1\u73B0\u4E0E\u63A5\u5165"), /* @__PURE__ */ import_react3.default.createElement(DiscoveryPanel, { snapshot, busy, perform })), /* @__PURE__ */ import_react3.default.createElement("p", { className: "credit-hub__muted" }, "\u201C\u6A21\u578B\u8C03\u7528\u201D\u53EA\u63A7\u5236\u79EF\u5206\u8C03\u7528\u8D44\u683C\uFF1B\u505C\u7528\u6A21\u578B\u8C03\u7528\u540E\uFF0C\u81EA\u52A8\u7B7E\u5230\u4E0E\u4EFB\u52A1\u4ECD\u7531\u72EC\u7ACB\u6392\u7A0B\u63A7\u5236\u3002\u4F59\u989D\u4EC5\u5728\u70B9\u51FB\u5237\u65B0\u65F6\u8BF7\u6C42\u4E0A\u6E38\u3002"), removal && /* @__PURE__ */ import_react3.default.createElement("div", { role: "alert", className: "credit-hub__notice" }, /* @__PURE__ */ import_react3.default.createElement("strong", null, "\u5220\u9664\u8D26\u53F7\uFF1A", removal.label || removal.platform), /* @__PURE__ */ import_react3.default.createElement("p", null, "\u5220\u9664\u8BE5\u8D26\u53F7\u3001\u6A21\u578B\u5F15\u7528\u53CA\u72EC\u5360\u7684\u63D2\u4EF6\u51ED\u636E\u5FEB\u7167\uFF0C\u5E76\u963B\u6B62\u81EA\u52A8\u53D1\u73B0\u91CD\u65B0\u5BFC\u5165\u540C\u4E00\u8EAB\u4EFD\u3002\u539F\u5BA2\u6237\u7AEF\u4E0E\u65E0\u51ED\u636E\u5386\u53F2\u8BB0\u5F55\u4FDD\u7559\u3002"), /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react3.default.createElement(Button, { disabled: busy, onClick: () => perform("\u5220\u9664\u8D26\u53F7", { method: "POST", path: "/hub/accounts/remove", body: { accountId: removal.id, confirm: true } }).then((ok) => {
    if (ok) setRemoval(null);
  }) }, "\u786E\u8BA4\u5220\u9664\uFF0C\u4E0D\u4FDD\u7559\u767B\u5F55\u51ED\u636E"), /* @__PURE__ */ import_react3.default.createElement(Button, { disabled: busy, onClick: () => setRemoval(null) }, "\u53D6\u6D88"))), /* @__PURE__ */ import_react3.default.createElement(Table, { columns: ["\u8D26\u6237", "\u5E73\u53F0", "\u6A21\u578B\u8C03\u7528", "\u8D26\u6237\u72B6\u6001", "\u51ED\u636E\u65B9\u5F0F / \u6838\u9A8C", "\u64CD\u4F5C"], count: visible.length, empty: accounts.length ? "\u6CA1\u6709\u5339\u914D\u7684\u8D26\u6237" : "\u8FD8\u6CA1\u6709\u8D26\u6237" }, visible.map((account, index) => /* @__PURE__ */ import_react3.default.createElement("tr", { key: account.id || index }, /* @__PURE__ */ import_react3.default.createElement("td", null, /* @__PURE__ */ import_react3.default.createElement("span", { className: "credit-hub__cell-main" }, account.label || `\u8D26\u6237${index + 1}`)), /* @__PURE__ */ import_react3.default.createElement("td", null, text(account.platform)), /* @__PURE__ */ import_react3.default.createElement("td", null, /* @__PURE__ */ import_react3.default.createElement(Check2, { ariaLabel: `${account.label || `\u8D26\u6237${index + 1}`} \xB7 \u6A21\u578B\u8C03\u7528`, checked: account.inferenceEnabled !== false, disabled: busy, onChange: (event) => update(account, { inferenceEnabled: event.target.checked }) }, account.inferenceEnabled !== false ? "\u53C2\u4E0E\u8C03\u7528" : "\u5DF2\u505C\u7528")), /* @__PURE__ */ import_react3.default.createElement("td", null, /* @__PURE__ */ import_react3.default.createElement(Check2, { ariaLabel: `${account.label || `\u8D26\u6237${index + 1}`} \xB7 \u8D26\u6237\u72B6\u6001`, checked: account.enabled !== false, disabled: busy, onChange: (event) => update(account, { enabled: event.target.checked }) }, account.enabled !== false ? "\u542F\u7528" : "\u505C\u7528")), /* @__PURE__ */ import_react3.default.createElement("td", null, /* @__PURE__ */ import_react3.default.createElement("span", { className: "credit-hub__cell-detail" }, { file: "\u72EC\u7ACB\u6587\u4EF6\u5FEB\u7167", desktop: "\u5BA2\u6237\u7AEF\u5FEB\u7167", "api-key": "API Key" }[account.credentialMode] || text(account.credentialMode, "\u672C\u5730\u51ED\u636E")), /* @__PURE__ */ import_react3.default.createElement(Badge, { pending: account.connectionState !== "not_checked" }, accountConnectionLabel(account))), /* @__PURE__ */ import_react3.default.createElement("td", null, /* @__PURE__ */ import_react3.default.createElement(Button, { disabled: busy, "aria-label": `\u5220\u9664 ${account.label || account.platform} \u8D26\u53F7`, onClick: () => setRemoval(account) }, "\u5220\u9664\u8D26\u53F7"))))));
}
function Routes({ snapshot, busy, perform }) {
  const [query, setQuery] = (0, import_react3.useState)("");
  const routes = array(snapshot.routes).filter((route) => `${route.name} ${array(route.targets).map((target) => target.model).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  return /* @__PURE__ */ import_react3.default.createElement(import_react3.default.Fragment, null, /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react3.default.createElement("input", { className: "credit-hub__search", "aria-label": "\u641C\u7D22\u6A21\u578B\u8DEF\u7531", placeholder: "\u641C\u7D22\u8DEF\u7531\u6216\u6A21\u578B", value: query, onChange: (event) => setQuery(event.target.value) }), /* @__PURE__ */ import_react3.default.createElement(Button, { disabled: busy, onClick: () => perform("\u66F4\u65B0\u4E0A\u6E38\u6A21\u578B\u76EE\u5F55", { method: "GET", path: "/admin/model-directory?refresh=1" }) }, "\u624B\u52A8\u66F4\u65B0\u6A21\u578B\u76EE\u5F55"), /* @__PURE__ */ import_react3.default.createElement(Button, { disabled: busy, onClick: () => perform("\u542F\u52A8\u5DF2\u5BFC\u5165\u6A21\u578B\u4F53\u68C0", { method: "POST", path: "/admin/model-tests", body: { scope: "imported" } }) }, "\u4F53\u68C0\u5DF2\u5BFC\u5165\u6A21\u578B")), /* @__PURE__ */ import_react3.default.createElement("p", { className: "credit-hub__muted" }, "\u8DEF\u7531\u4EE5 ", /* @__PURE__ */ import_react3.default.createElement("strong", null, "credit-hub"), " \u63D0\u4F9B\u65B9\u63A5\u5165 DSH \u6A21\u578B\u9009\u62E9\u5668\u3002\u66F4\u65B0\u76EE\u5F55\u4E0E\u4F53\u68C0\u4F1A\u8BF7\u6C42\u4E0A\u6E38\uFF1B\u542F\u505C\u8DEF\u7531\u53EA\u4FEE\u6539\u72EC\u7ACB\u914D\u7F6E\u3002"), /* @__PURE__ */ import_react3.default.createElement(Table, { columns: ["\u6A21\u578B\u8DEF\u7531", "\u5019\u9009\u6A21\u578B", "\u76EE\u6807\u6570", "\u72B6\u6001"], count: routes.length, empty: "\u8FD8\u6CA1\u6709\u6A21\u578B\u8DEF\u7531" }, routes.map((route, index) => /* @__PURE__ */ import_react3.default.createElement("tr", { key: route.id || index }, /* @__PURE__ */ import_react3.default.createElement("td", null, /* @__PURE__ */ import_react3.default.createElement("span", { className: "credit-hub__cell-main" }, route.name || route.id)), /* @__PURE__ */ import_react3.default.createElement("td", null, /* @__PURE__ */ import_react3.default.createElement("span", { className: "credit-hub__cell-detail" }, array(route.targets).slice(0, 4).map((target) => target.model || target.modelId || "\u5DF2\u914D\u7F6E\u6A21\u578B").join(" / ") || "\u5C1A\u672A\u914D\u7F6E\u76EE\u6807", route.targetCount > 4 ? " \u2026" : "")), /* @__PURE__ */ import_react3.default.createElement("td", null, quantity(route.targetCount ?? array(route.targets).length)), /* @__PURE__ */ import_react3.default.createElement("td", null, /* @__PURE__ */ import_react3.default.createElement(Check2, { ariaLabel: `${route.name || route.id} \xB7 \u8DEF\u7531\u542F\u7528`, checked: route.enabled !== false, disabled: busy, onChange: (event) => perform("\u4FDD\u5B58\u8DEF\u7531\u72B6\u6001", { method: "POST", path: "/hub/routes", body: { routeId: route.id, enabled: event.target.checked } }) }, route.enabled !== false ? "\u5DF2\u542F\u7528" : "\u5DF2\u505C\u7528"))))));
}
var jobState = (value) => ({ pending: "\u7B49\u5F85\u6267\u884C", queued: "\u7B49\u5F85\u6267\u884C", running: "\u6267\u884C\u4E2D", cancelling: "\u6B63\u5728\u53D6\u6D88", cancelled: "\u5DF2\u53D6\u6D88", timed_out: "\u672C\u8F6E\u5DF2\u8D85\u65F6", completed: "\u5DF2\u5B8C\u6210", succeeded: "\u5DF2\u5B8C\u6210", failed: "\u6267\u884C\u5931\u8D25", accepted: "\u5DF2\u53D7\u7406" })[value] || text(value, "\u5DF2\u53D7\u7406");
var phaseName = (phase) => ({ queued: "\u6392\u961F", init: "\u521D\u59CB\u5316", query: "\u67E5\u8BE2\u4EFB\u52A1", accept: "\u63A5\u53D7\u4EFB\u52A1", execution: "\u6267\u884C\u4EFB\u52A1", progress_poll: "\u7B49\u5F85\u5B98\u65B9\u8FDB\u5EA6", claim: "\u9886\u53D6\u5956\u52B1", finished: "\u672C\u8F6E\u7ED3\u675F", cancelling: "\u7B49\u5F85\u53D6\u6D88\u786E\u8BA4" })[phase] || text(phase);
var taskState = (task) => task.claimed ? "\u5B98\u65B9\u5DF2\u7ED3\u7B97" : task.claimable ? "\u5B98\u65B9\u786E\u8BA4\u53EF\u9886\u53D6" : task.lastReceipt?.status === "task_accounting_pending" ? "\u7B49\u5F85\u5B98\u65B9\u5165\u8D26" : task.locked ? "\u524D\u7F6E\u6761\u4EF6\u672A\u5B8C\u6210" : task.accepted ? "\u5DF2\u63A5\u53D7\uFF0C\u5C1A\u672A\u7ED3\u7B97" : "\u5C1A\u672A\u63A5\u53D7";
function createAccountResponseGuard(initialAccount) {
  let account = initialAccount, generation = 0, active = true;
  return {
    select(next) {
      if (next !== account || !active) generation++;
      account = next;
      active = true;
    },
    capture() {
      const version = generation, selected = account;
      return () => active && version === generation && selected === account;
    },
    dispose() {
      active = false;
      generation++;
    }
  };
}
function Job({ value, accountLabel, onRefresh, onCancel, busy }) {
  if (!value) return null;
  const state = value.status || value.state || "accepted";
  const processed = value.progress?.processed ?? value.progress?.completed ?? value.completedCount ?? value.processed;
  const total = value.progress?.total ?? value.totalCount ?? value.total;
  const terminal = ["completed", "succeeded", "failed", "cancelled", "timed_out"].includes(state);
  const elapsed = Math.max(0, Math.floor((value.progress?.elapsedMs || 0) / 1e3));
  const tasks = array(value.result?.tasks || value.snapshot?.tasks);
  return /* @__PURE__ */ import_react3.default.createElement(import_react3.default.Fragment, null, /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__notice" }, /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react3.default.createElement("strong", null, accountLabel || "\u8D26\u6237\u4EFB\u52A1"), /* @__PURE__ */ import_react3.default.createElement(Badge, { active: state === "completed" || state === "succeeded", pending: !terminal }, jobState(state)), /* @__PURE__ */ import_react3.default.createElement(Button, { disabled: busy, onClick: onRefresh }, "\u5237\u65B0\u4EFB\u52A1\u8FDB\u5EA6"), !terminal && /* @__PURE__ */ import_react3.default.createElement(Button, { disabled: busy, onClick: onCancel }, "\u53D6\u6D88\u4EFB\u52A1")), /* @__PURE__ */ import_react3.default.createElement("dl", { className: "credit-hub__kv" }, /* @__PURE__ */ import_react3.default.createElement("dt", null, "\u5F53\u524D\u9636\u6BB5"), /* @__PURE__ */ import_react3.default.createElement("dd", null, value.progress?.phase ? phaseName(value.progress.phase) : text(value.stage || value.progress?.stage || value.message, terminal ? "\u4EFB\u52A1\u5DF2\u7ED3\u675F" : "\u7B49\u5F85\u4EFB\u52A1\u72B6\u6001\u66F4\u65B0")), /* @__PURE__ */ import_react3.default.createElement("dt", null, "\u5904\u7406\u8FDB\u5EA6"), /* @__PURE__ */ import_react3.default.createElement("dd", null, processed === void 0 ? "\u5C1A\u672A\u8FD4\u56DE\u8BA1\u6570" : `${quantity(processed)} / ${quantity(total)}`), /* @__PURE__ */ import_react3.default.createElement("dt", null, "\u5DF2\u7ECF\u8017\u65F6"), /* @__PURE__ */ import_react3.default.createElement("dd", null, Math.floor(elapsed / 60), " \u5206 ", elapsed % 60, " \u79D2"), /* @__PURE__ */ import_react3.default.createElement("dt", null, "\u5F00\u59CB\u65F6\u95F4"), /* @__PURE__ */ import_react3.default.createElement("dd", null, timestamp(value.startedAt || value.createdAt)), /* @__PURE__ */ import_react3.default.createElement("dt", null, "\u6700\u8FD1\u66F4\u65B0"), /* @__PURE__ */ import_react3.default.createElement("dd", null, timestamp(value.updatedAt || value.finishedAt || value.completedAt))), typeof total === "number" && total > 0 && typeof processed === "number" && /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__progress", role: "progressbar", "aria-label": "\u4EFB\u52A1\u5904\u7406\u8FDB\u5EA6", "aria-valuenow": processed, "aria-valuemin": 0, "aria-valuemax": total }, /* @__PURE__ */ import_react3.default.createElement("span", { style: { width: `${Math.min(100, Math.max(0, processed / total * 100))}%` } })), /* @__PURE__ */ import_react3.default.createElement("p", { className: "credit-hub__muted" }, "\u201C\u5DF2\u5B8C\u6210\u201D\u8868\u793A\u672C\u8F6E\u52A8\u4F5C\u7ED3\u675F\uFF0C\u79EF\u5206\u7ED3\u7B97\u5355\u72EC\u5217\u5728\u4E0B\u8868\u3002\u53D6\u6D88\u540E\uFF0C\u5DF2\u63D0\u4EA4\u52A8\u4F5C\u7EE7\u7EED\u4FDD\u7559\u5F85\u786E\u8BA4\u3002")), tasks.length > 0 && /* @__PURE__ */ import_react3.default.createElement(Table, { columns: ["\u4EFB\u52A1", "\u5B98\u65B9\u8FDB\u5EA6", "\u5956\u52B1", "\u7ED3\u7B97\u72B6\u6001"], count: tasks.length }, tasks.map((task, index) => /* @__PURE__ */ import_react3.default.createElement("tr", { key: task.taskCode || index }, /* @__PURE__ */ import_react3.default.createElement("td", null, task.title || task.name || "\u4EFB\u52A1"), /* @__PURE__ */ import_react3.default.createElement("td", null, quantity(task.current ?? task.progress), " / ", quantity(task.target)), /* @__PURE__ */ import_react3.default.createElement("td", null, text(task.reward)), /* @__PURE__ */ import_react3.default.createElement("td", null, /* @__PURE__ */ import_react3.default.createElement(Badge, { active: task.claimed, pending: !task.claimed }, taskState(task)))))));
}
function Tasks({ snapshot, busy, perform, api }) {
  const accounts = array(snapshot.accounts);
  const workbuddy = accounts.filter((account) => String(account.platform).toLowerCase().includes("workbuddy"));
  const [accountId, setAccountId] = (0, import_react3.useState)("");
  const [job, setJob] = (0, import_react3.useState)(null);
  const [jobId, setJobId] = (0, import_react3.useState)("");
  const [jobError, setJobError] = (0, import_react3.useState)("");
  const selected = workbuddy.find((account) => account.id === accountId) || workbuddy[0];
  const accountGuard = (0, import_react3.useRef)(null);
  if (!accountGuard.current) accountGuard.current = createAccountResponseGuard(selected?.id);
  accountGuard.current.select(selected?.id);
  const jobIdRef = (0, import_react3.useRef)(jobId);
  jobIdRef.current = jobId;
  (0, import_react3.useEffect)(() => {
    const id = selected?.id;
    accountGuard.current.select(id);
    const isCurrent = accountGuard.current.capture();
    const controller = new AbortController();
    const cached = id ? api.taskState?.get(id) : null;
    setJob(cached?.job || null);
    setJobId(cached?.jobId || "");
    setJobError("");
    if (id) api.request({ method: "GET", path: `/admin/workbuddy/task-jobs?accountId=${encodeURIComponent(id)}` }, controller.signal).then((response) => {
      if (!isCurrent()) return;
      const running = response.body?.job;
      if (running?.jobId) {
        setJob(running);
        setJobId(running.jobId);
      }
    }, (failure) => {
      if (isCurrent() && !controller.signal.aborted) setJobError(failure.message);
    });
    return () => {
      controller.abort();
      accountGuard.current.dispose();
    };
  }, [api, selected?.id]);
  (0, import_react3.useEffect)(() => {
    if (jobId && job?.accountId) api.taskState?.set(job.accountId, { job, jobId });
  }, [api, job, jobId]);
  const refreshJob = (0, import_react3.useCallback)(async () => {
    if (!jobId) return;
    const isCurrent = accountGuard.current.capture();
    const requestedJob = jobId;
    try {
      const result = await api.request({ method: "GET", path: `/admin/workbuddy/task-jobs/${encodeURIComponent(requestedJob)}` });
      if (!isCurrent() || jobIdRef.current !== requestedJob) return;
      setJob(result.body?.job || result.body);
      setJobError("");
    } catch (error) {
      if (isCurrent() && jobIdRef.current === requestedJob) setJobError(error.message);
    }
  }, [api, jobId]);
  (0, import_react3.useEffect)(() => {
    const state = job?.status || job?.state;
    if (!jobId || ["completed", "succeeded", "failed", "cancelled", "timed_out"].includes(state)) return;
    const timer = setInterval(refreshJob, 3e3);
    return () => clearInterval(timer);
  }, [refreshJob, jobId, job?.status, job?.state]);
  const action = async (kind) => {
    const isCurrent = accountGuard.current.capture();
    const origin = selected;
    const ok = await perform(`${origin?.label || "WorkBuddy"} \xB7 ${kind === "query" ? "\u67E5\u8BE2\u4EFB\u52A1" : kind === "run" ? "\u6267\u884C\u4EFB\u52A1" : "\u9886\u53D6\u4EFB\u52A1"}`, { method: "POST", path: "/admin/workbuddy/task-jobs", body: { ...origin ? { accountId: origin.id } : {}, action: kind } }, (response) => {
      if (!isCurrent()) return;
      const body = response.body;
      const next = body?.job || body;
      const id = body?.jobId || next?.id || next?.jobId;
      if (id) {
        setJobId(id);
        setJob(next);
      }
    });
    return ok;
  };
  const cancel = () => {
    const isCurrent = accountGuard.current.capture();
    const requestedJob = jobId;
    return perform(`${selected?.label || "WorkBuddy"} \xB7 \u53D6\u6D88\u4EFB\u52A1`, { method: "POST", path: `/admin/workbuddy/task-jobs/${encodeURIComponent(requestedJob)}/cancel`, body: {} }, (response) => {
      if (isCurrent() && jobIdRef.current === requestedJob) setJob(response.body?.job || response.body);
    });
  };
  return /* @__PURE__ */ import_react3.default.createElement(import_react3.default.Fragment, null, /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__notice" }, /* @__PURE__ */ import_react3.default.createElement("strong", null, "\u81EA\u52A8\u6392\u7A0B", snapshot.schedulerRunning || snapshot.schedule?.settings?.enabled ? "\u5DF2\u542F\u7528" : "\u672A\u542F\u7528"), /* @__PURE__ */ import_react3.default.createElement("p", { className: "credit-hub__muted" }, "\u672C\u6B21\u9884\u89C8\u9ED8\u8BA4\u5173\u95ED\u81EA\u52A8\u7B7E\u5230\u548C\u4EFB\u52A1\u3002\u8FDB\u5165\u6B64\u9875\u9762\u53EA\u8BFB\u53D6\u7F13\u5B58\uFF1B\u4E0B\u65B9\u6309\u94AE\u5206\u522B\u53D1\u8D77\u660E\u786E\u7684\u4E0A\u6E38\u64CD\u4F5C\u3002")), /* @__PURE__ */ import_react3.default.createElement(SchedulerControls, { snapshot, busy, perform }), /* @__PURE__ */ import_react3.default.createElement("h2", null, "\u7B7E\u5230"), /* @__PURE__ */ import_react3.default.createElement("p", { className: "credit-hub__muted" }, "\u624B\u52A8\u7B7E\u5230\u4F7F\u7528\u5DF2\u5BFC\u5165\u8D26\u6237\uFF1B\u6A21\u578B\u8C03\u7528\u505C\u7528\u72B6\u6001\u4E0D\u5F71\u54CD\u7B7E\u5230\u8D44\u683C\u3002"), /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react3.default.createElement(Button, { primary: true, disabled: busy || !accounts.length, onClick: () => perform("\u6267\u884C\u5168\u90E8\u8D26\u6237\u7B7E\u5230", { method: "POST", path: "/admin/claim", body: {} }) }, "\u5168\u90E8\u8D26\u6237\u7B7E\u5230")), /* @__PURE__ */ import_react3.default.createElement("h2", null, "WorkBuddy \u4EFB\u52A1"), /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react3.default.createElement("select", { "aria-label": "\u9009\u62E9 WorkBuddy \u8D26\u6237", value: selected?.id || "", disabled: !workbuddy.length, onChange: (event) => setAccountId(event.target.value) }, workbuddy.length ? workbuddy.map((account) => /* @__PURE__ */ import_react3.default.createElement("option", { key: account.id, value: account.id }, account.label)) : /* @__PURE__ */ import_react3.default.createElement("option", { value: "" }, "\u5C1A\u65E0 WorkBuddy \u8D26\u6237")), /* @__PURE__ */ import_react3.default.createElement(Button, { disabled: busy || !selected, onClick: () => action("query") }, "\u67E5\u8BE2\u4EFB\u52A1"), /* @__PURE__ */ import_react3.default.createElement(Button, { primary: true, disabled: busy || !selected, onClick: () => action("run") }, "\u6267\u884C\u4EFB\u52A1"), /* @__PURE__ */ import_react3.default.createElement(Button, { disabled: busy || !selected, onClick: () => action("claim") }, "\u9886\u53D6\u5DF2\u5B8C\u6210\u4EFB\u52A1")), jobError && /* @__PURE__ */ import_react3.default.createElement("div", { role: "alert", className: "credit-hub__notice credit-hub__notice--error" }, jobError), /* @__PURE__ */ import_react3.default.createElement(Job, { value: job, accountLabel: selected?.label, onRefresh: refreshJob, busy, onCancel: cancel }), /* @__PURE__ */ import_react3.default.createElement("h2", null, "\u6700\u8FD1\u7B7E\u5230\u8BB0\u5F55"), /* @__PURE__ */ import_react3.default.createElement(RecordTable, { records: array(snapshot.records).filter((record) => /claim|checkin|签到/i.test(`${record.type} ${record.action} ${record.kind} ${record.task}`)).slice(0, 20), empty: "\u5C1A\u65E0\u7B7E\u5230\u8BB0\u5F55" }));
}
function RecordTable({ records, empty }) {
  return /* @__PURE__ */ import_react3.default.createElement(Table, { columns: ["\u65F6\u95F4", "\u64CD\u4F5C", "\u5E73\u53F0 / \u6A21\u578B", "\u7ED3\u679C"], count: records.length, empty }, records.map((record, index) => /* @__PURE__ */ import_react3.default.createElement("tr", { key: index }, /* @__PURE__ */ import_react3.default.createElement("td", null, timestamp(record.at || record.time || record.timestamp || record.startedAt || record.createdAt)), /* @__PURE__ */ import_react3.default.createElement("td", null, text(record.action || record.task || record.type || record.kind, "\u8BF7\u6C42")), /* @__PURE__ */ import_react3.default.createElement("td", null, /* @__PURE__ */ import_react3.default.createElement("span", { className: "credit-hub__cell-main" }, text(record.model || record.platform || record.routeName))), /* @__PURE__ */ import_react3.default.createElement("td", null, text(record.status || record.outcome || record.result?.status, record.ok === true ? "\u6210\u529F" : record.ok === false ? "\u5931\u8D25" : "\u5DF2\u8BB0\u5F55")))));
}
function Usage({ snapshot, busy, perform }) {
  const [range, setRange] = (0, import_react3.useState)("24h");
  const [activity, setActivity] = (0, import_react3.useState)(null);
  const records = activity ? array(activity.records || activity.events || activity.items || activity) : array(snapshot.usage?.records);
  const usage = activity?.usage || activity?.kpis || snapshot.usage || {};
  const known = records.map((record) => Number.isFinite(record.totalTokens) ? record.totalTokens : Number.isFinite(record.inputTokens) && Number.isFinite(record.outputTokens) ? record.inputTokens + record.outputTokens : null).filter(Number.isFinite);
  const knownTokens = usage.knownTokens ?? (known.length ? known.reduce((sum, value) => sum + value, 0) : void 0);
  return /* @__PURE__ */ import_react3.default.createElement(import_react3.default.Fragment, null, /* @__PURE__ */ import_react3.default.createElement(ForecastPanel, { snapshot, busy, perform }), /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react3.default.createElement("select", { "aria-label": "\u8BB0\u5F55\u65F6\u95F4\u8303\u56F4", value: range, onChange: (event) => setRange(event.target.value) }, /* @__PURE__ */ import_react3.default.createElement("option", { value: "24h" }, "\u6700\u8FD1 24 \u5C0F\u65F6"), /* @__PURE__ */ import_react3.default.createElement("option", { value: "7d" }, "\u6700\u8FD1 7 \u5929"), /* @__PURE__ */ import_react3.default.createElement("option", { value: "30d" }, "\u6700\u8FD1 30 \u5929"), /* @__PURE__ */ import_react3.default.createElement("option", { value: "all" }, "\u5168\u90E8\u8BB0\u5F55")), /* @__PURE__ */ import_react3.default.createElement(Button, { disabled: busy, onClick: () => perform("\u8BFB\u53D6\u672C\u5730\u8BF7\u6C42\u8BB0\u5F55", { method: "GET", path: `/hub/activity?range=${range}` }, (response) => setActivity(response.body)) }, "\u8BFB\u53D6\u8BB0\u5F55")), /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__summary" }, /* @__PURE__ */ import_react3.default.createElement("span", null, "\u5DF2\u8FD4\u56DE tokens ", /* @__PURE__ */ import_react3.default.createElement("strong", null, quantity(knownTokens))), /* @__PURE__ */ import_react3.default.createElement("span", null, "\u4F30\u7B97\u8F93\u5165 tokens ", /* @__PURE__ */ import_react3.default.createElement("strong", null, quantity(usage.estimatedInputTokens))), /* @__PURE__ */ import_react3.default.createElement("span", null, "\u8BF7\u6C42\u6570 ", /* @__PURE__ */ import_react3.default.createElement("strong", null, quantity(usage.requests ?? usage.requestCount ?? usage.total ?? records.length)))), /* @__PURE__ */ import_react3.default.createElement(RecordTable, { records: records.slice(0, 100), empty: "\u5C1A\u65E0\u8BF7\u6C42\u8BB0\u5F55" }), /* @__PURE__ */ import_react3.default.createElement("p", { className: "credit-hub__muted" }, "\u8BB0\u5F55\u6765\u81EA\u72EC\u7ACB\u672C\u5730\u8D26\u672C\uFF0C\u8BFB\u53D6\u8BB0\u5F55\u4E0D\u8BF7\u6C42\u4E0A\u6E38\u3002", activity ? "\u7EDF\u8BA1\u6309\u6240\u9009\u65F6\u95F4\u8303\u56F4\u6C47\u603B\uFF1B" : "Token \u7EDF\u8BA1\u4EC5\u6C47\u603B\u5F53\u524D\u6700\u591A 100 \u6761\u8BB0\u5F55\uFF1B", "\u5DF2\u8FD4\u56DE Token \u4E0E\u4F30\u7B97\u8F93\u5165\u5206\u5F00\u663E\u793A\uFF0C\u7F3A\u5C11\u6D4B\u91CF\u65F6\u663E\u793A\u201C\u2014\u201D\u3002"));
}
function Relay({ snapshot, busy, perform }) {
  const relay = snapshot.relay || {};
  const settings = relay.settings || relay.config || relay;
  const [enabled, setEnabled] = (0, import_react3.useState)(!!settings.enabled);
  const [reservePercent, setReservePercent] = (0, import_react3.useState)(settings.reservePercent ?? "");
  const [reserveCredits, setReserveCredits] = (0, import_react3.useState)(settings.reserveCredits ?? "");
  const [dirty, setDirty] = (0, import_react3.useState)(false);
  const touch = (setter) => (event) => {
    setter(event.target.type === "checkbox" ? event.target.checked : event.target.value);
    setDirty(true);
  };
  const save = () => {
    const body = { enabled };
    if (reservePercent !== "") body.reservePercent = Number(reservePercent);
    if (reserveCredits !== "") body.reserveCredits = Number(reserveCredits);
    perform("\u4FDD\u5B58\u63A5\u529B\u7B56\u7565", { method: "POST", path: "/admin/model-relay", body }).then((ok) => {
      if (ok) setDirty(false);
    });
  };
  return /* @__PURE__ */ import_react3.default.createElement(import_react3.default.Fragment, null, /* @__PURE__ */ import_react3.default.createElement("p", { className: "credit-hub__muted" }, "\u63A5\u529B\u53EA\u5728\u72EC\u7ACB\u7684\u79EF\u5206\u4E2D\u67A2\u8D26\u6237\u6C60\u5185\u9009\u62E9\u540C\u4E00\u6A21\u578B\u5019\u9009\u3002\u5B8C\u6574\u6D88\u606F\u3001\u5DE5\u5177\u4E0E\u8F93\u51FA\u9884\u7B97\u968F\u8BF7\u6C42\u4FDD\u7559\u3002"), /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__form" }, /* @__PURE__ */ import_react3.default.createElement("label", { htmlFor: "hub-relay-enabled" }, "\u81EA\u52A8\u63A5\u529B"), /* @__PURE__ */ import_react3.default.createElement(Check2, { checked: enabled, disabled: busy, onChange: touch(setEnabled) }, "\u542F\u7528\u8D26\u6237\u63A5\u529B"), /* @__PURE__ */ import_react3.default.createElement("label", { htmlFor: "hub-reserve-percent" }, "\u4FDD\u7559\u79EF\u5206\u6BD4\u4F8B\uFF08%\uFF09"), /* @__PURE__ */ import_react3.default.createElement("input", { id: "hub-reserve-percent", type: "number", min: "0", max: "50", value: reservePercent, placeholder: "\u6CBF\u7528\u73B0\u6709\u503C", onChange: touch(setReservePercent) }), /* @__PURE__ */ import_react3.default.createElement("label", { htmlFor: "hub-reserve-credits" }, "\u4FDD\u7559\u79EF\u5206\u6570\u91CF"), /* @__PURE__ */ import_react3.default.createElement("input", { id: "hub-reserve-credits", type: "number", min: "0", max: "100000", value: reserveCredits, placeholder: "\u6CBF\u7528\u73B0\u6709\u503C", onChange: touch(setReserveCredits) }), /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__wide" }, /* @__PURE__ */ import_react3.default.createElement(Button, { primary: true, disabled: busy || !dirty, onClick: save }, "\u4FDD\u5B58\u7B56\u7565"))), /* @__PURE__ */ import_react3.default.createElement("h2", null, "\u8FD0\u884C\u72B6\u6001"), /* @__PURE__ */ import_react3.default.createElement("dl", { className: "credit-hub__kv" }, /* @__PURE__ */ import_react3.default.createElement("dt", null, "\u72EC\u7ACB\u5F15\u64CE"), /* @__PURE__ */ import_react3.default.createElement("dd", null, /* @__PURE__ */ import_react3.default.createElement(Badge, { active: !!snapshot.worker?.pid }, snapshot.worker?.pid ? "\u8FD0\u884C\u4E2D" : "\u7B49\u5F85\u8FDE\u63A5")), /* @__PURE__ */ import_react3.default.createElement("dt", null, "\u8DEF\u7531\u5019\u9009"), /* @__PURE__ */ import_react3.default.createElement("dd", null, quantity(snapshot.counts?.routes), " \u6761\u8DEF\u7531"), /* @__PURE__ */ import_react3.default.createElement("dt", null, "\u81EA\u52A8\u8C03\u5EA6"), /* @__PURE__ */ import_react3.default.createElement("dd", null, snapshot.schedulerRunning ? "\u5DF2\u542F\u7528" : "\u5DF2\u5173\u95ED")));
}
function Settings({ snapshot, busy, perform }) {
  const current = snapshot.schedule?.settings || {};
  const [enabled, setEnabled] = (0, import_react3.useState)(!!current.enabled);
  const [hour, setHour] = (0, import_react3.useState)(current.hour ?? 9);
  const [minute, setMinute] = (0, import_react3.useState)(current.minute ?? 0);
  const [timezone, setTimezone] = (0, import_react3.useState)(current.timezone || "Asia/Shanghai");
  const [dirty, setDirty] = (0, import_react3.useState)(false);
  const change = (setter) => (event) => {
    setter(event.target.type === "checkbox" ? event.target.checked : event.target.value);
    setDirty(true);
  };
  return /* @__PURE__ */ import_react3.default.createElement(import_react3.default.Fragment, null, /* @__PURE__ */ import_react3.default.createElement("h2", null, "\u72EC\u7ACB\u6392\u7A0B"), /* @__PURE__ */ import_react3.default.createElement("p", { className: "credit-hub__muted" }, "\u8BBE\u7F6E\u4EC5\u4FDD\u5B58\u5230\u79EF\u5206\u4E2D\u67A2\u7684\u65B0\u76EE\u5F55\uFF0C\u4E0D\u6539\u53D8\u539F AI \u7F51\u5173\u4E0E\u539F DSH \u7684\u6392\u7A0B\u3002"), /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__form" }, /* @__PURE__ */ import_react3.default.createElement("label", null, "\u81EA\u52A8\u7B7E\u5230\u4E0E\u4EFB\u52A1"), /* @__PURE__ */ import_react3.default.createElement(Check2, { checked: enabled, disabled: busy, onChange: change(setEnabled) }, "\u542F\u7528\u6BCF\u65E5\u81EA\u52A8\u6392\u7A0B"), /* @__PURE__ */ import_react3.default.createElement("label", { htmlFor: "hub-timezone" }, "\u65F6\u533A"), /* @__PURE__ */ import_react3.default.createElement("input", { id: "hub-timezone", value: timezone, onChange: change(setTimezone) }), /* @__PURE__ */ import_react3.default.createElement("label", { htmlFor: "hub-hour" }, "\u6267\u884C\u65F6\u523B"), /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__toolbar" }, /* @__PURE__ */ import_react3.default.createElement("input", { id: "hub-hour", type: "number", min: "0", max: "23", "aria-label": "\u6267\u884C\u5C0F\u65F6", value: hour, onChange: change(setHour) }), /* @__PURE__ */ import_react3.default.createElement("span", null, "\u65F6"), /* @__PURE__ */ import_react3.default.createElement("input", { type: "number", min: "0", max: "59", "aria-label": "\u6267\u884C\u5206\u949F", value: minute, onChange: change(setMinute) }), /* @__PURE__ */ import_react3.default.createElement("span", null, "\u5206")), /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__wide" }, /* @__PURE__ */ import_react3.default.createElement(Button, { primary: true, disabled: busy || !dirty, onClick: () => perform("\u4FDD\u5B58\u72EC\u7ACB\u6392\u7A0B", { method: "POST", path: "/hub/scheduler", body: { enabled, hour: Number(hour), minute: Number(minute), timezone } }).then((ok) => {
    if (ok) setDirty(false);
  }) }, "\u4FDD\u5B58\u6392\u7A0B"))), /* @__PURE__ */ import_react3.default.createElement(NotificationSettings, { snapshot, busy, perform }), /* @__PURE__ */ import_react3.default.createElement(UpdatePanel, { snapshot, busy, perform }), /* @__PURE__ */ import_react3.default.createElement("h2", null, "\u7248\u672C\u517C\u5BB9\u72B6\u6001"), /* @__PURE__ */ import_react3.default.createElement("p", { className: "credit-hub__muted" }, snapshot.compatibility?.mode === "native-provider" ? "\u539F\u751F\u6A21\u578B\u63D0\u4F9B\u65B9\u5DF2\u6CE8\u518C" : snapshot.compatibility?.mode === "management-only" ? "\u5F53\u524D\u5BBF\u4E3B\u4F7F\u7528\u7BA1\u7406\u9875\u6A21\u5F0F\uFF1B\u6A21\u578B\u670D\u52A1\u63A5\u53E3\u672A\u5C31\u7EEA" : "\u517C\u5BB9\u5C42\u968F\u5BBF\u4E3B\u80FD\u529B\u542F\u7528", "\u3002\u65E7\u7248\u6CA1\u6709\u4FA7\u680F\u4E3B\u9762\u677F\u65F6\uFF0C\u4ECE\u8BBE\u7F6E\u4E2D\u7684\u201C\u79EF\u5206\u4E2D\u67A2\u201D\u8FDB\u5165\u3002"), /* @__PURE__ */ import_react3.default.createElement("h2", null, "\u672C\u5730\u9884\u89C8"), /* @__PURE__ */ import_react3.default.createElement("dl", { className: "credit-hub__kv" }, /* @__PURE__ */ import_react3.default.createElement("dt", null, "\u63D2\u4EF6"), /* @__PURE__ */ import_react3.default.createElement("dd", null, "\u79EF\u5206\u4E2D\u67A2 ", text(snapshot.pluginVersion)), /* @__PURE__ */ import_react3.default.createElement("dt", null, "\u72EC\u7ACB\u5F15\u64CE\u7248\u672C"), /* @__PURE__ */ import_react3.default.createElement("dd", null, text(snapshot.version)), /* @__PURE__ */ import_react3.default.createElement("dt", null, "\u6A21\u578B\u63D0\u4F9B\u65B9"), /* @__PURE__ */ import_react3.default.createElement("dd", null, "credit-hub"), /* @__PURE__ */ import_react3.default.createElement("dt", null, "\u8FD0\u884C\u65F6"), /* @__PURE__ */ import_react3.default.createElement("dd", null, "Node ", text(snapshot.worker?.nodeVersion)), /* @__PURE__ */ import_react3.default.createElement("dt", null, "\u6700\u65B0\u5FEB\u7167"), /* @__PURE__ */ import_react3.default.createElement("dd", null, timestamp(snapshot.checkedAt)), /* @__PURE__ */ import_react3.default.createElement("dt", null, "\u81EA\u52A8\u53D1\u5E03"), /* @__PURE__ */ import_react3.default.createElement("dd", null, "\u672A\u542F\u7528\uFF1B\u5F53\u524D\u4EC5\u672C\u5730\u9884\u89C8")));
}
function receipt(response) {
  const body = response?.body || {};
  const job = body.job || body;
  const state = job.status || job.state;
  const message = typeof body.message === "string" ? body.message.slice(0, 250) : "";
  return { accepted: response?.status === 202, status: response?.status, state: state ? jobState(state) : null, message };
}
function HubView({ api }) {
  const [tab, setTab] = (0, import_react3.useState)("accounts");
  const [snapshot, setSnapshot] = (0, import_react3.useState)(null);
  const [loading, setLoading] = (0, import_react3.useState)(true);
  const [error, setError] = (0, import_react3.useState)("");
  const [busy, setBusy] = (0, import_react3.useState)("");
  const [result, setResult] = (0, import_react3.useState)(null);
  const alive = (0, import_react3.useRef)(true);
  const tabId = (0, import_react3.useId)();
  const refresh = (0, import_react3.useCallback)(async () => {
    setLoading(true);
    try {
      const next = await api.snapshot();
      if (alive.current) {
        setSnapshot(next);
        setError("");
      }
    } catch (failure) {
      if (alive.current) setError(failure.message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [api]);
  (0, import_react3.useEffect)(() => {
    alive.current = true;
    refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  const perform = (0, import_react3.useCallback)(async (label, input, onResult) => {
    setBusy(label);
    setError("");
    try {
      const response = await api.request(input);
      if (!alive.current) return false;
      onResult?.(response);
      setResult({ label, ...receipt(response), at: Date.now() });
      await refresh();
      return true;
    } catch (failure) {
      if (alive.current) setError(`${label}\uFF1A${failure.message}`);
      return false;
    } finally {
      if (alive.current) setBusy("");
    }
  }, [api, refresh]);
  const props = { snapshot: snapshot || {}, api, busy: !!busy, perform };
  const panels = { accounts: Accounts, routes: Routes, tasks: Tasks, usage: Usage, relay: Relay, settings: Settings };
  const Panel = panels[tab];
  const changeTab = (event, index) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[next][0]);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
  };
  return /* @__PURE__ */ import_react3.default.createElement("section", { className: "credit-hub", "aria-label": "\u79EF\u5206\u4E2D\u67A2" }, /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__inner" }, /* @__PURE__ */ import_react3.default.createElement("header", { className: "credit-hub__header" }, /* @__PURE__ */ import_react3.default.createElement("div", null, /* @__PURE__ */ import_react3.default.createElement("h1", null, "\u79EF\u5206\u4E2D\u67A2"), /* @__PURE__ */ import_react3.default.createElement("p", { className: "credit-hub__muted" }, "\u8D26\u6237\u3001\u6A21\u578B\u4E0E\u4EFB\u52A1\uFF0C\u5728 DSH \u5185\u7EDF\u4E00\u7BA1\u7406\u3002")), /* @__PURE__ */ import_react3.default.createElement(Button, { disabled: loading || !!busy, onClick: refresh }, loading ? "\u8BFB\u53D6\u4E2D\u2026" : "\u5237\u65B0\u672C\u5730\u5FEB\u7167")), snapshot && /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__summary" }, /* @__PURE__ */ import_react3.default.createElement("span", null, "\u8D26\u6237", /* @__PURE__ */ import_react3.default.createElement("strong", null, quantity(snapshot.counts?.accounts))), /* @__PURE__ */ import_react3.default.createElement("span", null, "\u5E73\u53F0", /* @__PURE__ */ import_react3.default.createElement("strong", null, quantity(snapshot.counts?.platforms))), /* @__PURE__ */ import_react3.default.createElement("span", null, "\u542F\u7528\u8DEF\u7531", /* @__PURE__ */ import_react3.default.createElement("strong", null, quantity(snapshot.counts?.enabledRoutes), " / ", quantity(snapshot.counts?.routes))), /* @__PURE__ */ import_react3.default.createElement("span", null, "\u72EC\u7ACB\u9884\u89C8 \xB7 ", snapshot.schedulerRunning ? "\u81EA\u52A8\u6392\u7A0B\u5DF2\u542F\u7528" : "\u81EA\u52A8\u6392\u7A0B\u5173\u95ED")), /* @__PURE__ */ import_react3.default.createElement("div", { role: "tablist", className: "credit-hub__tabs", "aria-label": "\u79EF\u5206\u4E2D\u67A2\u9875\u9762" }, tabs.map(([key, label], index) => /* @__PURE__ */ import_react3.default.createElement("button", { key, id: `${tabId}-tab-${key}`, role: "tab", className: "credit-hub__tab", "aria-selected": tab === key, "aria-controls": `${tabId}-panel`, tabIndex: tab === key ? 0 : -1, onClick: () => setTab(key), onKeyDown: (event) => changeTab(event, index) }, label))), error && /* @__PURE__ */ import_react3.default.createElement("div", { className: "credit-hub__notice credit-hub__notice--error", role: "alert" }, error, " ", /* @__PURE__ */ import_react3.default.createElement("button", { type: "button", className: "credit-hub__text-button", onClick: refresh }, "\u91CD\u65B0\u8FDE\u63A5")), busy && /* @__PURE__ */ import_react3.default.createElement("div", { role: "status", "aria-live": "polite", className: "credit-hub__notice" }, busy, "\u2026 \u6B63\u5728\u7B49\u5F85\u64CD\u4F5C\u7ED3\u679C\u3002"), /* @__PURE__ */ import_react3.default.createElement("div", { id: `${tabId}-panel`, role: "tabpanel", "aria-labelledby": `${tabId}-tab-${tab}`, "aria-busy": loading && !snapshot }, !snapshot ? /* @__PURE__ */ import_react3.default.createElement(Empty, { title: loading ? "\u6B63\u5728\u8BFB\u53D6\u72EC\u7ACB\u5F15\u64CE\u5FEB\u7167" : "\u5C1A\u672A\u8FDE\u63A5\u79EF\u5206\u4E2D\u67A2" }, loading ? "\u9996\u6B21\u8F7D\u5165\u53EA\u8BFB\u672C\u5730\u8D26\u6237\u4E0E\u8DEF\u7531\uFF0C\u4E0D\u8BF7\u6C42\u4E0A\u6E38\u3002" : "\u70B9\u51FB\u91CD\u65B0\u8FDE\u63A5\u4EE5\u91CD\u8BD5\u3002") : /* @__PURE__ */ import_react3.default.createElement(Panel, { key: tab, ...props })), result && /* @__PURE__ */ import_react3.default.createElement("aside", { className: "credit-hub__result", "aria-live": "polite" }, /* @__PURE__ */ import_react3.default.createElement("h2", null, "\u6700\u8FD1\u64CD\u4F5C"), /* @__PURE__ */ import_react3.default.createElement("p", null, /* @__PURE__ */ import_react3.default.createElement("strong", null, result.label), " \xB7 ", result.accepted ? "\u5DF2\u53D7\u7406\uFF0C\u7B49\u5F85\u6267\u884C\u7ED3\u679C" : result.state || "\u64CD\u4F5C\u5DF2\u8FD4\u56DE"), result.message && /* @__PURE__ */ import_react3.default.createElement("p", { className: "credit-hub__muted" }, result.message), /* @__PURE__ */ import_react3.default.createElement("span", { className: "credit-hub__muted" }, timestamp(result.at), " \xB7 HTTP ", result.status))));
}
function apply(ctx) {
  const api = createCreditHubApi(ctx);
  ctx.effect(() => installNativeNotifications({ api, onOpen: () => ctx.layout?.selectPanel?.(PANEL) }), "credit-hub: global event notifications");
  ctx.effect(() => {
    const element = document.createElement("style");
    element.dataset.creditHub = "styles";
    element.textContent = styles;
    document.head.append(element);
    return () => element.remove();
  }, "credit-hub: native styles");
  const render = () => /* @__PURE__ */ import_react3.default.createElement(HubView, { api });
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: PANEL }, render));
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: PANEL, order: 25, label: () => "\u79EF\u5206\u4E2D\u67A2" }, (owner) => /* @__PURE__ */ import_react3.default.createElement(Icon, { size: owner?.size || 18 })));
  ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: PANEL, order: 46, label: () => "\u79EF\u5206\u4E2D\u67A2" }, render));
  ctx.effect(() => () => {
    if (ctx.layout?.panelInfo?.getSnapshot()?.activePanelId === PANEL) ctx.layout?.selectPanel?.(null);
  }, "credit-hub: panel cleanup");
}

return module.exports;}});
