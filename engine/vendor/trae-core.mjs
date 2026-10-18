// vendor/trae/decrypt.ts
import { createDecipheriv, createHash } from "node:crypto";
var TRAE_AUTH_STORAGE_KEY = "iCubeAuthInfo://icube.cloudide";
var SALT_A = Uint8Array.from([82, 9, 106, 213, 48, 54, 165, 56, 191, 64, 163, 158, 129, 243, 215, 251, 124, 227, 57, 130, 155, 47, 255, 135, 52, 142, 67, 68, 196, 222, 233, 203, 84, 123, 148, 50, 166, 194, 35, 61, 238, 76, 149, 11, 66, 250, 195, 78, 8, 46, 161, 102, 40, 217, 36, 178, 118, 91, 162, 73, 109, 139, 209, 37]);
var SALT_B = Uint8Array.from([31, 221, 168, 51, 136, 7, 199, 49, 177, 18, 16, 89, 39, 128, 236, 95, 96, 81, 127, 169, 25, 181, 74, 13, 45, 229, 122, 159, 147, 201, 156, 239, 160, 224, 59, 77, 174, 42, 245, 176, 200, 235, 187, 60, 131, 83, 153, 97, 23, 43, 4, 126, 186, 119, 214, 38, 225, 105, 20, 99, 85, 33, 12, 125]);
var SALT_C = Uint8Array.from([191, 192, 216, 250, 122, 246, 220, 97, 31, 254, 98, 27, 8, 72, 71, 176, 135, 99, 96, 18, 127, 101, 203, 104, 211, 102, 191, 125, 37, 72, 150, 156, 51, 229, 121, 35, 17, 153, 141, 177, 110, 131, 150, 128, 172, 255, 254, 6, 18, 140, 55, 62, 236, 249, 135, 64, 135, 12, 117, 4, 89, 149, 168, 209]);
var SALT_D = Uint8Array.from([246, 204, 26, 232, 232, 70, 129, 109, 223, 146, 169, 242, 23, 241, 105, 145, 50, 196, 165, 42, 254, 120, 3, 54, 244, 207, 209, 85, 53, 6, 138, 106, 175, 148, 31, 204, 186, 186, 165, 182, 87, 142, 49, 10, 39, 110, 26, 154, 86, 56, 173, 125, 18, 64, 198, 225, 99, 99, 83, 82, 191, 134, 76, 170]);
function xor(a, b) {
  return Buffer.from(a.map((value, index) => value ^ (b[index] ?? 0)));
}
function encryptionType(header) {
  if (header.equals(Buffer.from([116, 99, 5, 16, 0, 0]))) return "aes";
  if (header.equals(Buffer.from([18, 57, 32, 32, 2, 3]))) return "aes-private";
  throw new Error("unsupported Trae auth encryption header");
}
function decryptTraeStorageValue(encoded) {
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length <= 102) throw new Error("Trae auth ciphertext is too short");
  const type = encryptionType(buffer.subarray(0, 6));
  const random = buffer.subarray(6, 38);
  const encrypted = buffer.subarray(38);
  const salt = type === "aes-private" ? xor(SALT_C, SALT_D) : xor(SALT_A, SALT_B);
  const first = createHash("sha512").update(random).digest();
  const derived = createHash("sha512").update(Buffer.concat([first, salt])).digest();
  const decipher = createDecipheriv("aes-128-cbc", derived.subarray(0, 16), derived.subarray(16, 32));
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  if (decrypted.length < 64) throw new Error("Trae auth plaintext is too short");
  const expected = decrypted.subarray(0, 64);
  const plaintext = decrypted.subarray(64);
  const actual = createHash("sha512").update(plaintext).digest();
  if (!expected.equals(actual)) throw new Error("Trae auth integrity check failed");
  return plaintext.toString("utf8");
}
function parseTraeAuthValue(value) {
  const trimmed = value.trim();
  if (trimmed === "") throw new Error("Trae auth value is empty");
  const plaintext = trimmed.startsWith("{") ? trimmed : decryptTraeStorageValue(trimmed);
  return JSON.parse(plaintext);
}
function parseTraeStorageDocument(text) {
  const parsed = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Trae storage document must be an object");
  const value = parsed[TRAE_AUTH_STORAGE_KEY];
  if (typeof value !== "string") throw new Error(`Trae storage document has no ${TRAE_AUTH_STORAGE_KEY}`);
  return parseTraeAuthValue(value);
}
function decodeBase64UrlJson(segment) {
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function parseTraeCliToken(text) {
  const trimmed = text.trim();
  if (trimmed === "") throw new Error("Trae CLI token file is empty");
  let token = trimmed;
  if (trimmed.startsWith("{")) {
    const envelope = JSON.parse(trimmed);
    const candidate = envelope["token"] ?? envelope["accessToken"] ?? envelope["jwt"];
    if (typeof candidate !== "string" || candidate.trim() === "") throw new Error("Trae CLI token document has no token field");
    token = candidate.trim();
  }
  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((segment) => segment === "")) throw new Error("Trae CLI token is not a three-part JWT");
  const payload = decodeBase64UrlJson(segments[1]);
  if (payload === void 0) throw new Error("Trae CLI token payload is not decodable JSON");
  const data = typeof payload["data"] === "object" && payload["data"] !== null && !Array.isArray(payload["data"]) ? payload["data"] : void 0;
  const userId = typeof data?.["user_id"] === "string" ? data["user_id"] : void 0;
  if (userId === void 0 || userId === "") throw new Error("Trae CLI token has no data.user_id claim");
  const exp = payload["exp"];
  const expiresAtMs = typeof exp === "number" && Number.isFinite(exp) && exp > 0 ? exp * 1e3 : void 0;
  return { accessToken: token, userId, ...expiresAtMs === void 0 ? {} : { expiresAtMs } };
}

// vendor/trae/identity.ts
import { createHash as createHash2 } from "node:crypto";
import { readFile, readdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cpus, homedir, release } from "node:os";

// vendor/trae/paths.ts
var WINDOWS_APP_NAMES = {
  cn: ["Trae CN", "trae-cn"],
  sg: ["Trae"],
  solo: ["TRAE SOLO CN", "trae-solo-cn"],
  "solo-sg": ["TRAE SOLO"]
};
function traeWindowsAppNames(edition) {
  return WINDOWS_APP_NAMES[edition];
}

