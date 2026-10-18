// vendor/workbuddy/upstream.ts
var CN_CHAT_BASE = "https://copilot.tencent.com";
var CN_BILLING_BASE = "https://www.codebuddy.cn";
var GLOBAL_BASE = "https://www.workbuddy.ai";
var MODELS_CATALOG_PATH = "/v2/enterprises/personal/models";
var GLOBAL_CONFIG_PATH = "/v3/config";
var CLIENT_UA = "CLI/2.63.2 CodeBuddy/2.63.2";
var DESKTOP_UA = "WorkBuddy/5.5.2";
var JSON_TIMEOUT_MS = 3e4;
var ERROR_BODY_LIMIT = 4096;
var PROBE_TIMEOUT_MS = 1e4;
var HARD_CREDIT_MARKERS = [
  "insufficient credit",
  "no credit",
  "credit exhausted",
  "out of credit",
  "quota exceeded",
  "quota exhaust",
  "payment required",
  "credit not enough",
  "not enough credit",
  "\u79EF\u5206\u4E0D\u8DB3",
  "\u989D\u5EA6\u4E0D\u8DB3",
  "\u4F59\u989D\u4E0D\u8DB3",
  "\u79EF\u5206\u7528\u5B8C",
  "\u989D\u5EA6\u7528\u5C3D",
  "\u6CA1\u6709\u79EF\u5206"
];
var SESSION_DEAD_MARKERS = ["Offline user session not found", "12153"];
var POLICY_REJECT_MARKERS = ["request illegal", '"code":11140'];
function classifyUpstreamError(status, body) {
  if (status === 402) return "hard_credit";
  const lower = body.toLowerCase();
  for (const marker of HARD_CREDIT_MARKERS) {
    if (lower.includes(marker.toLowerCase()) || body.includes(marker)) return "hard_credit";
  }
  for (const marker of SESSION_DEAD_MARKERS) {
    if (body.includes(marker)) return "session_dead";
  }
  for (const marker of POLICY_REJECT_MARKERS) {
    if (body.includes(marker)) return "policy_reject";
  }
  if (status === 429) return "soft_rate";
  if (status === 404) return "not_found";
  if (status >= 500) return "server";
  if (status >= 400) return "client";
  return "client";
}
function parseUpstreamErrorDetail(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return void 0;
  }
  if (typeof parsed !== "object" || parsed === null) return void 0;
  const raw = parsed;
  let displayMsg;
  const display = raw.displayMsg;
  if (typeof display === "string") {
    displayMsg = display;
  } else if (typeof display === "object" && display !== null) {
    const localized = display;
    const pick = localized.zh ?? localized.en;
    if (typeof pick === "string") displayMsg = pick;
  }
  if (displayMsg === void 0 && typeof raw.msg === "string") displayMsg = raw.msg;
  const detail = {};
  if (typeof raw.code === "number") detail.upstreamCode = raw.code;
  if (typeof raw.requestId === "string") detail.requestId = raw.requestId;
  if (displayMsg !== void 0) detail.displayMsg = displayMsg;
  return detail;
}
function regionOf(domain) {
  const lowered = domain.trim().toLowerCase();
  if (lowered === "workbuddy.ai" || lowered.endsWith(".workbuddy.ai")) return "global";
  if (lowered === "codebuddy.ai" || lowered.endsWith(".codebuddy.ai")) return "global";
  return "cn";
}
function globalBase(domain) {
  const lowered = domain.trim().toLowerCase();
  if (lowered === "codebuddy.ai" || lowered.endsWith(".codebuddy.ai")) return "https://www.codebuddy.ai";
  return GLOBAL_BASE;
}
function chatBase(credential) {
  return regionOf(credential.domain) === "global" ? globalBase(credential.domain) : CN_CHAT_BASE;
}
function billingBase(credential) {
  return regionOf(credential.domain) === "global" ? globalBase(credential.domain) : CN_BILLING_BASE;
}
function originReferer(credential) {
  return regionOf(credential.domain) === "global" ? globalBase(credential.domain) : CN_BILLING_BASE;
}
function commonHeaders(credential) {
  return {
    "Accept": "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": originReferer(credential),
    "Referer": `${originReferer(credential)}/`,
    "User-Agent": CLIENT_UA
  };
}
function chatHeaders(credential) {
  const headers = {
    ...commonHeaders(credential),
    "Content-Type": "application/json",
    // 安全红线：chat 请求绝不携带 refresh token。
    ...credential.uid === "" ? { "X-No-User-Id": "1" } : { "X-User-Id": credential.uid },
    ...credential.enterpriseId === void 0 || credential.enterpriseId === "" ? { "X-No-Enterprise-Id": "1" } : { "X-Enterprise-Id": credential.enterpriseId },
    ...credential.domain === "" ? { "X-No-Department-Info": "1" } : { "X-Domain": credential.domain },
    "X-Product": "SaaS"
  };
  return headers;
}
function refreshHeaders(credential) {
  const headers = {
    ...commonHeaders(credential),
    "X-Refresh-Token": credential.refreshToken,
    "X-Auth-Refresh-Source": "workbuddy"
  };
  if (credential.enterpriseId !== void 0 && credential.enterpriseId !== "") {
    headers["X-Enterprise-Id"] = credential.enterpriseId;
  }
  return headers;
}
function billingHeaders(credential) {
  const headers = {
    "Authorization": `Bearer ${credential.accessToken}`,
    "Accept": "application/json",
    "Content-Type": "application/json"
  };
  if (credential.uid !== "") headers["X-User-Id"] = credential.uid;
  if (credential.enterpriseId !== void 0 && credential.enterpriseId !== "") {
    headers["X-Enterprise-Id"] = credential.enterpriseId;
    headers["X-Tenant-Id"] = credential.enterpriseId;
  }
  if (credential.domain !== "") headers["X-Domain"] = credential.domain;
  return headers;
}
var WORKBUDDY_FALLBACK_SYSTEM_PROMPT = "You are a helpful assistant.";
function ensureSystemHead(obj) {
  const messages = obj["messages"];
  if (!Array.isArray(messages) || messages.length === 0) return;
  const head = messages[0];
  if (typeof head !== "object" || head === null || Array.isArray(head)) return;
  const role = head["role"];
  if (typeof role === "string" && role.trim().toLowerCase() === "system") return;
  messages.unshift({ role: "system", content: WORKBUDDY_FALLBACK_SYSTEM_PROMPT });
}
function prepareChatBody(source) {
  let body;
  try {
    body = JSON.parse(source);
  } catch {
    return source;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return source;
  const obj = body;
  obj["stream"] = true;
  if (Array.isArray(obj["messages"])) {
    for (const value of obj["messages"]) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const message = value;
      if (message["role"] === "developer") message["role"] = "system";
    }
  }
  ensureSystemHead(obj);
  normalizeToolChoice(obj);
  return JSON.stringify(obj);
}
function normalizeToolChoice(obj) {
  const suppress = () => {
    delete obj["tools"];
    delete obj["functions"];
  };
  const present = "tool_choice" in obj;
  if (!present) return;
  const choice = obj["tool_choice"];
  if (typeof choice === "string") {
    if (choice.trim().toLowerCase() === "none") {
      delete obj["tool_choice"];
      suppress();
    }
    return;
  }
  if (typeof choice === "object" && choice !== null && !Array.isArray(choice)) {
    const wrapped = choice;
    const type = typeof wrapped["type"] === "string" ? wrapped["type"].trim().toLowerCase() : "";
    if (type === "none") {
      delete obj["tool_choice"];
      suppress();
    } else if (type === "auto" || type === "required") {
      obj["tool_choice"] = type;
    } else if (type === "function") {
      const fn = typeof wrapped["function"] === "object" && wrapped["function"] !== null ? wrapped["function"] : void 0;
      let name = typeof fn?.["name"] === "string" ? fn["name"] : "";
      if (name === "" && typeof wrapped["name"] === "string") name = wrapped["name"];
      name = name.trim();
      obj["tool_choice"] = name !== "" ? name : "auto";
    } else {
      delete obj["tool_choice"];
    }
    return;
  }
  delete obj["tool_choice"];
}
function declaredTools(bodyJson) {
  let body;
  try {
    body = JSON.parse(bodyJson);
  } catch {
    return void 0;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return void 0;
  const obj = body;
  const tools = obj["tools"];
  if (!Array.isArray(tools)) return void 0;
  const names = /* @__PURE__ */ new Set();
  const requiredParameters = /* @__PURE__ */ new Map();
  for (const value of tools) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const wrapped = value;
    const fn = wrapped["function"];
    if (typeof fn !== "object" || fn === null || Array.isArray(fn)) continue;
    const definition = fn;
    const name = typeof definition["name"] === "string" ? definition["name"] : "";
    if (name === "") continue;
    names.add(name);
    const parameters = definition["parameters"];
    if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) continue;
    const required = parameters["required"];
    if (!Array.isArray(required)) continue;
    const list = required.filter((entry) => typeof entry === "string" && entry !== "");
    if (list.length > 0) requiredParameters.set(name, list);
  }
  if (names.size === 0) return void 0;
  const pinned = typeof obj["tool_choice"] === "string" ? obj["tool_choice"].trim() : "";
  const pinnedToolName = pinned !== "" && !["auto", "required", "none"].includes(pinned.toLowerCase()) ? pinned : void 0;
  return {
    names,
    requiredParameters,
    ...pinnedToolName === void 0 ? {} : { pinnedToolName }
  };
}
function isGatewayAuthRejection(status, text) {
  if (status !== 401 && status !== 403) return false;
  const lower = text.toLowerCase();
  return lower.includes("openresty") || lower.includes("apisix") || lower.includes("authorization required");
}
var CREDENTIAL_REJECTED_CODE = "WORKBUDDY_CREDENTIAL_REJECTED";
var WorkBuddyCredentialRejectedError = class extends Error {
  code = CREDENTIAL_REJECTED_CODE;
  /** HTTP status the upstream answered with (401 or 403). */
  status;
  constructor(status) {
    super(
      `workbuddy: the signed-in credential was rejected by the upstream gateway (http ${status}). The stored token is no longer accepted \u2014 most likely a stale credential file from an earlier sign-in was selected. Re-sign in to the WorkBuddy desktop app, then pick that account in the plugin card. Run \`dsh-connect-workbuddy doctor\` to list every discovered credential.`
    );
    this.name = "WorkBuddyCredentialRejectedError";
    this.status = status;
  }
};
function isCredentialRejectedError(value) {
  return typeof value === "object" && value !== null && value.code === CREDENTIAL_REJECTED_CODE;
}
async function readEnvelope(response) {
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (isGatewayAuthRejection(response.status, text)) {
      throw new WorkBuddyCredentialRejectedError(response.status);
    }
    throw new Error(`workbuddy upstream returned non-JSON (http ${response.status}): ${text.slice(0, 160)}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`workbuddy upstream returned an unexpected document (http ${response.status})`);
  }
  const document = parsed;
  const envelope = {
    code: typeof document["code"] === "number" ? document["code"] : 0,
    msg: typeof document["msg"] === "string" ? document["msg"] : "",
    data: "data" in document ? document["data"] : void 0
  };
  return envelope;
}
function envelopeError(status, envelope) {
  if (status === 401 || status === 403) return new WorkBuddyCredentialRejectedError(status);
  const kind = classifyUpstreamError(status, envelope.msg);
  return new Error(`workbuddy upstream ${kind} (http ${status}): ${envelope.msg.slice(0, 160)}`);
}
function parseCreditMultiplier(value) {
  if (typeof value !== "string") return void 0;
  const match = /x\s*([0-9]*\.?[0-9]+)/iu.exec(value);
  if (match === null) return void 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : void 0;
}
var SINGULAR_EFFORT_LADDER = ["low", "medium", "high", "xhigh", "max"];
function isSingularEffortForm(raw) {
  return typeof raw["effort"] === "string" && !Array.isArray(raw["supportedEfforts"]) && typeof raw["defaultEffort"] !== "string" && typeof raw["canDisableThinking"] !== "boolean";
}
function singularEffortLadder(raw) {
  const effort = typeof raw["effort"] === "string" ? raw["effort"] : void 0;
  if (effort === void 0) return void 0;
  return SINGULAR_EFFORT_LADDER.includes(effort) ? [...SINGULAR_EFFORT_LADDER] : [effort];
}
function parseReasoning(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  const raw = value;
  const effort = typeof raw["effort"] === "string" ? raw["effort"] : void 0;
  const supportedEfforts = Array.isArray(raw["supportedEfforts"]) ? raw["supportedEfforts"].filter((entry) => typeof entry === "string") : singularEffortLadder(raw);
  const defaultEffort = typeof raw["defaultEffort"] === "string" ? raw["defaultEffort"] : effort;
  const canDisableThinking = typeof raw["canDisableThinking"] === "boolean" ? raw["canDisableThinking"] : isSingularEffortForm(raw) ? true : void 0;
  if (supportedEfforts === void 0 && defaultEffort === void 0 && canDisableThinking === void 0) {
    return void 0;
  }
  return {
    ...supportedEfforts === void 0 || supportedEfforts.length === 0 ? {} : { supportedEfforts },
    ...defaultEffort === void 0 ? {} : { defaultEffort },
    ...canDisableThinking === void 0 ? {} : { canDisableThinking }
  };
}
function parseUpstreamModel(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const raw = value;
  const id = typeof raw["id"] === "string" ? raw["id"] : "";
  if (id === "" || raw["disabled"] === true) return void 0;
  const input = typeof raw["maxInputTokens"] === "number" ? raw["maxInputTokens"] : 0;
  const output = typeof raw["maxOutputTokens"] === "number" ? raw["maxOutputTokens"] : 0;
  if (input <= 0 || output <= 0) return void 0;
  const name = typeof raw["name"] === "string" && raw["name"] !== "" ? raw["name"] : id;
  const descriptionZh = typeof raw["descriptionZh"] === "string" && raw["descriptionZh"] !== "" ? raw["descriptionZh"] : void 0;
  const descriptionEn = typeof raw["descriptionEn"] === "string" && raw["descriptionEn"] !== "" ? raw["descriptionEn"] : void 0;
  const creditMultiplier = parseCreditMultiplier(raw["credits"]);
  const reasoning = parseReasoning(raw["reasoning"]);
  const supportsToolCall = typeof raw["supportsToolCall"] === "boolean" ? raw["supportsToolCall"] : void 0;
  const supportsImages = raw["disabledMultimodal"] === true ? false : typeof raw["supportsImages"] === "boolean" ? raw["supportsImages"] : void 0;
  return {
    id,
    name,
    contextWindow: input,
    maxTokens: output,
    ...creditMultiplier === void 0 ? {} : { creditMultiplier },
    ...supportsImages === void 0 ? {} : { supportsImages },
    ...reasoning === void 0 ? {} : { reasoning },
    ...descriptionZh === void 0 ? {} : { descriptionZh },
    ...descriptionEn === void 0 ? {} : { descriptionEn },
    ...supportsToolCall === void 0 ? {} : { supportsToolCall }
  };
}
function selectCliModels(rawModels, agents) {
  const byId = /* @__PURE__ */ new Map();
  for (const model of Array.isArray(rawModels) ? rawModels : []) {
    const parsed = parseUpstreamModel(model);
    if (parsed !== void 0) byId.set(parsed.id, parsed);
  }
  let cliIds;
  for (const agent of Array.isArray(agents) ? agents : []) {
    if (typeof agent === "object" && agent !== null) {
      const wrapped = agent;
      if (wrapped["name"] === "cli" && Array.isArray(wrapped["models"])) {
        cliIds = wrapped["models"].filter((id) => typeof id === "string");
        break;
      }
    }
  }
  const ids = cliIds !== void 0 && cliIds.length > 0 ? cliIds : [...byId.keys()];
  const models = ids.map((id) => byId.get(id)).filter((model) => model !== void 0);
  if (models.length === 0) throw new Error("workbuddy model catalog resolved to an empty list");
  return models;
}
var WorkBuddyUpstreamClient = class {
  /**
   * Reports a fallback the catalog reader had to take.
   *
   * Injected rather than logged here because this module holds no logger on
   * purpose — it is pure transport + parsing, so it stays importable from
   * tests and the CLI without a cordis context. The host wires its
   * `ctx.logger.warn` in; without a host the event is dropped, which is the
   * same silence the previous single-source reader had.
   */
  constructor(onFallback) {
    this.onFallback = onFallback;
  }
  onFallback;
  /** POST the chat endpoint; a successful answer is the raw SSE response. */
  async chatStream(credential, bodyJson, signal) {
    let response;
    try {
      response = await fetch(`${chatBase(credential)}/v2/chat/completions`, {
        method: "POST",
        headers: { ...chatHeaders(credential), "Authorization": `Bearer ${credential.accessToken}` },
        body: bodyJson,
        ...signal === void 0 ? {} : { signal }
      });
    } catch (error) {
      return { ok: false, status: 0, kind: "server", message: `transport error: ${String(error)}` };
    }
    if (response.ok) return { ok: true, response };
    const text = (await response.text()).slice(0, ERROR_BODY_LIMIT);
    return {
      ok: false,
      status: response.status,
      kind: classifyUpstreamError(response.status, text),
      message: text,
      detail: parseUpstreamErrorDetail(text)
    };
  }
  /**
   * Send one minimal chat request for `bodyJson` and report the RAW answer.
   *
   * Shares {@link chatHeaders} and the chat base with {@link chatStream} on
   * purpose: a probe is only meaningful if it reaches the same endpoint with the
   * same authentication as a real request. The differences are deliberate and
   * narrow — it returns the headers (for `Retry-After`) and the failure body
   * (for classification) instead of a pre-classified error, so the probe module
   * owns the interpretation and the network layer stays a transport.
   *
   * The caller MUST drain {@link WorkBuddyProbeAnswer.response}; an unread body
   * holds the connection open.
   *
   * ALWAYS bounded in time. The pool's batch runner is serial and passes no
   * signal, so without a ceiling here one stalled connection blocks every account
   * behind it — the batch looks hung with no way to tell which member did it.
   * A supplied signal is COMBINED with the timeout rather than replacing it, so
   * the single-model route keeps its cancellation behaviour and still cannot
   * hang forever.
   *
   * The ceiling covers ONLY the wait for a response — it is cleared the moment
   * `fetch` resolves. Holding a timer over the body would put a healthy but slow
   * model on the same clock as a dead endpoint, and the whole point of the
   * period is to answer "did the upstream answer at all". A probe asks for a
   * single token, so the body that follows is one SSE line.
   */
  async probeChat(credential, bodyJson, signal) {
    let response;
    const ceiling = new AbortController();
    const timer = setTimeout(() => {
      ceiling.abort(new Error(`no response within ${PROBE_TIMEOUT_MS}ms`));
    }, PROBE_TIMEOUT_MS);
    try {
      response = await fetch(`${chatBase(credential)}/v2/chat/completions`, {
        method: "POST",
        headers: { ...chatHeaders(credential), "Authorization": `Bearer ${credential.accessToken}` },
        body: bodyJson,
        signal: signal === void 0 ? ceiling.signal : AbortSignal.any([signal, ceiling.signal])
      });
    } catch (error) {
      return { ok: false, status: 0, retryAfter: null, body: `transport error: ${String(error)}` };
    } finally {
      clearTimeout(timer);
    }
    const retryAfter = response.headers.get("retry-after");
    if (response.ok) return { ok: true, status: response.status, retryAfter, response };
    const body = (await response.text()).slice(0, ERROR_BODY_LIMIT);
    return { ok: false, status: response.status, retryAfter, body };
  }
  /** POST the token-refresh endpoint; the caller merges the outcome. */
  async refreshToken(credential) {
    const response = await fetch(`${chatBase(credential)}/v2/plugin/auth/token/refresh`, {
      method: "POST",
      headers: refreshHeaders(credential),
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
    });
    const envelope = await readEnvelope(response);
    if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
    const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
    const accessToken = typeof data["accessToken"] === "string" ? data["accessToken"] : "";
    if (accessToken === "") throw new Error("workbuddy token refresh returned no accessToken; sign in again in the WorkBuddy app");
    const outcome = { accessToken };
    if (typeof data["refreshToken"] === "string" && data["refreshToken"] !== "") outcome.refreshToken = data["refreshToken"];
    if (typeof data["expiresIn"] === "number" && data["expiresIn"] > 0) outcome.expiresInSec = data["expiresIn"];
    if (typeof data["domain"] === "string" && data["domain"] !== "") outcome.domain = data["domain"];
    return outcome;
  }
  /**
   * Read the model directory for the credential's region.
   *
   * Both regions prefer `/v3/config`, the document the WorkBuddy app itself
   * consumes, so the plugin's roster and the app's agree. They differ in the
   * user agent that requests it, and that difference is load-bearing: `/v3`
   * serves a different roster per client channel. Global asks as the desktop
   * channel (see {@link DESKTOP_UA}); CN asks as the CLI channel
   * ({@link CLIENT_UA}), which is the only CN channel whose `/v3` answer
   * contains the free `hy4-preview-f` (see {@link GLOBAL_CONFIG_PATH}).
   *
   * CN falls back to the legacy {@link MODELS_CATALOG_PATH} when `/v3` fails,
   * returns a non-zero envelope, or resolves to no usable model, so a gateway
   * that stops serving the modern document degrades to the previous roster
   * instead of leaving the region empty. The fallback is silent when unused and
   * reported when it fires, because a roster that silently differs from the
   * app's is exactly the bug this ordering exists to fix.
   *
   * No user-side toggle is involved: the region comes from the credential's
   * `domain`.
   */
  async fetchModels(credential, signal) {
    const timeout = signal ?? AbortSignal.timeout(JSON_TIMEOUT_MS);
    const global = regionOf(credential.domain) === "global";
    if (global) {
      const response = await fetch(`${globalBase(credential.domain)}${GLOBAL_CONFIG_PATH}`, {
        headers: {
          "Authorization": `Bearer ${credential.accessToken}`,
          "Accept": "application/json",
          ...credential.uid === "" ? {} : { "X-User-Id": credential.uid },
          ...credential.domain === "" ? {} : { "X-Domain": credential.domain },
          "X-Product": "SaaS",
          "X-Requested-With": "XMLHttpRequest",
          "Connection": "close",
          "User-Agent": DESKTOP_UA
        },
        signal: timeout
      });
      const envelope = await readEnvelope(response);
      if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
      const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
      return selectCliModels(data["models"], data["agents"]);
    }
    const readCatalog = async (path) => {
      const response = await fetch(`${chatBase(credential)}${path}`, {
        headers: {
          "Authorization": `Bearer ${credential.accessToken}`,
          "Accept": "application/json",
          "Origin": originReferer(credential),
          "Referer": `${originReferer(credential)}/`,
          "User-Agent": CLIENT_UA
        },
        signal: timeout
      });
      const envelope = await readEnvelope(response);
      if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
      const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
      return selectCliModels(data["models"], data["agents"]);
    };
    try {
      return await readCatalog(GLOBAL_CONFIG_PATH);
    } catch (error) {
      this.onFallback?.(
        `CN model catalog ${GLOBAL_CONFIG_PATH} failed; falling back to ${MODELS_CATALOG_PATH}: ` + (error instanceof Error ? error.message : String(error))
      );
      return await readCatalog(MODELS_CATALOG_PATH);
    }
  }
  /** Query today's check-in status without changing account state. */
  async fetchCheckinStatus(credential) {
    const response = await fetch(`${billingBase(credential)}/v2/billing/meter/checkin-activity-status`, {
      method: "POST",
      headers: billingHeaders(credential),
      body: "{}",
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
    });
    const envelope = await readEnvelope(response);
    if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
    const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
    const numberField = (key) => typeof data[key] === "number" ? data[key] : 0;
    return {
      active: data["active"] === true,
      todayCheckedIn: data["today_checked_in"] === true,
      streakDays: numberField("streak_days"),
      dailyCredit: numberField("daily_credit"),
      todayCredit: numberField("today_credit"),
      isStreakDay: data["is_streak_day"] === true,
      nextStreakDay: numberField("next_streak_day"),
      streakBonusDays: numberField("streak_bonus_days"),
      streakBonusCredit: numberField("streak_bonus_credit"),
      ...typeof data["claim_button_text"] === "string" && data["claim_button_text"] !== "" ? { claimButtonText: data["claim_button_text"] } : {}
    };
  }
  /** Claim today's check-in reward. The browser route guards this mutation. */
  async claimDailyCheckin(credential) {
    const response = await fetch(`${billingBase(credential)}/v2/billing/meter/daily-checkin`, {
      method: "POST",
      headers: billingHeaders(credential),
      body: "{}",
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
    });
    const envelope = await readEnvelope(response);
    if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
    const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
    const numberField = (key) => typeof data[key] === "number" ? data[key] : 0;
    return {
      credit: numberField("credit"),
      streakDays: numberField("streak_days"),
      isStreakDay: data["is_streak_day"] === true
    };
  }
  /**
   * POST the billing endpoint for the remaining credit, keeping every package
   * separate: the card groups monthly-cycle packages itself and lists the
   * nearest-expiring one-off packages, so aggregation here would lose the
   * dates it needs.
   */
  async fetchCredits(credential) {
    const now = /* @__PURE__ */ new Date();
    const format = (date) => [
      date.getFullYear().toString().padStart(4, "0"),
      (date.getMonth() + 1).toString().padStart(2, "0"),
      date.getDate().toString().padStart(2, "0")
    ].join("-") + " " + [
      date.getHours().toString().padStart(2, "0"),
      date.getMinutes().toString().padStart(2, "0"),
      date.getSeconds().toString().padStart(2, "0")
    ].join(":");
    const response = await fetch(`${billingBase(credential)}/v2/billing/meter/get-user-resource`, {
      method: "POST",
      headers: billingHeaders(credential),
      body: JSON.stringify({
        PageNumber: 1,
        PageSize: 100,
        ProductCode: "p_tcaca",
        Status: [0, 3],
        PackageEndTimeRangeBegin: format(now),
        PackageEndTimeRangeEnd: format(new Date(now.getTime() + 365 * 101 * 24 * 3600 * 1e3))
      }),
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
    });
    const envelope = await readEnvelope(response);
    if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
    const responseWrapper = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
    const data = typeof responseWrapper["Response"] === "object" && responseWrapper["Response"] !== null ? responseWrapper["Response"] : {};
    const inner = typeof data["Data"] === "object" && data["Data"] !== null ? data["Data"] : {};
    const rawAccounts = Array.isArray(inner["Accounts"]) ? inner["Accounts"] : [];
    let total = 0;
    let nearestExpiryMs;
    let expiringSoon = 0;
    const SOON_MS = 3 * 24 * 60 * 60 * 1e3;
    const parseDate = (raw) => {
      if (typeof raw === "number" && raw > 1e12) return raw;
      if (typeof raw === "string" && raw !== "") {
        const parsed = Date.parse(raw);
        if (!Number.isNaN(parsed)) return parsed;
      }
      return void 0;
    };
    const packages = [];
    for (const raw of rawAccounts) {
      if (typeof raw !== "object" || raw === null) continue;
      const account = raw;
      const numberField = (key) => typeof account[key] === "number" ? account[key] : 0;
      const monthly = numberField("CapacityType") === 4;
      const size = monthly ? numberField("CycleCapacitySize") : numberField("CapacitySize");
      const remain = monthly ? numberField("CycleCapacityRemain") : numberField("CapacityRemain");
      const cappedRemain = remain < 0 ? 0 : remain;
      const cycleEndMs = parseDate(account["CycleEndTime"]);
      const expiresAtMs = monthly ? void 0 : parseDate(account["ExpiredTime"]) ?? cycleEndMs;
      const refreshAtMs = monthly ? cycleEndMs === void 0 ? void 0 : cycleEndMs + 1e3 : void 0;
      if (!monthly && (cappedRemain <= 0 || expiresAtMs !== void 0 && expiresAtMs <= Date.now())) {
        continue;
      }
      total += cappedRemain;
      const expiryMs = expiresAtMs;
      if (expiryMs !== void 0) {
        if (nearestExpiryMs === void 0 || expiryMs < nearestExpiryMs) nearestExpiryMs = expiryMs;
        if (expiryMs - Date.now() <= SOON_MS) expiringSoon += cappedRemain;
      }
      packages.push({
        packageName: typeof account["PackageName"] === "string" ? account["PackageName"] : "(unnamed)",
        remain: cappedRemain,
        size,
        monthly,
        ...refreshAtMs === void 0 ? {} : { refreshAtMs },
        ...expiresAtMs === void 0 ? {} : { expiresAtMs }
      });
    }
    return {
      total,
      packages,
      expiringSoon,
      ...nearestExpiryMs === void 0 ? {} : { nearestExpiryMs }
    };
  }
};

// vendor/workbuddy/dsml-recovery.ts
import { randomUUID } from "node:crypto";
var FULLWIDTH_BAR = "\uFF5C";
var MARKUP_TOKEN = `${FULLWIDTH_BAR}${FULLWIDTH_BAR}DSML${FULLWIDTH_BAR}${FULLWIDTH_BAR}`;
var BARS = `${FULLWIDTH_BAR}${FULLWIDTH_BAR}?`;
var MARKUP_RE = new RegExp(`${BARS}DSML${BARS}`, "g");
var MARKUP_PREFIXES = [
  `${FULLWIDTH_BAR}${FULLWIDTH_BAR}DSML${FULLWIDTH_BAR}${FULLWIDTH_BAR}`,
  "||DSML||",
  "|DSML|"
];
var ASCII_PREFIXES = ["||DSML||", "|DSML|"];
var BLOCK_TAGS = ["tool_calls", "invoke"];
var KEYWORD_TAGS = ["tool_calls", "tool-calls", "toolcalls", "invoke", "parameter", "calls", "tool"];
var CANONICAL_TAG_NAMES = /* @__PURE__ */ new Map([
  ["tool_calls", "tool_calls"],
  ["tool-calls", "tool_calls"],
  ["toolcalls", "tool_calls"],
  ["invoke", "invoke"],
  ["parameter", "parameter"]
]);
var MARKER_ONLY_TAG_NAMES = /* @__PURE__ */ new Set(["tool-calls", "toolcalls"]);
var FENCE_MARKERS = ["```", "~~~"];
function ignoredSpans(text) {
  const spans = [];
  let i = 0;
  let fence;
  let fenceStart = 0;
  while (i < text.length) {
    const atLineStart = i === 0 || text.charAt(i - 1) === "\n";
    if (fence !== void 0) {
      if (atLineStart && text.startsWith(fence, i)) {
        const lineEnd = text.indexOf("\n", i);
        const end = lineEnd === -1 ? text.length : lineEnd + 1;
        spans.push({ start: fenceStart, end, open: false });
        fence = void 0;
        i = end;
        continue;
      }
      i += 1;
      continue;
    }
    if (atLineStart) {
      const marker = FENCE_MARKERS.find((candidate) => text.startsWith(candidate, i));
      if (marker !== void 0) {
        fence = marker;
        fenceStart = i;
        i += marker.length;
        continue;
      }
    }
    if (text.charAt(i) === "`") {
      const end = codeSpanEnd(text, i);
      if (end === -1) {
        spans.push({ start: i, end: text.length, open: true });
        break;
      }
      spans.push({ start: i, end, open: false });
      i = end;
      continue;
    }
    const xml = xmlIgnoredEnd(text, i);
    if (xml !== void 0) {
      spans.push(xml);
      if (xml.end >= text.length && xml.open) break;
      i = xml.end;
      continue;
    }
    i += 1;
  }
  if (fence !== void 0) spans.push({ start: fenceStart, end: text.length, open: true });
  return spans;
}
function codeSpanEnd(text, start) {
  let ticks = 0;
  let i = start;
  while (i < text.length && text.charAt(i) === "`") {
    ticks += 1;
    i += 1;
  }
  if (ticks === 0 || ticks >= 3) return -1;
  let end = i;
  while (end < text.length) {
    if (text.charAt(end) !== "`") {
      end += 1;
      continue;
    }
    let closingTicks = 0;
    let j = end;
    while (j < text.length && text.charAt(j) === "`") {
      closingTicks += 1;
      j += 1;
    }
    if (closingTicks === ticks) return j;
    end = j;
  }
  return -1;
}
function xmlIgnoredEnd(text, index) {
  const forms = [
    ["<![CDATA[", "]]>"],
    ["<!--", "-->"],
    ["<?", "?>"]
  ];
  for (const [open, close] of forms) {
    if (!text.startsWith(open, index)) continue;
    const found = text.indexOf(close, index + open.length);
    if (found === -1) return { start: index, end: text.length, open: true };
    return { start: index, end: found + close.length, open: false };
  }
  return void 0;
}
function skipIgnored(spans, index, cursor) {
  while (cursor.at < spans.length) {
    const span = spans[cursor.at];
    if (span === void 0 || index < span.start) return index;
    if (index < span.end) return span.end;
    cursor.at += 1;
  }
  return index;
}
function prefixLengthAt(text, index) {
  for (const prefix of MARKUP_PREFIXES) {
    if (text.startsWith(prefix, index)) return prefix.length;
  }
  const normalized = normalizeFullwidth(text.slice(index, index + 8));
  for (const prefix of ASCII_PREFIXES) {
    if (normalized.startsWith(prefix)) return prefix.length;
  }
  return 0;
}
function isNameCharacter(text, index) {
  return /[\p{L}\p{N}_-]/u.test(text.charAt(index));
}
function readName(text, index) {
  const prefixLength = prefixLengthAt(text, index);
  const marked = prefixLength > 0;
  let position = index + prefixLength;
  while (position < text.length && /\s/.test(text.charAt(position))) position += 1;
  const start = position;
  while (position < text.length && isNameCharacter(text, position)) position += 1;
  if (position === start) return { name: "", end: index, marked };
  return { name: text.slice(start, position).toLowerCase(), end: position, marked };
}
function scanTag(text, index) {
  if (text.charAt(index) !== "<") return void 0;
  let position = index + 1;
  let closing = false;
  if (text.charAt(position) === "/") {
    closing = true;
    position += 1;
  }
  while (position < text.length && /\s/.test(text.charAt(position))) position += 1;
  const read = readName(text, position);
  if (read.name === "") return void 0;
  const canonical = CANONICAL_TAG_NAMES.get(read.name);
  const name = canonical !== void 0 && !(MARKER_ONLY_TAG_NAMES.has(read.name) && !read.marked) ? canonical : read.name;
  const attributesStart = read.end;
  let selfClosing = false;
  let cursor = read.end;
  while (cursor < text.length) {
    const character = text.charAt(cursor);
    if (character === ">") {
      return {
        start: index,
        end: cursor,
        name,
        closing,
        selfClosing,
        marked: read.marked,
        attributes: text.slice(attributesStart, cursor).trim()
      };
    }
    if (character === "/" && text.charAt(cursor + 1) === ">") {
      selfClosing = true;
      return {
        start: index,
        end: cursor + 1,
        name,
        closing,
        selfClosing,
        marked: read.marked,
        attributes: text.slice(attributesStart, cursor).trim()
      };
    }
    cursor += 1;
  }
  return void 0;
}
function findTag(text, spans, from) {
  const cursor = { at: 0 };
  let index = Math.max(from, 0);
  while (index < text.length) {
    const skipped = skipIgnored(spans, index, cursor);
    if (skipped !== index) {
      index = skipped;
      continue;
    }
    if (text.charAt(index) === "<") {
      const tag = scanTag(text, index);
      if (tag !== void 0) return tag;
    }
    index += 1;
  }
  return void 0;
}
function findMatchingClose(text, spans, open) {
  let depth = 1;
  let index = open.end + 1;
  while (index < text.length) {
    const tag = findTag(text, spans, index);
    if (tag === void 0) return void 0;
    if (tag.name === open.name) {
      if (tag.closing) {
        depth -= 1;
        if (depth === 0) return tag;
      } else if (!tag.selfClosing) {
        depth += 1;
      }
    }
    index = tag.end + 1;
  }
  return void 0;
}
function findFirstOpener(text, spans) {
  let index = 0;
  while (index < text.length) {
    const tag = findTag(text, spans, index);
    if (tag === void 0) return void 0;
    if (!tag.closing && BLOCK_TAGS.includes(tag.name)) {
      const close = findMatchingClose(text, spans, tag);
      return close === void 0 ? { open: tag } : { open: tag, close };
    }
    index = tag.end + 1;
  }
  return void 0;
}
function decodeEntities(text) {
  if (!text.includes("&")) return text;
  const named = /* @__PURE__ */ new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"]
  ]);
  return text.replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
    if (body.startsWith("#")) {
      const hex = body.charAt(1).toLowerCase() === "x";
      const digits = hex ? body.slice(2) : body.slice(1);
      const code = Number.parseInt(digits, hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 1114111) return whole;
      return String.fromCodePoint(code);
    }
    return named.get(body.toLowerCase()) ?? whole;
  });
}
function parseAttributes(text) {
  const attributes = {};
  const pattern = /([a-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let match = pattern.exec(text);
  while (match !== null) {
    const key = match[1];
    const value = match[2] ?? match[3];
    if (key !== void 0 && value !== void 0) attributes[key] = decodeEntities(value);
    match = pattern.exec(text);
  }
  return attributes;
}
function parseParameters(body) {
  const parameters = {};
  const spans = ignoredSpans(body);
  let index = 0;
  while (index < body.length) {
    const tag = findTag(body, spans, index);
    if (tag === void 0) break;
    if (tag.closing || tag.selfClosing) {
      index = tag.end + 1;
      continue;
    }
    const close = findMatchingClose(body, spans, tag);
    if (close === void 0) {
      index = tag.end + 1;
      continue;
    }
    const value = body.slice(tag.end + 1, close.start).trim();
    const attributes = parseAttributes(tag.attributes);
    const explicitName = tag.name === "parameter" ? attributes["name"] : void 0;
    const name = explicitName ?? tag.name;
    if (name !== void 0 && name !== "" && (explicitName !== void 0 || parameters[name] === void 0)) {
      parameters[name] = value.startsWith("<![CDATA[") && value.endsWith("]]>") ? value.slice(9, -3) : nestedOrText(value);
    }
    index = close.end + 1;
  }
  return parameters;
}
function nestedOrText(value) {
  if (!value.includes("<") || !value.includes(">")) return decodeEntities(value);
  const nested = parseParameters(value);
  return Object.keys(nested).length > 0 ? nested : decodeEntities(value);
}
function parseBlock(block, gate) {
  const calls = [];
  const spans = ignoredSpans(block);
  let index = 0;
  while (index < block.length) {
    const tag = findTag(block, spans, index);
    if (tag === void 0) break;
    if (!tag.closing && tag.name === "invoke") {
      const close = findMatchingClose(block, spans, tag);
      if (close === void 0) break;
      const call = parseInvoke(tag, close, block, gate);
      if (call !== void 0) calls.push(call);
      index = close.end + 1;
      continue;
    }
    index = tag.end + 1;
  }
  return calls;
}
function parseInvoke(open, close, block, gate) {
  const attributes = parseAttributes(open.attributes);
  const name = attributes["name"];
  if (name === void 0 || name === "") return void 0;
  if (!gate.declaredNames.has(name)) return void 0;
  const pinned = gate.pinnedToolName;
  if (pinned !== void 0 && pinned !== "auto" && pinned !== "required" && pinned !== "none" && pinned !== name) {
    return void 0;
  }
  const parameters = parseParameters(block.slice(open.end + 1, close.start));
  const required = gate.requiredParameters?.get(name);
  if (required !== void 0 && required.some((parameter) => parameters[parameter] === void 0)) return void 0;
  return {
    id: `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    name,
    arguments: JSON.stringify(parameters)
  };
}
function parseToolCalls(text, gate) {
  if (gate.declaredNames.size === 0) return [];
  const calls = [];
  let remaining = text;
  while (remaining !== "") {
    const found = findFirstOpener(remaining, ignoredSpans(remaining));
    if (found === void 0 || found.close === void 0) break;
    calls.push(...parseBlock(remaining.slice(found.open.start, found.close.end + 1), gate));
    remaining = remaining.slice(found.close.end + 1);
  }
  return calls;
}
function stripMarkup(text) {
  const spans = ignoredSpans(text);
  const cursor = { at: 0 };
  let result = "";
  let index = 0;
  while (index < text.length) {
    const skipped = skipIgnored(spans, index, cursor);
    if (skipped !== index) {
      result += text.slice(index, skipped);
      index = skipped;
      continue;
    }
    const tag = text.charAt(index) === "<" ? scanTag(text, index) : void 0;
    if (tag === void 0 || !tag.marked) {
      result += text.charAt(index);
      index += 1;
      continue;
    }
    const bracketed = !tag.closing && !tag.selfClosing && KEYWORD_TAGS.includes(tag.name);
    const close = bracketed ? findMatchingClose(text, spans, tag) : void 0;
    index = close === void 0 ? tag.end + 1 : close.end + 1;
  }
  return result;
}
function hasProse(text) {
  return stripMarkup(text).trim() !== "";
}
function holdFrom(text, spans) {
  let hold = text.length;
  const lastLt = text.lastIndexOf("<");
  if (lastLt !== -1 && looksLikeTagStart(text.slice(lastLt))) hold = Math.min(hold, lastLt);
  for (const span of spans) {
    if (span.open) hold = Math.min(hold, span.start);
  }
  return hold;
}
function looksLikeTagStart(tail) {
  if (!tail.startsWith("<")) return false;
  if (tail.includes(">")) return false;
  let body = tail.slice(1);
  if (body.startsWith("/")) body = body.slice(1);
  if (body === "" || isPartialMarker(body)) return true;
  const prefixLength = prefixLengthAt(body, 0);
  body = body.slice(prefixLength).trim().toLowerCase();
  if (body === "" || isPartialMarker(body)) return true;
  const openers = ["tool", "invoke", "tool_calls", "tool-calls", "toolcalls", "tool_call", "tool-call"];
  return openers.some((opener) => opener.startsWith(body) || body.startsWith(opener));
}
function isPartialMarker(body) {
  const trimmed = body.trimStart();
  if (trimmed === "") return true;
  const forms = [...MARKUP_PREFIXES, ...ASCII_PREFIXES];
  const candidates = [trimmed, normalizeFullwidth(trimmed.slice(0, 8))];
  return candidates.some((candidate) => candidate !== "" && forms.some((form) => form.startsWith(candidate) && candidate.length < form.length));
}
function normalizeFullwidth(text) {
  let normalized = "";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    normalized += code >= 65281 && code <= 65374 ? String.fromCodePoint(code - 65248) : character;
  }
  return normalized;
}
var DsmlStreamBuffer = class {
  pending = "";
  gate;
  constructor(gate) {
    this.gate = gate;
  }
  /** Feed one `delta.content` chunk; returns text and any call it completed. */
  add(chunk) {
    this.pending += chunk;
    const parts = [];
    const calls = [];
    if (this.gate.declaredNames.size === 0) {
      const text = this.pending;
      this.pending = "";
      return { text, prose: hasProse(text) };
    }
    for (; ; ) {
      const found = findFirstOpener(this.pending, ignoredSpans(this.pending));
      if (found === void 0) break;
      const head = this.pending.slice(0, found.open.start);
      if (head !== "") parts.push(head);
      if (found.close === void 0) {
        this.pending = this.pending.slice(found.open.start);
        return finish(parts, calls);
      }
      const body = this.pending.slice(found.open.start, found.close.end + 1);
      const recovered = parseBlock(body, this.gate);
      if (recovered.length > 0) calls.push(...recovered);
      else parts.push(body);
      this.pending = this.pending.slice(found.close.end + 1);
    }
    const hold = holdFrom(this.pending, ignoredSpans(this.pending));
    if (hold > 0) parts.push(this.pending.slice(0, hold));
    this.pending = this.pending.slice(hold);
    return finish(parts, calls);
  }
  /** End of stream: hand back everything still held, verbatim. */
  flush() {
    const text = this.pending;
    this.pending = "";
    return { text, prose: hasProse(text) };
  }
};
function finish(parts, calls) {
  const text = parts.join("");
  const outcome = { text, prose: hasProse(text) };
  if (calls.length > 0) outcome.calls = [...calls];
  return outcome;
}
export {
  CREDENTIAL_REJECTED_CODE,
  DsmlStreamBuffer,
  FULLWIDTH_BAR,
  MARKUP_RE,
  MARKUP_TOKEN,
  WORKBUDDY_FALLBACK_SYSTEM_PROMPT,
  WorkBuddyCredentialRejectedError,
  WorkBuddyUpstreamClient,
  classifyUpstreamError,
  declaredTools,
  globalBase,
  hasProse,
  isCredentialRejectedError,
  parseCreditMultiplier,
  parseReasoning,
  parseToolCalls,
  parseUpstreamErrorDetail,
  parseUpstreamModel,
  prepareChatBody,
  regionOf,
  selectCliModels,
  stripMarkup
};