// vendor/trae/identity.ts
function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
async function deviceCenterId(storage, appRoot) {
  const prefix = "iCubeAuthInfo://icube-dc:";
  const ids = Object.keys(storage).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)).filter(Boolean);
  if (ids.length <= 1) return ids[0];
  const logs = join(appRoot, "logs");
  const sessions = (await readdir(logs).catch(() => [])).filter((name) => /^\d{8}T\d{6}$/.test(name)).sort().reverse().slice(0, 1);
  for (const session of sessions) {
    let file;
    try {
      file = await open(join(logs, session, "main.log"), "r");
      const size = (await file.stat()).size;
      const head = Buffer.alloc(Math.min(size, 262144));
      const { bytesRead } = await file.read(head, 0, head.length, 0);
      let text = head.subarray(0, bytesRead).toString("utf8");
      if (size > head.length) {
        const tail = Buffer.alloc(Math.min(size - head.length, 65536));
        const read = await file.read(tail, 0, tail.length, size - tail.length);
        text += "\n" + tail.subarray(0, read.bytesRead).toString("utf8");
      }
      const current = [...text.matchAll(/\[ICDRS\] \(init\) initialization done, did: (\d+),/g)].at(-1)?.[1] ?? [...text.matchAll(/\[ICDRS\] \(init\) resolve rdid: (\d+)/g)].at(-1)?.[1];
      if (current) {
        if (!ids.includes(current)) throw new Error("Trae active device is not present in its local identity records; reopen the client and recheck");
        return current;
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Trae active device")) throw error;
    } finally {
      await file?.close();
    }
  }
  throw new Error("Trae has multiple historical device identities; reopen the client to record its current device before check-in");
}
async function readTraeIdentity(candidate, options = {}) {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const storage = JSON.parse(await readFile(candidate.path, "utf8"));
  const appRoot = dirname(dirname(dirname(candidate.path)));
  const machineFile = nonEmpty(await readFile(join(appRoot, "machineid"), "utf8").catch(() => ""));
  const telemetryMachine = nonEmpty(storage["telemetry.machineId"]);
  const devDevice = nonEmpty(storage["telemetry.devDeviceId"]);
  const dcDevice = await deviceCenterId(storage, appRoot);
  const machineId = telemetryMachine ?? machineFile;
  if (machineId === void 0) throw new Error(`Trae ${candidate.edition} has no stable machine identity`);
  const deviceId = dcDevice ?? devDevice ?? createHash2("sha256").update(machineId).digest("hex").slice(0, 32);
  const buildVersion = nonEmpty(storage["iCubeLastVersion"]);
  const APP_NAMES_BY_EDITION = {
    cn: "Trae CN",
    sg: "Trae",
    solo: "TRAE SOLO CN",
    "solo-sg": "TRAE SOLO"
  };
  const appName = APP_NAMES_BY_EDITION[candidate.edition];
  const productPaths = [];
  if (appName !== void 0 && (platform === "darwin" || platform === "win32")) {
    if (platform === "darwin") {
      productPaths.push(join("/Applications", `${appName}.app`, "Contents", "Resources", "app", "product.json"));
    } else {
      const localRoots = [env.LOCALAPPDATA, join(home, "AppData", "Local")].filter((value) => typeof value === "string" && value !== "").filter((value, index, all) => all.indexOf(value) === index);
      for (const root of localRoots) {
        for (const spelling of traeWindowsAppNames(candidate.edition)) {
          productPaths.push(join(root, "Programs", spelling, "resources", "app", "product.json"));
        }
      }
    }
  }
  let product = {};
  for (const path of productPaths) {
    try {
      product = JSON.parse(await readFile(path, "utf8"));
      break;
    } catch {
    }
  }
  const appVersion = nonEmpty(product["appVersion"]);
  const deviceBrand = platform === "darwin" ? nonEmpty(env["TRAE_DEVICE_BRAND"]) : void 0;
  const deviceCpu = cpus()[0]?.model.split(" ")[0];
  const osVersion = `${platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : platform} ${release()}`;
  return {
    edition: candidate.edition,
    machineId,
    deviceId,
    ...appVersion === void 0 ? {} : { appVersion },
    ...buildVersion === void 0 ? {} : { buildVersion },
    ...deviceBrand === void 0 ? {} : { deviceBrand },
    ...deviceCpu === void 0 ? {} : { deviceCpu },
    osVersion,
    platform
  };
}
function isFileMissing(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
var STORAGE_MISSING_PREFIX = "Trae storage was not found";
async function pickTraeStorageIdentity(candidates, options = {}) {
  let lastError;
  let anyPresent = false;
  for (const candidate of candidates) {
    try {
      return await readTraeIdentity(candidate, options);
    } catch (error) {
      lastError = error;
      if (!isFileMissing(error)) anyPresent = true;
    }
  }
  const tried = candidates.map((item) => item.path).join(" or ");
  if (!anyPresent) throw new Error(`${STORAGE_MISSING_PREFIX} (${tried})`);
  throw lastError instanceof Error ? lastError : new Error(`Trae identity could not be resolved (${tried})`);
}
var CLI_HOME_BY_EDITION = {
  cn: ".trae-cn",
  solo: ".trae-cn",
  sg: ".trae",
  "solo-sg": ".trae"
};
async function readTraeCliIdentity(edition, options = {}) {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const cliHome = join(home, CLI_HOME_BY_EDITION[edition]);
  const argv = await readJsonFile(join(cliHome, "argv.json"));
  const version = await readJsonFile(join(cliHome, "builtin", "ide_version.json"));
  const crashReporterId = nonEmpty(argv?.["crash-reporter-id"]);
  const host = nonEmpty(env["HOSTNAME"]) ?? await readHostname() ?? "unknown-host";
  const user = nonEmpty(env["USER"]) ?? nonEmpty(env["USERNAME"]) ?? "unknown-user";
  const deviceId = crashReporterId ?? createHash2("sha256").update(`trae-cli\0${host}\0${user}`).digest("hex").slice(0, 32);
  const machineId = createHash2("sha256").update(`trae-cli-machine\0${deviceId}\0${host}`).digest("hex");
  const appVersion = nonEmpty(version?.["version"]);
  const deviceCpu = cpus()[0]?.model.split(" ")[0];
  const osVersion = `${platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : platform} ${release()}`;
  return {
    edition,
    machineId,
    deviceId,
    ...appVersion === void 0 ? {} : { appVersion },
    ...deviceCpu === void 0 ? {} : { deviceCpu },
    osVersion,
    platform
  };
}
async function readJsonFile(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
async function readHostname() {
  try {
    const { hostname } = await import("node:os");
    return nonEmpty(hostname());
  } catch {
    return void 0;
  }
}
async function resolveTraeIdentity(candidates, edition, options = {}) {
  try {
    return await pickTraeStorageIdentity(candidates, options);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith(STORAGE_MISSING_PREFIX)) throw error;
    return readTraeCliIdentity(edition, options);
  }
}
function identityHeaders(identity) {
  return {
    "x-machine-id": identity.machineId,
    "x-device-id": identity.deviceId,
    "x-device-type": identity.platform === "darwin" ? "mac" : identity.platform === "win32" ? "windows" : identity.platform,
    ...identity.deviceBrand === void 0 ? {} : { "x-device-brand": identity.deviceBrand },
    ...identity.deviceCpu === void 0 ? {} : { "x-device-cpu": identity.deviceCpu },
    ...identity.osVersion === void 0 ? {} : { "x-os-version": identity.osVersion },
    ...identity.appVersion === void 0 ? {} : { "x-app-version": identity.appVersion, "x-ide-version": identity.appVersion },
    ...identity.buildVersion === void 0 ? {} : { "x-app-version-code": identity.buildVersion, "x-ide-version-code": identity.buildVersion },
    "x-ide-version-type": "stable"
  };
}

// vendor/trae/protocol.ts
import { randomUUID } from "node:crypto";
var TRAE_VERSION_CODE_FALLBACK = "20260716";
function normalizeTraeVersionCode(buildVersion) {
  if (buildVersion === void 0 || buildVersion.trim() === "") return TRAE_VERSION_CODE_FALLBACK;
  const trimmed = buildVersion.trim();
  return /^\d+$/.test(trimmed) ? trimmed : TRAE_VERSION_CODE_FALLBACK;
}
function buildTraeHeaders(credential, identity, options = {}) {
  const requestId = options.requestId ?? randomUUID();
  const traceId = requestId.replaceAll("-", "").slice(0, 32);
  const profile = options.profile ?? "agent-task";
  const common = {
    "Authorization": `Cloud-IDE-JWT ${credential.accessToken}`,
    "X-Ide-Token": credential.accessToken,
    "x-plugin-channel": "icube-ai",
    "User-Agent": `Trae/${identity.appVersion ?? identity.buildVersion ?? "unknown"}`,
    "x-app-id": options.appId ?? "6eefa01c-1036-4c7e-9ca5-d891f63bfcd8",
    ...identityHeaders(identity),
    // The upstream binds these as numbers; a dotted build string is rejected.
    "x-app-version-code": normalizeTraeVersionCode(identity.buildVersion),
    "x-ide-version-code": normalizeTraeVersionCode(identity.buildVersion),
    "x-custom-trace-id": traceId,
    "x-flow-traceparent": `04-${traceId}-${traceId.slice(0, 16)}-01`,
    "request-traffic-type": "prod",
    "Content-Type": "application/json"
  };
  if (profile === "native-curl") {
    return {
      "Content-Type": "application/json",
      "request-traffic-type": "prod",
      "x-app-id": options.appId ?? "6eefa01c-1036-4c7e-9ca5-d891f63bfcd8",
      ...identityHeaders(identity),
      "x-custom-trace-id": traceId,
      "x-flow-traceparent": `04-${traceId}-${traceId.slice(0, 16)}-01`,
      "X-Ide-Token": credential.accessToken
    };
  }
  if (profile === "model-detail") return { ...common, "Accept": "application/json" };
  if (profile === "raw-chat") return { ...common, "Accept": "text/event-stream" };
  return {
    ...common,
    "X-Cloudide-Token": credential.accessToken,
    "x-uid": credential.userId,
    "x-request-id": requestId,
    "x-trae-request-id": requestId,
    "Accept": "text/event-stream"
  };
}
var buildTraeCnHeaders = buildTraeHeaders;
function traeEndpoint(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

// vendor/trae/region.ts
var REGION_GATEWAYS = {
  cn: {
    chat: "https://trae-api-cn.mchost.guru",
    remote: "https://solo.trae.cn/api/remote/v1",
    pay: "https://api.trae.cn"
  },
  ai: {
    chat: "https://coresg-normal.trae.ai",
    remote: "https://coresg-normal.trae.ai/api/remote/v1",
    pay: "https://growsg-normal.trae.ai"
  }
};
function regionOfEdition(edition) {
  return edition === "sg" || edition === "solo-sg" ? "ai" : "cn";
}
function regionOfUserRegion(value) {
  const raw = typeof value === "object" && value !== null && !Array.isArray(value) ? value["region"] : value;
  if (typeof raw !== "string") return void 0;
  const lowered = raw.trim().toLowerCase();
  if (lowered === "cn") return "cn";
  if (lowered === "sg" || lowered === "ai") return "ai";
  return void 0;
}
function regionOfHost(host) {
  if (host === void 0) return void 0;
  const trimmed = host.trim();
  if (trimmed === "") return void 0;
  let hostname;
  try {
    hostname = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return void 0;
  }
  if (hostname === "trae.ai" || hostname.endsWith(".trae.ai")) return "ai";
  if (hostname === "trae.cn" || hostname.endsWith(".trae.cn") || hostname.endsWith(".trae.com.cn")) return "cn";
  return void 0;
}
function regionOfCredential(credential) {
  return regionOfUserRegion(credential.userRegion) ?? regionOfHost(credential.host) ?? regionOfEdition(credential.edition);
}

// vendor/trae/reasoning.ts
var TRAE_REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"];
function parseReasoningCapability(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  const record2 = value;
  const rawOptions = Array.isArray(record2["reasoning_effort_options"]) ? record2["reasoning_effort_options"] : [];
  const supported = rawOptions.filter((item) => typeof item === "string" && TRAE_REASONING_EFFORTS.includes(item));
  const rawDefault = record2["default_reasoning_effort"];
  const defaultEffort = typeof rawDefault === "string" && supported.includes(rawDefault) ? rawDefault : void 0;
  if (supported.length === 0 && defaultEffort === void 0) return void 0;
  return { supported, ...defaultEffort === void 0 ? {} : { defaultEffort } };
}

// vendor/trae/solo.ts
var TRAE_SOLO_FUNCTION = "solo_work_lite";
var TRAE_DIRECTORY_FUNCTIONS = {
  cn: ["solo_work_remote", TRAE_SOLO_FUNCTION, "solo_agent_remote", "chat_v3", "solo_coder"],
  ai: ["solo_work_remote", TRAE_SOLO_FUNCTION, "solo_agent_remote", "chat_v3"]
};
var TRAE_SOLO_CHAT_PATH = "/api/agent/v3/llm_utils_chat";
var TRAE_SOLO_MODELS_PATH = "/api/ide/v1/get_detail_param";
function classify(status) {
  if (status === 401 || status === 403) return "authentication";
  if (status === 402) return "hard_credit";
  if (status === 429) return "soft_rate";
  if (status === 404) return "not_found";
  if (status >= 500) return "server";
  return "client";
}
function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
}
function prepareSoloBody(source, defaultModel = "glm-5.2", functionName) {
  const input = JSON.parse(source);
  const requestedModel = typeof input["model"] === "string" && input["model"].trim() !== "" ? input["model"].trim() : defaultModel;
  const model = requestedModel;
  const body = {
    ...Array.isArray(input["messages"]) ? { messages: input["messages"] } : {},
    model,
    config_name: model,
    // The directory function that actually lists this model (see
    // TRAE_DIRECTORY_FUNCTIONS). The bridge may have already stamped the exact
    // function it learned from the directory, which wins over the default.
    function: typeof input["function"] === "string" && input["function"] !== "" ? input["function"] : functionName ?? TRAE_SOLO_FUNCTION,
    stream: true,
    ...Array.isArray(input["tools"]) ? { tools: input["tools"] } : {},
    ...typeof input["reasoning_effort"] === "string" ? { reasoning_effort: input["reasoning_effort"] } : {}
  };
  if (Array.isArray(body["messages"])) {
    for (const raw of body["messages"]) {
      if (typeof raw !== "object" || raw === null) continue;
      const message = raw;
      if (message["role"] === "developer") message["role"] = "system";
      if (typeof message["content"] === "string") message["content"] = [{ type: "text", text: message["content"] }];
      if (message["role"] === "assistant" && Array.isArray(message["tool_calls"])) {
        for (const rawCall of message["tool_calls"]) {
          if (typeof rawCall !== "object" || rawCall === null) continue;
          const call = rawCall;
          if (typeof call["function"] === "object" && call["function"] !== null) {
            call["function_call"] = call["function"];
            delete call["function"];
          }
        }
      }
      if (message["role"] === "tool") {
        message["role"] = "tool";
        if (typeof message["tool_call_id"] !== "string" || message["tool_call_id"] === "") {
          throw new Error("Trae SOLO tool message requires tool_call_id");
        }
      }
    }
  }
  if (Array.isArray(body["tools"])) {
    for (const raw of body["tools"]) {
      if (typeof raw !== "object" || raw === null) continue;
      const fn = raw["function"];
      if (typeof fn !== "object" || fn === null) continue;
      const record2 = fn;
      if (typeof record2["parameters"] === "object" && record2["parameters"] !== null) record2["parameters"] = JSON.stringify(record2["parameters"]);
    }
  }
  return JSON.stringify(body);
}
function wireCreditMultiplier(config) {
  const raw = config["display_contact_config"];
  if (typeof raw !== "string" || raw === "") return void 0;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return void 0;
  }
  if (typeof parsed !== "object" || parsed === null) return void 0;
  const consumption = parsed["consumption_rate"];
  if (typeof consumption !== "object" || consumption === null) return void 0;
  const entry = consumption;
  if (entry["enable"] !== true) return void 0;
  const data = entry["data"];
  if (typeof data !== "object" || data === null) return void 0;
  return finitePositive(data["rate"]);
}
var TraeSoloUpstreamClient = class {
  constructor(options) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }
  options;
  fetchImpl;
  /**
   * Read the callable roster for this credential's region.
   *
   * Every function in {@link TRAE_DIRECTORY_FUNCTIONS} is asked, in order, and
   * their answers are unioned: the first function to list a `config_name` owns
   * it. Trae splits its roster across SOLO modes, and a model is only callable
   * through the function that lists it (glm-5.3 exists solely under
   * `solo_work_remote` on the CN gateway). Asking one function therefore
   * silently hides models that the other one serves. The remote directory
   * remains the merge skeleton, so agent-internal entries (search_agent_*,
   * paygo variants) never surface even though they appear here.
   */
  async fetchModels(signal) {
    const [credential, identity] = await Promise.all([this.options.credential(), this.options.identity()]);
    const region = regionOfCredential(credential);
    const base = this.options.baseUrl ?? REGION_GATEWAYS[region].chat;
    const headers = { ...buildTraeCnHeaders(credential, identity), Accept: "application/json" };
    const byId = /* @__PURE__ */ new Map();
    const failures = [];
    for (const directoryFunction of TRAE_DIRECTORY_FUNCTIONS[region]) {
      let list;
      try {
        const response = await this.fetchImpl(traeEndpoint(base, TRAE_SOLO_MODELS_PATH), {
          method: "POST",
          headers,
          body: JSON.stringify({
            function: directoryFunction,
            config_names: null,
            need_prompt: false,
            current_config_info: null,
            poly_prompt: true,
            mode_type: null,
            agent_type: null
          }),
          signal: signal ?? AbortSignal.timeout(3e4)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const document = await response.json();
        list = Array.isArray(document["config_info_list"]) ? document["config_info_list"] : [];
      } catch (error) {
        failures.push(`${directoryFunction}: ${String(error).slice(0, 80)}`);
        continue;
      }
      this.collectModels(list, directoryFunction, byId);
    }
    const models = [...byId.values()];
    if (models.length === 0) {
      throw new Error(`Trae SOLO models response contained no models (${failures.join("; ") || "empty directory"})`);
    }
    return models;
  }
  /** Merge one function's config list into the shared catalogue (first wins). */
  collectModels(list, directoryFunction, byId) {
    for (const raw of list) {
      if (typeof raw !== "object" || raw === null) continue;
      const config = raw;
      const id = typeof config["config_name"] === "string" ? config["config_name"] : "";
      if (id === "") continue;
      const display = typeof config["display_config"] === "object" && config["display_config"] !== null ? config["display_config"] : {};
      const details = Array.isArray(config["model_detail_list"]) ? config["model_detail_list"] : [];
      const detail = typeof details[0] === "object" && details[0] !== null ? details[0] : {};
      const contextTokens = typeof config["context_window_tokens"] === "object" && config["context_window_tokens"] !== null ? config["context_window_tokens"] : {};
      const promptMaxTokens = finitePositive(detail["prompt_max_tokens"]);
      const devTokens = finitePositive(contextTokens["dev"]);
      const contextWindow = promptMaxTokens ?? devTokens;
      const maxTokens = finitePositive(detail["max_tokens"]);
      const reasoning = parseReasoningCapability({ ...config, ...detail });
      const creditMultiplier = wireCreditMultiplier(config);
      if (byId.has(id)) continue;
      byId.set(id, {
        id,
        name: typeof display["display_name"] === "string" && display["display_name"] !== "" ? display["display_name"] : id,
        ...contextWindow === void 0 ? {} : { contextWindow },
        ...maxTokens === void 0 ? {} : { maxTokens },
        ...reasoning === void 0 ? {} : { reasoning },
        ...creditMultiplier === void 0 ? {} : { creditMultiplier },
        function: directoryFunction
      });
    }
  }
  async chatStream(bodyJson, signal, functionName) {
    let prepared;
    try {
      prepared = prepareSoloBody(bodyJson, void 0, functionName);
    } catch {
      return { ok: false, status: 400, kind: "client", message: "invalid JSON request" };
    }
    const [credential, identity] = await Promise.all([this.options.credential(), this.options.identity()]);
    const headers = buildTraeCnHeaders(credential, identity);
    const base = this.options.baseUrl ?? REGION_GATEWAYS[regionOfCredential(credential)].chat;
    let response;
    try {
      response = await this.fetchImpl(traeEndpoint(base, TRAE_SOLO_CHAT_PATH), {
        method: "POST",
        headers,
        body: prepared,
        signal: signal ?? AbortSignal.timeout(12e4)
      });
    } catch (error) {
      return { ok: false, status: 0, kind: "server", message: `transport error: ${String(error)}` };
    }
    if (response.ok) return { ok: true, response };
    const text = (await response.text()).slice(0, 1024);
    this.options.log?.("dsh-connect-trae: llm_utils_chat rejected", {
      status: response.status,
      model: JSON.parse(prepared)["model"],
      configName: JSON.parse(prepared)["config_name"],
      reasoningEffort: JSON.parse(prepared)["reasoning_effort"],
      body: text
    });
    return { ok: false, status: response.status, kind: classify(response.status), message: text || `Trae SOLO returned HTTP ${response.status}` };
  }
};

// vendor/trae/solo-bridge.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// vendor/trae/sse.ts
var SseDecoder = class {
  buffer = "";
  event;
  id;
  retry;
  data = [];
  push(chunk) {
    this.buffer += chunk;
    const events = [];
    while (true) {
      const match = /\r?\n/.exec(this.buffer);
      if (match === null || match.index === void 0) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const emitted = this.consumeLine(line);
      if (emitted !== void 0) events.push(emitted);
    }
    return events;
  }
  finish() {
    const events = [];
    if (this.buffer !== "") {
      const emitted = this.consumeLine(this.buffer);
      this.buffer = "";
      if (emitted !== void 0) events.push(emitted);
    }
    const final = this.dispatch();
    if (final !== void 0) events.push(final);
    return events;
  }
  consumeLine(line) {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return void 0;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
    else if (field === "id" && !value.includes("\0")) this.id = value;
    else if (field === "retry" && /^\d+$/.test(value)) this.retry = Number(value);
    return void 0;
  }
  dispatch() {
    if (this.data.length === 0) {
      this.event = void 0;
      this.retry = void 0;
      return void 0;
    }
    const result = {
      ...this.event === void 0 || this.event === "" ? {} : { event: this.event },
      data: this.data.join("\n"),
      ...this.id === void 0 ? {} : { id: this.id },
      ...this.retry === void 0 ? {} : { retry: this.retry }
    };
    this.event = void 0;
    this.retry = void 0;
    this.data = [];
    return result;
  }
};
function decodeTraeEvent(event) {
  if (event.data === "[DONE]") return { type: "done", finishReason: "stop" };
  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch {
    return { type: "unknown", ...event.event === void 0 ? {} : { event: event.event }, data: event.data };
  }
  const record2 = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload : {};
  if (event.event === "request_wait_in_queue") {
    return { type: "queue", ...typeof record2["position"] === "number" ? { position: record2["position"] } : {} };
  }
  if (event.event === "progress_notice") return { type: "progress", notice: payload };
  if (event.event === "token_usage") {
    return {
      type: "usage",
      ...typeof record2["prompt_tokens"] === "number" ? { inputTokens: record2["prompt_tokens"] } : {},
      ...typeof record2["completion_tokens"] === "number" ? { outputTokens: record2["completion_tokens"] } : {},
      ...typeof record2["total_tokens"] === "number" ? { totalTokens: record2["total_tokens"] } : {},
      ...typeof record2["reasoning_tokens"] === "number" ? { reasoningTokens: record2["reasoning_tokens"] } : {},
      ...typeof record2["cache_read_input_tokens"] === "number" ? { cacheReadTokens: record2["cache_read_input_tokens"] } : {},
      ...typeof record2["cache_creation_input_tokens"] === "number" ? { cacheWriteTokens: record2["cache_creation_input_tokens"] } : {}
    };
  }
  if (event.event === "done" || typeof record2["finish_reason"] === "string" && record2["response"] === void 0) {
    return { type: "done", finishReason: typeof record2["finish_reason"] === "string" ? record2["finish_reason"] : "stop" };
  }
  if (event.event === "output" || record2["response"] !== void 0 || record2["reasoning_content"] !== void 0) {
    return {
      type: "delta",
      text: typeof record2["response"] === "string" ? record2["response"] : "",
      ...typeof record2["reasoning_content"] === "string" ? { reasoning: record2["reasoning_content"] } : {},
      ...record2["tool_calls"] === void 0 || record2["tool_calls"] === null ? {} : { toolCalls: record2["tool_calls"] }
    };
  }
  return { type: "unknown", ...event.event === void 0 ? {} : { event: event.event }, data: payload };
}

// vendor/trae/solo-bridge.ts
var TRAE_ERROR_HINTS = {
  1005: "Trae requires a paid plan for this model; the current account's plan does not cover it",
  4001: "Trae does not serve this model under the SOLO function the request used (config_name rejected)",
  4008: "Trae quota is exhausted for the current account",
  4011: "Trae refused this model under the SOLO function the request used"
};
function traeErrorPlan(extra) {
  let value = extra;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return void 0;
    }
  }
  if (typeof value !== "object" || value === null) return void 0;
  const plan = value["plan"];
  return typeof plan === "number" ? plan : void 0;
}
function describeTraeFailure(failure) {
  const plan = traeErrorPlan(failure.extra);
  const parts = [
    failure.code === void 0 ? "Trae refused the request" : TRAE_ERROR_HINTS[failure.code] ?? "Trae refused the request",
    ...plan === void 0 ? [] : [`plan ${plan}`],
    ...failure.code === void 0 ? [] : [`Trae code ${failure.code}`]
  ];
  const detail = failure.message.trim();
  return detail === "" ? parts.join(" \xB7 ") : `${parts.join(" \xB7 ")} \xB7 upstream: ${detail}`;
}
function classifyTraeFailure(failure) {
  return failure.code === 1005 || failure.code === 4008 ? { status: 402, kind: "hard_credit" } : { status: 400, kind: "client" };
}
function traeFailureOf(decoded) {
  if (decoded.type !== "unknown") return void 0;
  const payload = decoded.data;
  const code = typeof payload?.["code"] === "number" ? payload["code"] : void 0;
  if (decoded.event !== "error" && !(code !== void 0 && code >= 4e3)) return void 0;
  return {
    ...code === void 0 ? {} : { code },
    message: typeof payload?.["message"] === "string" ? payload["message"] : "",
    ...payload?.["extra"] === void 0 ? {} : { extra: payload["extra"] }
  };
}
function normalizeToolCalls(value) {
  if (!Array.isArray(value)) return [];
  const calls = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const record2 = raw;
    const rawFunction = typeof record2["function_call"] === "object" && record2["function_call"] !== null ? record2["function_call"] : typeof record2["function"] === "object" && record2["function"] !== null ? record2["function"] : {};
    const fn = {
      ...typeof rawFunction["name"] === "string" ? { name: rawFunction["name"] } : {},
      ...typeof rawFunction["arguments"] === "string" ? { arguments: rawFunction["arguments"] } : {}
    };
    calls.push({
      index: typeof record2["index"] === "number" ? record2["index"] : calls.length,
      ...typeof record2["id"] === "string" ? { id: record2["id"] } : {},
      ...record2["type"] === "function" ? { type: "function" } : {},
      ...Object.keys(fn).length === 0 ? {} : { function: fn }
    });
  }
  return calls;
}
function bridgeTraeSoloStream(response, model) {
  const source = response.body;
  if (source === null) return new Response(null, { status: 502 });
  return bridgeTraeSource(source, model);
}
function bridgeTraeSource(source, model, discardedUsage = {}, attempts = 1) {
  const id = `chatcmpl-${randomUUID2().replaceAll("-", "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1e3);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const sse = new SseDecoder();
  let sawToolCalls = false;
  let emittedFinishReason = false;
  let upstreamEnded = false;
  let upstreamError;
  let usage = Object.keys(discardedUsage).length ? {
    ...Object.fromEntries(["prompt_tokens", "completion_tokens", "total_tokens"].filter((k) => discardedUsage[k] !== void 0).map((k) => [k, discardedUsage[k]])),
    prompt_tokens_details: Object.fromEntries(["cached_tokens", "cache_write_tokens"].filter((k) => discardedUsage[k] !== void 0).map((k) => [k, discardedUsage[k]])),
    ...discardedUsage["reasoning_tokens"] === void 0 ? {} : { completion_tokens_details: { reasoning_tokens: discardedUsage["reasoning_tokens"] } },
    trae_attempts: attempts
  } : void 0;
  const chunk = (delta, finishReason = null) => encoder.encode(`data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...usage === void 0 ? {} : { usage }
  })}

`);
  const stream = new ReadableStream({
    async start(controller) {
      const reader = source.getReader();
      const consume = (event) => {
        const decoded = decodeTraeEvent(event);
        if (decoded.type === "unknown") {
          const failure = traeFailureOf(decoded);
          if (failure !== void 0) {
            upstreamError = new Error(describeTraeFailure(failure));
          }
          return;
        }
        if (decoded.type === "delta") {
          const delta = {};
          if (decoded.text !== "") delta["content"] = decoded.text;
          if (decoded.reasoning !== void 0 && decoded.reasoning !== "") delta["reasoning_content"] = decoded.reasoning;
          const toolCalls = normalizeToolCalls(decoded.toolCalls);
          if (toolCalls.length > 0) {
            sawToolCalls = true;
            delta["tool_calls"] = toolCalls;
          }
          if (Object.keys(delta).length > 0) controller.enqueue(chunk(delta));
        } else if (decoded.type === "usage") {
          const cacheRead = decoded.cacheReadTokens;
          const cacheWrite = decoded.cacheWriteTokens;
          const details = {
            ...cacheRead === void 0 ? {} : { cached_tokens: cacheRead },
            ...cacheWrite === void 0 ? {} : { cache_write_tokens: cacheWrite }
          };
          usage = {
            ...decoded.inputTokens === void 0 ? {} : { prompt_tokens: decoded.inputTokens },
            ...decoded.outputTokens === void 0 ? {} : { completion_tokens: decoded.outputTokens },
            ...decoded.totalTokens === void 0 ? {} : { total_tokens: decoded.totalTokens },
            // Omit the details object entirely when Trae sent neither field, so
            // a provider that never reports cache keeps its previous wire shape
            // instead of gaining `prompt_tokens_details: {}`.
            ...Object.keys(details).length === 0 ? {} : { prompt_tokens_details: details }
          };
          if (attempts > 1) usage["trae_attempts"] = attempts;
          for (const field of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
            if (discardedUsage[field] !== void 0) usage[field] = (typeof usage[field] === "number" ? usage[field] : 0) + discardedUsage[field];
          }
          if (discardedUsage["cached_tokens"] !== void 0 || discardedUsage["cache_write_tokens"] !== void 0) {
            const details2 = usage["prompt_tokens_details"] ?? {};
            for (const field of ["cached_tokens", "cache_write_tokens"]) if (discardedUsage[field] !== void 0) details2[field] = (details2[field] ?? 0) + discardedUsage[field];
            usage["prompt_tokens_details"] = details2;
          }
          if (decoded.reasoningTokens !== void 0 || discardedUsage["reasoning_tokens"] !== void 0) usage["completion_tokens_details"] = { reasoning_tokens: (decoded.reasoningTokens ?? 0) + (discardedUsage["reasoning_tokens"] ?? 0) };
        } else if (decoded.type === "done") {
          upstreamEnded = true;
          if (!emittedFinishReason) {
            emittedFinishReason = true;
            if (upstreamError !== void 0) {
              controller.error(upstreamError);
              return;
            }
            controller.enqueue(chunk({}, sawToolCalls ? "tool_calls" : decoded.finishReason || "stop"));
          }
        }
      };
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          for (const event of sse.push(decoder.decode(next.value, { stream: true }))) consume(event);
        }
        for (const event of sse.finish()) consume(event);
        if (upstreamError !== void 0 && !upstreamEnded) {
          controller.error(upstreamError);
          return;
        }
        if (!emittedFinishReason) {
          emittedFinishReason = true;
          controller.enqueue(chunk({}, sawToolCalls ? "tool_calls" : "stop"));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      return source.cancel(reason);
    }
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
var PEEK_MAX_CHUNKS = 64;
var PEEK_MAX_BYTES = 262144;
function replayTraeSource(buffered, reader, ended) {
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      const chunk = buffered[index];
      if (chunk !== void 0) {
        index += 1;
        controller.enqueue(chunk);
        return;
      }
      if (ended) {
        controller.close();
        return;
      }
      const next = await reader.read();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {
      });
    }
  });
}
async function openTraeSource(response) {
  const body = response.body;
  if (body === null) return { ok: false, status: 502, kind: "server", message: "Trae upstream returned no response body" };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const sse = new SseDecoder();
  const buffered = [];
  let bytes = 0;
  let ended = false;
  try {
    while (buffered.length < PEEK_MAX_CHUNKS && bytes < PEEK_MAX_BYTES) {
      const next = await reader.read();
      if (next.done) {
        ended = true;
        break;
      }
      buffered.push(next.value);
      bytes += next.value.byteLength;
      let answered = false;
      for (const event of sse.push(decoder.decode(next.value, { stream: true }))) {
        const decoded = decodeTraeEvent(event);
        const failure = traeFailureOf(decoded);
        if (failure !== void 0) {
          await reader.cancel().catch(() => {
          });
          return { ok: false, ...classifyTraeFailure(failure), message: describeTraeFailure(failure) };
        }
        if (decoded.type !== "unknown") answered = true;
      }
      if (answered) break;
    }
  } catch (error) {
    reader.releaseLock();
    return { ok: false, status: 0, kind: "server", message: `transport error: ${String(error)}` };
  }
  return { ok: true, source: replayTraeSource(buffered, reader, ended) };
}
async function bridgeTraeSoloStreamOrFail(response, model) {
  const opened = await openTraeSource(response);
  if (!opened.ok) return opened;
  return { ok: true, response: bridgeTraeSource(opened.source, model) };
}
async function openTraeAnswer(response, signal) {
  if (response.body === null) return { ok: false, status: 502, kind: "server", message: "Trae upstream returned no response body" };
  const reader = response.body.getReader(), decoder = new TextDecoder(), sse = new SseDecoder();
  const buffered = [];
  const discardedUsage = {};
  let bytes = 0, reasoning = false, visible = false, terminal = false, finishReason = "", ended = false;
  const failure = (message, reasoningOnly = false) => ({ ok: false, status: 502, kind: "server", message, reasoningOnly, discardedUsage });
  const release2 = async () => {
    await reader.cancel().catch(() => {
    });
    reader.releaseLock();
  };
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => {
    });
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (; ; ) {
      if (signal?.aborted) throw signal.reason;
      const next = await reader.read();
      if (signal?.aborted) throw signal.reason;
      let events;
      if (next.done) {
        ended = true;
        events = [...sse.push(decoder.decode()), ...sse.finish()];
      } else {
        bytes += next.value.byteLength;
        if (bytes > 4 * 1024 * 1024 || buffered.length >= 4096) {
          await release2();
          return failure("Trae pre-answer prefix exceeds the 4 MiB / 4096 chunk bound");
        }
        buffered.push(next.value);
        events = sse.push(decoder.decode(next.value, { stream: true }));
      }
      for (const event of events) {
        const decoded = decodeTraeEvent(event), rejected = traeFailureOf(decoded);
        if (rejected) {
          await release2();
          return { ok: false, ...classifyTraeFailure(rejected), message: describeTraeFailure(rejected) };
        }
        if (decoded.type === "delta") {
          reasoning ||= !!decoded.reasoning?.length;
          visible ||= !!decoded.text.trim() || Array.isArray(decoded.toolCalls) && decoded.toolCalls.length > 0;
        } else if (decoded.type === "usage") {
          const counters = { prompt_tokens: decoded.inputTokens, completion_tokens: decoded.outputTokens, total_tokens: decoded.totalTokens, cached_tokens: decoded.cacheReadTokens, cache_write_tokens: decoded.cacheWriteTokens, reasoning_tokens: decoded.reasoningTokens };
          for (const [key, value] of Object.entries(counters)) if (typeof value === "number" && Number.isFinite(value) && value >= 0) discardedUsage[key] = value;
        } else if (decoded.type === "done") {
          terminal = true;
          finishReason = decoded.finishReason;
        }
      }
      if (visible) return { ok: true, source: replayTraeSource(buffered, reader, ended) };
      if (terminal || ended) {
        await release2();
        const retryable = terminal && finishReason === "stop" && reasoning;
        return failure(retryable ? "Trae reasoning-only stop: no visible answer or tool calls" : "Trae stream ended without a visible answer or tool calls", retryable);
      }
    }
  } catch (error) {
    await release2();
    return signal?.aborted ? { ok: false, status: 499, kind: "client", message: "Trae request cancelled before a usable answer" } : { ok: false, status: 502, kind: "server", message: "Trae pre-answer stream read failed" };
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
var TraeSoloBridge = class {
  constructor(upstream, catalog, wireResolver) {
    this.upstream = upstream;
    this.catalog = catalog;
    this.wireResolver = wireResolver;
  }
  upstream;
  catalog;
  wireResolver;
  async chatStream(bodyJson, signal) {
    let model = "glm-5.2";
    let prepared = bodyJson;
    try {
      const input = JSON.parse(bodyJson);
      if (typeof input["model"] === "string" && input["model"] !== "") model = input["model"];
      const entry = this.catalog?.current().find((item) => item.id === model);
      const fromCatalog = entry?.wireConfigName === void 0 ? void 0 : { configName: entry.wireConfigName, ...entry.wireFunction === void 0 ? {} : { function: entry.wireFunction } };
      const fromResolver = this.wireResolver?.(model) ?? this.wireResolver?.(entry?.name ?? "");
      const target = fromCatalog ?? fromResolver;
      const wireModel = target?.configName ?? model;
      const wireFunction = target?.function ?? entry?.wireFunction;
      if (wireModel !== input["model"]) {
        input["model"] = wireModel;
      }
      if (wireFunction !== void 0 && input["function"] !== wireFunction) {
        input["function"] = wireFunction;
      }
      if (wireModel !== JSON.parse(bodyJson)["model"] || wireFunction !== void 0) {
        prepared = JSON.stringify(input);
      }
      if (typeof input["reasoning_effort"] === "string") {
        const info = entry;
        const efforts = info?.reasoningEfforts;
        const requested = input["reasoning_effort"];
        const mapped = efforts?.[requested];
        const allowed = efforts === void 0 ? [] : Object.values(efforts).filter((value) => typeof value === "string");
        if (typeof mapped === "string") input["reasoning_effort"] = mapped;
        else if (!allowed.includes(requested)) delete input["reasoning_effort"];
        prepared = JSON.stringify(input);
      }
    } catch {
      return { ok: false, status: 400, kind: "client", message: "invalid JSON request" };
    }
    if (model !== "deepseek-v4.1-flash") {
      const result = await this.upstream.chatStream(prepared, signal);
      if (!result.ok) return result;
      return await bridgeTraeSoloStreamOrFail(result.response, model);
    }
    const attemptSignal = signal ?? AbortSignal.timeout(12e4);
    let discardedUsage = {};
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attemptSignal.aborted) return { ok: false, status: 499, kind: "client", message: "Trae request cancelled before retry" };
      const result = await this.upstream.chatStream(prepared, attemptSignal);
      if (!result.ok) return result;
      const opened = await openTraeAnswer(result.response, attemptSignal);
      if (opened.ok) {
        const response = bridgeTraeSource(opened.source, model, discardedUsage, attempt);
        response.headers.set("x-ai-credit-trae-attempts", String(attempt));
        if (attempt > 1) response.headers.set("x-ai-credit-trae-retry-reason", "reasoning_only_stop");
        return { ok: true, response };
      }
      if (!opened.reasoningOnly || attempt === 2) return { ...opened, message: opened.message + " (attempts=" + attempt + ")" };
      discardedUsage = opened.discardedUsage ?? {};
    }
    return { ok: false, status: 502, kind: "server", message: "Trae empty answer retry exhausted" };
  }
};

// vendor/trae/model-metadata.ts
function finitePositive2(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
}
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function parseFeatures(value) {
  if (typeof value !== "string" || value === "") return void 0;
  try {
    return record(JSON.parse(value));
  } catch {
    return void 0;
  }
}
var EFFORT_MAP = {
  light: "low",
  high: "high",
  extra_high: "xhigh"
};
function parseTraeRemoteModel(value) {
  const raw = record(value);
  if (raw === void 0 || typeof raw.name !== "string" || raw.name === "") return void 0;
  const context = record(raw.context_window_tokens);
  const dev = finitePositive2(context?.["dev"]);
  const max = raw.max_mode === true ? finitePositive2(context?.["max"]) : void 0;
  const features = parseFeatures(raw.features);
  const consumption = record(features?.["consumption_rate"]);
  const consumptionData = record(consumption?.["data"]);
  const creditMultiplier = consumption?.["enable"] === true ? finitePositive2(consumptionData?.["rate"]) : void 0;
  const reasoningFeature = record(features?.["reasoning"]);
  const reasoningSupported = reasoningFeature?.["enable"] === true;
  const reasoningConfig = record(raw.reasoning_effort_config);
  const rawOptions = Array.isArray(reasoningConfig?.["options"]) ? reasoningConfig["options"] : [];
  const supported = rawOptions.flatMap((option) => {
    if (typeof option !== "string") return [];
    const effort = EFFORT_MAP[option];
    return effort === void 0 ? [] : [effort];
  });
  const rawDefault = reasoningConfig?.["default_level"];
  const mappedDefault = typeof rawDefault === "string" ? EFFORT_MAP[rawDefault] : void 0;
  const defaultEffort = mappedDefault !== void 0 && supported.includes(mappedDefault) ? mappedDefault : void 0;
  return {
    id: raw.name,
    name: typeof raw.display_name === "string" && raw.display_name !== "" ? raw.display_name : raw.name,
    multimodal: raw.multimodal === true,
    ...dev === void 0 ? {} : { contextWindow: dev },
    ...max === void 0 ? {} : { maxContextWindow: max },
    ...creditMultiplier === void 0 ? {} : { creditMultiplier },
    reasoningSupported,
    ...supported.length === 0 ? {} : { reasoning: { supported, ...defaultEffort === void 0 ? {} : { defaultEffort } } }
  };
}

// vendor/trae/solo-remote.ts
var TRAE_SOLO_REMOTE_BASE = "https://solo.trae.cn/api/remote/v1";
var TRAE_REMOTE_DIRECTORY_FUNCTIONS = {
  cn: ["solo_agent", "solo_agent_remote", "solo_work_remote", "solo_work_lite", "chat_v3", "solo_coder", "builder_v3"],
  ai: ["solo_agent", "solo_agent_remote", "solo_work_remote", "solo_work_lite", "chat_v3", "solo_coder", "builder_v3"]
};
function preferStrongerRow(candidate, incumbent) {
  if (incumbent === void 0) return candidate;
  const candidateMax = candidate.maxContextWindow;
  const incumbentMax = incumbent.maxContextWindow;
  if (candidateMax !== void 0 && incumbentMax === void 0) return candidate;
  if (candidateMax === void 0 && incumbentMax !== void 0) return incumbent;
  if (candidateMax !== void 0 && incumbentMax !== void 0 && candidateMax !== incumbentMax) {
    return candidateMax > incumbentMax ? candidate : incumbent;
  }
  return (candidate.contextWindow ?? 0) > (incumbent.contextWindow ?? 0) ? candidate : incumbent;
}
function remoteDressing(region) {
  return region === "ai" ? { referer: "https://coresg-normal.trae.ai/", timezone: "Asia/Singapore", language: "en" } : { referer: "https://solo.trae.cn/", timezone: "Asia/Shanghai", language: "zh-cn" };
}
var TraeSoloRemoteCatalogClient = class {
  constructor(options) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl;
  }
  options;
  fetchImpl;
  baseUrl;
  async headers(region) {
    const credential = await this.options.credential();
    const dressing = remoteDressing(region);
    return {
      "Authorization": `Cloud-IDE-JWT ${credential.accessToken}`,
      "Content-Type": "application/json",
      "x-trae-client-type": "web",
      "x-trae-user-timezone": dressing.timezone,
      "x-preferenced-language": dressing.language,
      "Referer": dressing.referer,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    };
  }
  async fetchModels(signal) {
    const credential = await this.options.credential();
    const region = regionOfCredential(credential);
    const base = this.baseUrl ?? REGION_GATEWAYS[region].remote;
    const headers = await this.headers(region);
    const functions = TRAE_REMOTE_DIRECTORY_FUNCTIONS[region].join(",");
    const response = await this.fetchImpl(`${base}/models?functions=${functions}`, { headers, signal: signal ?? AbortSignal.timeout(3e4) });
    if (!response.ok) throw new Error(`SOLO remote models returned HTTP ${response.status}`);
    const json = await response.json();
    const groups = json.data?.list ?? [];
    const byId = /* @__PURE__ */ new Map();
    for (const group of groups) {
      for (const raw of group.models ?? []) {
        const model = parseTraeRemoteModel(raw);
        if (model === void 0) continue;
        byId.set(model.id, preferStrongerRow(model, byId.get(model.id)));
      }
    }
    const models = [...byId.values()];
    if (models.length === 0) throw new Error("SOLO remote models response contained no models");
    return models;
  }
};

// vendor/trae/catalog.ts
var FALLBACK_TRAE_MODELS = [
  { id: "DeepSeek-V4-Flash-Official", name: "DeepSeek-V4-Flash", contextWindow: 2e5 },
  { id: "DeepSeek-V4-Pro-Official", name: "DeepSeek-V4-Pro", contextWindow: 2e5 },
  { id: "glm-5.2", name: "GLM-5.2", contextWindow: 2e5 },
  { id: "kimi-k2.6", name: "Kimi-K2.6", contextWindow: 2e5 }
];
var FALLBACK_TRAE_MODELS_AI = [
  { id: "gemini-3.1-pro", name: "Gemini-3.1-Pro-Preview", contextWindow: 2e5 },
  { id: "gemini-3-flash-solo", name: "Gemini-3-Flash-Preview", contextWindow: 2e5 },
  { id: "minimax-m3", name: "MiniMax-M3", contextWindow: 2e5 },
  { id: "minimax-m2.7", name: "MiniMax-M2.7", contextWindow: 2e5 },
  { id: "kimi-k2.5", name: "Kimi-K2.5", contextWindow: 2e5 },
  { id: "gpt-5.4", name: "GPT-5.4", contextWindow: 272e3 },
  { id: "gpt-5.2", name: "GPT-5.2", contextWindow: 272e3 }
];
function fallbackModelsFor(region) {
  return region === "ai" ? FALLBACK_TRAE_MODELS_AI : FALLBACK_TRAE_MODELS;
}
function traeInputModalities(model) {
  return [...model.input ?? ["text"]];
}
function traeModelDisplayName(model) {
  return model.creditMultiplier === void 0 ? model.name : `${model.name} \xB7 x${model.creditMultiplier.toFixed(2)}`;
}
function traeModelAcceptsImage(model, selected) {
  return selected.has(model.id) || model.multimodal === true;
}
function applyImageSelection(models, selected) {
  return models.map((model) => ({
    ...model,
    input: traeModelAcceptsImage(model, selected) ? ["text", "image"] : ["text"]
  }));
}
function displayKey(name) {
  return name.trim().toLowerCase();
}
function mergeTraeModelSources(remote, wire) {
  const wireByName = /* @__PURE__ */ new Map();
  const wireById = /* @__PURE__ */ new Map();
  for (const model of wire) {
    wireByName.set(displayKey(model.name), model);
    wireById.set(displayKey(model.id), model);
  }
  const result = [];
  for (const model of remote) {
    const wireModel = wireById.get(displayKey(model.id)) ?? wireByName.get(displayKey(model.name));
    const creditMultiplier = wireModel?.creditMultiplier ?? model.creditMultiplier;
    result.push({
      id: model.id,
      name: model.name,
      ...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
      ...model.maxContextWindow === void 0 ? {} : { maxContextWindow: model.maxContextWindow },
      ...creditMultiplier === void 0 ? {} : { creditMultiplier },
      input: ["text"],
      // Trae's own answer to "does this model read images". Carried through so
      // `applyImageSelection` can union it with the user's opt-ins (issue #16);
      // `input` stays text here and is decided by that single later pass.
      ...model.multimodal === void 0 ? {} : { multimodal: model.multimodal },
      reasoningSupported: model.reasoningSupported,
      ...model.reasoning === void 0 ? {} : {
        reasoning: model.reasoning,
        reasoningEfforts: Object.fromEntries(model.reasoning.supported.map((effort) => [effort, effort === "low" ? "light" : effort === "xhigh" ? "extra_high" : "high"]))
      },
      ...wireModel !== void 0 && wireModel.id !== "" && wireModel.id !== model.id ? { wireConfigName: wireModel.id } : {},
      ...wireModel?.function === void 0 ? {} : { wireFunction: wireModel.function }
    });
  }
  return result;
}
function applyContextBudgets(catalog, budgets = {}) {
  return catalog.map((model) => ({
    ...model,
    ...model.maxContextWindow !== void 0 && budgets[model.id] === model.maxContextWindow ? { contextWindow: model.maxContextWindow } : {}
  }));
}
function discoveredCatalog(models) {
  const result = [];
  for (const model of models) {
    result.push({
      id: model.id,
      name: model.name,
      ...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
      ...model.maxContextWindow === void 0 ? {} : { maxContextWindow: model.maxContextWindow },
      input: ["text"],
      ...model.creditMultiplier === void 0 ? {} : { creditMultiplier: model.creditMultiplier },
      // See mergeTraeModelSources: the upstream flag travels with the row so the
      // one later image pass can union it with the user's explicit opt-ins.
      ...model.multimodal === void 0 ? {} : { multimodal: model.multimodal },
      reasoningSupported: model.reasoningSupported,
      ...model.reasoning === void 0 ? {} : {
        reasoning: model.reasoning,
        reasoningEfforts: Object.fromEntries(model.reasoning.supported.map((effort) => [effort, effort === "low" ? "light" : effort === "xhigh" ? "extra_high" : "high"]))
      }
    });
  }
  return result;
}
function sanitizeCatalog(catalog) {
  return catalog.filter((model) => {
    if (model.id.endsWith("@1m")) return false;
    const legacy = model;
    return legacy.baseModelId === void 0 && legacy.maxContext !== true;
  });
}
function deriveCatalog(catalog, enabled, budgets = {}) {
  const selected = enabled.size === 0 ? catalog : catalog.filter((model) => enabled.has(model.id));
  return applyContextBudgets(selected, budgets);
}
var TraeCatalog = class {
  models;
  /**
   * @param region Seeds the static fallback for this region; each region's
   * provider must never serve the other region's roster before its first live
   * refresh lands.
   */
  constructor(region = "cn") {
    this.models = fallbackModelsFor(region);
  }
  current() {
    return this.models;
  }
  set(models) {
    if (models.length === 0) throw new Error("trae model catalog cannot be empty");
    this.models = models.map((model) => ({ ...model, ...model.input === void 0 ? {} : { input: [...model.input] } }));
  }
};

// vendor/trae/usage.ts
var TRAE_PAY_BASE = "https://api.trae.cn";
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function parseUsageSnapshot(payload) {
  const summaryRaw = payload["usage_summary"];
  const summary = {
    totalAmount: asNumber(summaryRaw?.["total_amount"]) ?? 0,
    consumedAmount: asNumber(summaryRaw?.["consumed_amount"]) ?? 0,
    consumptionRatio: asNumber(summaryRaw?.["consumption_ratio"]) ?? 0
  };
  const trial = payload["trial_status"];
  const packs = [];
  const rawPacks = Array.isArray(payload["user_entitlement_pack_list"]) ? payload["user_entitlement_pack_list"] : [];
  for (const raw of rawPacks) {
    if (typeof raw !== "object" || raw === null) continue;
    const pack = raw;
    const base = pack["entitlement_base_info"];
    const quota = base?.["quota"];
    const usage = pack["usage"];
    const productExtra = base?.["product_extra"];
    const packageExtra = productExtra?.["package_extra"];
    const packageQuota = packageExtra?.["quota"];
    const creditsLimit = asNumber(packageQuota?.["credits_limit"]) ?? asNumber(quota?.["credits_limit"]);
    const consumedCredits = asNumber(usage?.["credits_amount"]);
    const availableEndpoint = asNumber(base?.["available_endpoint"]);
    packs.push({
      displayDesc: typeof pack["display_desc"] === "string" ? pack["display_desc"] : "",
      entitlementId: typeof base?.["entitlement_id"] === "string" ? base["entitlement_id"] : "",
      endTimeMs: asNumber(base?.["end_time"]) ?? 0,
      currency: asNumber(base?.["currency"]) ?? 0,
      ...availableEndpoint === void 0 ? {} : { availableEndpoint },
      ...creditsLimit === void 0 ? {} : { creditsLimit },
      ...consumedCredits === void 0 ? {} : { consumedCredits }
    });
  }
  return {
    isCreditsBilling: payload["is_credits_billing"] === true,
    isDollarUsageBilling: payload["is_dollar_usage_billing"] === true,
    isPayFreshman: payload["is_pay_freshman"] === true,
    inTrial: trial?.["is_in_trial"] === true,
    trialEndTimeMs: asNumber(trial?.["trial_end_time"]) ?? 0,
    summary,
    packs
  };
}
var TraeUsageClient = class {
  constructor(options) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs ?? 3e4;
  }
  options;
  fetchImpl;
  baseUrl;
  timeoutMs;
  /** Region of the current credential; `cn` when unresolvable. */
  async currentRegion() {
    const credential = await this.options.credential();
    return credential === void 0 ? "cn" : regionOfCredential(credential);
  }
  /**
   * Pay base for the current credential's region. An explicit baseUrl (tests,
   * diagnostics) pins the endpoint; otherwise CN uses `api.trae.cn` and the
   * international region its own verified pay gateway.
   */
  async payBase() {
    return this.baseUrl ?? REGION_GATEWAYS[await this.currentRegion()].pay;
  }
  /**
   * Device id for the check-in routes, or undefined when the machine's
   * installation identity cannot be read. Best-effort on purpose: a missing
   * identity must not break the read-only status query, which the upstream
   * answers with or without the header.
   */
  async deviceIdHeader() {
    try {
      const deviceId = await this.options.deviceId?.();
      return deviceId === void 0 || deviceId === "" ? {} : { "x-device-id": deviceId };
    } catch {
      return {};
    }
  }
  async authedHeaders() {
    const credential = await this.options.credential();
    if (credential === void 0 || credential.accessToken === "") {
      throw new Error("Trae credential is not available; cannot query usage");
    }
    const origin = await this.currentRegion() === "ai" ? "https://www.trae.ai" : "https://www.trae.cn";
    return {
      "Authorization": `Cloud-IDE-JWT ${credential.accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
      "Origin": origin,
      "Referer": `${origin}/`
    };
  }
  async post(path, data, signal, extraHeaders = {}) {
    const headers = { ...await this.authedHeaders(), ...extraHeaders };
    const response = await this.fetchImpl(`${await this.payBase()}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
      signal: signal ?? AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`Trae usage endpoint ${path} returned HTTP ${response.status}`);
    return await response.json();
  }
  /**
   * Subscription/pay status of an international (ai) account. The CN region
   * never calls this (its contract is unverified there); the ai region uses
   * this instead of the Work-credit `snapshot`.
   */
  async payStatus(signal) {
    const region = await this.currentRegion();
    if (region !== "ai") throw new Error("Trae pay status is only available for the international (ai) region");
    const payload = await this.post("/trae/api/v1/pay/ide_user_pay_status", {}, signal);
    const flag = (key) => payload[key] === true;
    const trial = typeof payload["trial_status"] === "object" && payload["trial_status"] !== null ? payload["trial_status"] : {};
    const fissionStart = asNumber(payload["solo_fission_start_time"]);
    const fissionExpire = asNumber(payload["solo_fission_expire_time"]);
    const fissionMax = asNumber(payload["solo_fission_max_usage"]);
    const payIdentity = asNumber(payload["user_pay_identity"]);
    const payIdentityStr = typeof payload["user_pay_identity_str"] === "string" && payload["user_pay_identity_str"].trim() !== "" ? payload["user_pay_identity_str"].trim() : void 0;
    return {
      isDollarUsageBilling: flag("is_dollar_usage_billing"),
      hasPackage: flag("has_package"),
      isPayFreshman: flag("is_pay_freshman") || flag("is_pay_freshman_v2"),
      inTrial: trial["is_in_trial"] === true,
      trialEndTimeMs: asNumber(trial["trial_end_time"]) ?? 0,
      enableSoloLite: flag("enable_solo_lite"),
      enableSoloBuilder: flag("enable_solo_builder"),
      enableSoloCoder: flag("enable_solo_coder"),
      enableSoloWeb: flag("enable_solo_web"),
      ...payIdentity === void 0 ? {} : { payIdentity },
      ...payIdentityStr === void 0 ? {} : { payIdentityStr },
      ...fissionStart === void 0 || fissionExpire === void 0 || fissionMax === void 0 ? {} : {
        fission: { startTimeMs: fissionStart, expireTimeMs: fissionExpire, maxUsage: fissionMax }
      }
    };
  }
  /**
   * The Work-credit endpoints are CN-only. The international region is
   * subscription-based and must read {@link payStatus} instead; guarding here
   * keeps the card's degraded `creditsError` message diagnosable rather than
   * letting an ai credential hit an unverified path on its pay gateway.
   */
  async requireCnRegion(method) {
    if (await this.currentRegion() !== "cn") {
      throw new Error(`Trae ${method} is only available for the CN region; the international (ai) region uses payStatus`);
    }
  }
  /** Total entitlements / credits and per-pack breakdown. */
  async snapshot(signal) {
    await this.requireCnRegion("usage snapshot");
    const payload = await this.post("/trae/api/v2/pay/web_user_ent_usage", { require_usage: true }, signal);
    return parseUsageSnapshot(payload);
  }
  /**
   * Daily check-in status. Read-only, and answered with or without the device
   * header — the claim is what needs it.
   *
   * The read DOES carry the header whenever this installation has one, and
   * that is deliberate rather than incidental: `did_checked_in` is answered
   * per device, so omitting the header would make a device that already claimed
   * today look identical to one that never has (measured 2026-09-26, see
   * {@link TraeCheckinStatus.didCheckedIn}).
   */
  async checkinStatus(signal) {
    await this.requireCnRegion("check-in status");
    const headers = await this.deviceIdHeader();
    const payload = await this.post("/trae/api/v2/ug/checkin_credits/status", {}, signal, headers);
    const extraCredits = asNumber(payload["extra_credits"]);
    return {
      checkedIn: payload["checked_in"] === true,
      credits: asNumber(payload["credits"]) ?? 0,
      enabled: payload["enable"] !== false,
      didCheckedIn: payload["did_checked_in"] === true,
      ...extraCredits === void 0 || extraCredits <= 0 ? {} : { extraCredits }
    };
  }
  /**
   * Claim today's check-in reward. The ONLY state-changing call in this client.
   *
   * The upstream is idempotent per Beijing day (verified 2026-09-24: repeating
   * the call on an already-claimed day answers `code: 0` while the entitlement
   * total stays byte-identical), so a double click cannot double-grant. The
   * card and its route still guard, because "cannot double-grant" is a property
   * of the upstream we verify rather than one we rely on.
   *
   * A business refusal arrives as HTTP 200 with a non-zero `code` — most often
   * `9004` when the request carries no `x-device-id`. That is reported as
   * `claimed: false` rather than thrown, so the caller can tell "the upstream
   * refused this" apart from "the request never arrived".
   */
  async claimCheckin(signal) {
    await this.requireCnRegion("check-in claim");
    const headers = await this.deviceIdHeader();
    const payload = await this.post("/trae/api/v2/ug/checkin_credits/claim", {}, signal, headers);
    const code = asNumber(payload["code"]) ?? 0;
    return {
      claimed: code === 0,
      code,
      message: typeof payload["message"] === "string" ? payload["message"].slice(0, 200) : ""
    };
  }
  /** Rewards / activity rules. */
  async activities(signal) {
    await this.requireCnRegion("activities");
    const payload = await this.post("/trae/api/v2/ug/activity/info", {}, signal);
    const rawActivities = Array.isArray(payload["commercial_activities"]) ? payload["commercial_activities"] : [];
    const activities = [];
    for (const raw of rawActivities) {
      if (typeof raw !== "object" || raw === null) continue;
      const rule = raw;
      activities.push({
        activityId: typeof rule["activity_id"] === "string" ? rule["activity_id"] : "",
        enabled: rule["Enabled"] === true,
        activityType: asNumber(rule["activity_type"]) ?? 0,
        startTimeMs: asNumber(rule["start_time_ms"]) ?? 0,
        endTimeMs: asNumber(rule["end_time_ms"]) ?? 0,
        ...rule["work_extra"] === void 0 ? {} : { workExtra: rule["work_extra"] }
      });
    }
    return activities;
  }
  /** Convenience: snapshot + check-in + activities in one call (best-effort, non-fatal on missing). */
  async view(signal) {
    const [snapshot, checkin, activities] = await Promise.all([
      this.snapshot(signal),
      this.checkinStatus(signal),
      this.activities(signal)
    ]);
    return { snapshot, checkin, activities };
  }
};
export {
  FALLBACK_TRAE_MODELS,
  FALLBACK_TRAE_MODELS_AI,
  REGION_GATEWAYS,
  TRAE_AUTH_STORAGE_KEY,
  TRAE_DIRECTORY_FUNCTIONS,
  TRAE_PAY_BASE,
  TRAE_REMOTE_DIRECTORY_FUNCTIONS,
  TRAE_SOLO_CHAT_PATH,
  TRAE_SOLO_FUNCTION,
  TRAE_SOLO_MODELS_PATH,
  TRAE_SOLO_REMOTE_BASE,
  TraeCatalog,
  TraeSoloBridge,
  TraeSoloRemoteCatalogClient,
  TraeSoloUpstreamClient,
  TraeUsageClient,
  applyContextBudgets,
  applyImageSelection,
  bridgeTraeSoloStream,
  bridgeTraeSoloStreamOrFail,
  decryptTraeStorageValue,
  deriveCatalog,
  describeTraeFailure,
  discoveredCatalog,
  fallbackModelsFor,
  identityHeaders,
  mergeTraeModelSources,
  parseTraeAuthValue,
  parseTraeCliToken,
  parseTraeStorageDocument,
  pickTraeStorageIdentity,
  preferStrongerRow,
  prepareSoloBody,
  readTraeCliIdentity,
  readTraeIdentity,
  regionOfCredential,
  regionOfEdition,
  regionOfHost,
  regionOfUserRegion,
  resolveTraeIdentity,
  sanitizeCatalog,
  traeInputModalities,
  traeModelAcceptsImage,
  traeModelDisplayName
};
