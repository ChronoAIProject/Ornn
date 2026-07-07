local M = {}

local max_string = 512

local function env(name)
  if os == nil or type(os.getenv) ~= "function" then return nil end
  local value = os.getenv(name)
  if value == "" then return nil end
  return value
end

local function bounded_string(value)
  return type(value) == "string" and value ~= "" and #value <= max_string
end

local function dense_list(value)
  if type(value) ~= "table" then return false end
  local count = 0
  for key, _ in pairs(value) do
    if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then return false end
    if key > count then count = key end
  end
  for index = 1, count do
    if value[index] == nil then return false end
  end
  return true, count
end

local function safe_artifact_root(value)
  return bounded_string(value)
    and value:match("^%.testing/runs/ornn%-[^%z]+$") ~= nil
    and value:find("..", 1, true) == nil
end

local function local_url(value)
  return bounded_string(value)
    and (value:match("^https?://localhost[:/%?]") ~= nil
      or value:match("^https?://127%.0%.0%.1[:/%?]") ~= nil
      or value:match("^https?://%[::1%][:/%?]") ~= nil)
end

local function origin_from_url(value)
  if not bounded_string(value) then return nil end
  local scheme, authority = value:match("^(https?)://([^/%?#]+)")
  if scheme == nil or authority == nil or authority == "" then return nil end
  if authority:find("%s") ~= nil or authority:find("\\", 1, true) ~= nil or authority:find("@", 1, true) ~= nil then return nil end
  return scheme:lower() .. "://" .. authority:lower()
end

local function normalize_base_url(value)
  return tostring(value or ""):gsub("/+$", "")
end

local function join_url(base_url, route)
  if route == "/" then return normalize_base_url(base_url) .. "/" end
  return normalize_base_url(base_url) .. route
end

local function base_scope(value)
  if origin_from_url(value) == nil then return nil end
  return tostring(value):gsub("[#?].*$", "")
end

local function within_base_scope(entry_url, base_url)
  local scope = base_scope(base_url)
  if scope == nil or not bounded_string(entry_url) then return false end
  local clean = entry_url:gsub("[#?].*$", "")
  if scope:sub(-1) == "/" then return clean:sub(1, #scope) == scope end
  return clean == scope or clean:sub(1, #scope + 1) == scope .. "/"
end

local function slug(value)
  local text = tostring(value or "module")
  text = text:gsub("^/", "root")
  text = text:gsub("[^%w%._%-]+", "-")
  text = text:gsub("%-+", "-")
  text = text:gsub("^%-", "")
  text = text:gsub("%-$", "")
  if text == "" then text = "module" end
  if #text > 80 then text = text:sub(1, 80) end
  return text
end

local function targets_legacy_runner(argv)
  for _, value in ipairs(argv or {}) do
    local text = tostring(value)
    if text:find("agentic_testing", 1, true) ~= nil
      or text:find("agentic-testing-cli", 1, true) ~= nil
      or text:find("scripts/fkst-host-module-ui-check", 1, true) ~= nil
      or text == "fkst-host-module-ui-check"
      or text:match("/fkst%-host%-module%-ui%-check$") ~= nil then
      return true
    end
  end
  return false
end

local function validate_allowed_origins(base_url, origins)
  local ok, count = dense_list(origins)
  if not ok or count == 0 or count > 16 then error("ornn-fkst: allowed_origins must be a non-empty bounded dense list") end
  local base_origin = origin_from_url(base_url)
  local includes_base = false
  for _, origin in ipairs(origins) do
    if not local_url(origin) then error("ornn-fkst: allowed_origins must contain local http origins") end
    if origin_from_url(origin) == base_origin then includes_base = true end
  end
  if not includes_base then error("ornn-fkst: allowed_origins must include base_url origin") end
end

local function validate_sessions(sessions)
  local ok, count = dense_list(sessions)
  if not ok or count == 0 then error("ornn-fkst: sessions must be a non-empty dense list") end
  for _, session in ipairs(sessions) do
    if type(session) ~= "table" or not bounded_string(session.role) then error("ornn-fkst: invalid readiness session") end
    if not bounded_string(session.browser_harness_command)
      and not bounded_string(session.browser_harness_command_env)
      and not bounded_string(session.cdp_endpoint_env)
      and not local_url(session.cdp_url) then
      error("ornn-fkst: invalid readiness session")
    end
  end
end

local function validate_observations(base_url, observations)
  local ok, count = dense_list(observations)
  if not ok or count == 0 or count > 64 then error("ornn-fkst: observations must be a non-empty bounded dense list") end
  for _, item in ipairs(observations) do
    if type(item) ~= "table" then error("ornn-fkst: observation must be a table") end
    if not bounded_string(item.id) or not bounded_string(item.name) then error("ornn-fkst: observation id/name must be bounded strings") end
    if not within_base_scope(item.entry_url, base_url) then error("ornn-fkst: observation entry_url must stay within base_url scope") end
    if item.discovery_source ~= "navigation" and item.discovery_source ~= "route" and item.discovery_source ~= "route-manifest" then
      error("ornn-fkst: observation discovery_source is invalid")
    end
    if not bounded_string(item.evidence_pointer) then error("ornn-fkst: observation evidence_pointer must be a bounded string") end
  end
end

local function validate_cdp_execution(value)
  if type(value) ~= "table" then error("ornn-fkst: cdp_execution must be a table") end
  if value.schema ~= "testing-runner.module-cdp-execution.v1" then error("ornn-fkst: cdp_execution schema is invalid") end
  if type(value.step_budget) ~= "number" or value.step_budget < 1 or value.step_budget > 32 or value.step_budget % 1 ~= 0 then
    error("ornn-fkst: cdp_execution.step_budget must be an integer from 1 to 32")
  end
  local ok, count = dense_list(value.case_priorities)
  if not ok or count == 0 or count > 3 then error("ornn-fkst: cdp_execution.case_priorities must be a bounded dense list") end
  for _, priority in ipairs(value.case_priorities) do
    if priority ~= "P0" and priority ~= "P1" and priority ~= "P2" then error("ornn-fkst: cdp_execution.case_priorities is invalid") end
  end
end

local function validate_native_argv(argv)
  if argv == nil then return end
  local ok, count = dense_list(argv)
  if not ok or count == 0 then error("ornn-fkst: native_argv must be a non-empty dense list") end
  for _, item in ipairs(argv) do
    if not bounded_string(item) then error("ornn-fkst: native_argv items must be bounded strings") end
  end
  if targets_legacy_runner(argv) then error("ornn-fkst: native_argv must not target the legacy agentic-testing host runner") end
end

local function validate_profile(profile)
  if type(profile) ~= "table" then error("ornn-fkst: native module profile must be a table") end
  if not bounded_string(profile.module) then error("ornn-fkst: module must be a bounded string") end
  if profile.kind ~= "api" and profile.kind ~= "web" and profile.kind ~= "gated" then error("ornn-fkst: module kind is invalid") end
  if profile.enabled ~= false then
    if not local_url(profile.base_url) then error("ornn-fkst: base_url must be a local http URL") end
    if profile.kind == "web" then
      validate_allowed_origins(profile.base_url, profile.allowed_origins)
      validate_sessions(profile.sessions)
      validate_observations(profile.base_url, profile.observations)
      validate_cdp_execution(profile.cdp_execution)
    elseif profile.kind == "api" then
      validate_sessions(profile.sessions)
      validate_native_argv(profile.native_argv)
    end
    if not safe_artifact_root(profile.artifact_root) then error("ornn-fkst: artifact_root must be under .testing/runs/ornn-*") end
    if not bounded_string(profile.trace_id) then error("ornn-fkst: trace_id must be a bounded string") end
    if not bounded_string(profile.dedup_key) then error("ornn-fkst: dedup_key must be a bounded string") end
  end
  return profile
end

local function source_ref(profile)
  return { kind = "host-module", ref = profile.module }
end

local function enabled_profiles(profiles)
  local selected = {}
  for _, profile in ipairs(profiles) do
    if profile.enabled ~= false then table.insert(selected, validate_profile(profile)) end
  end
  return selected
end

local function observation(base_url, route, name)
  local id = "ornn-web-" .. slug(route)
  return {
    id = id,
    name = name,
    entry_url = join_url(base_url, route),
    visible_label = name,
    route = route,
    discovery_source = "navigation",
    confidence = "high",
    evidence_pointer = ".testing/runs/ornn-web-public-navigation/evidence/discovery/" .. id,
  }
end

local function api_profiles(config)
  local base_url = config.api_base_url or "http://localhost:3802"
  local artifact_root = ".testing/runs/ornn-api-public-smoke"
  return {
    validate_profile({
      kind = "api",
      module = "ornn-api-public-smoke",
      module_name = "ORNN API public smoke",
      base_url = base_url,
      sessions = {
        { role = "api", browser_harness_command = "true" },
      },
      native_argv = {
        "testing/fkst/ornn-native-full/bin/ornn-api-public-smoke.sh",
        base_url,
      },
      artifact_root = artifact_root,
      trace_id = "trace-ornn-api-public-smoke",
      dedup_key = "ornn-api-public-smoke",
    }),
  }
end

local function web_profiles(config)
  local base_url = config.web_base_url or "http://localhost:5173"
  local cdp_url = config.cdp_url or "http://127.0.0.1:9222"
  local origin = origin_from_url(base_url)
  return {
    validate_profile({
      kind = "web",
      module = "ornn-web-public-navigation",
      module_name = "ORNN web public navigation",
      base_url = base_url,
      allowed_origins = { origin },
      sessions = {
        { role = "base", browser_harness_command = "true" },
        { role = "cdp", cdp_url = cdp_url },
      },
      observations = {
        observation(base_url, "/", "Landing page"),
        observation(base_url, "/docs", "Docs"),
        observation(base_url, "/news", "News"),
        observation(base_url, "/contact", "Contact"),
        observation(base_url, "/registry", "Registry"),
        observation(base_url, "/skillsets", "Skillsets"),
      },
      cdp_execution = {
        schema = "testing-runner.module-cdp-execution.v1",
        step_budget = 32,
        case_priorities = { "P0", "P1" },
        stop_conditions = {
          "origin-boundary",
          "module-boundary",
          "credential-login",
          "mfa",
          "captcha",
          "mutation-policy",
          "step-budget",
        },
      },
      mutation_policy = "read-only",
      artifact_root = ".testing/runs/ornn-web-public-navigation",
      trace_id = "trace-ornn-web-public-navigation",
      dedup_key = "ornn-web-public-navigation",
    }),
  }
end

M.gated_modules = {
  validate_profile({
    kind = "gated",
    enabled = false,
    module = "ornn-auth-surface",
    reason = "requires host-provided NyxID session fixture; credentials never belong in FKST payloads",
  }),
  validate_profile({
    kind = "gated",
    enabled = false,
    module = "ornn-admin-surface",
    reason = "requires seeded admin session and host-approved mutation policy",
  }),
}

M.host_config = {
  project = {
    id = "ornn",
    name = "ORNN",
    artifact_namespace = "ornn",
  },
  api_base_url = env("ORNN_API_BASE_URL") or "http://localhost:3802",
  web_base_url = env("ORNN_WEB_BASE_URL") or "http://localhost:5173",
  cdp_url = env("ORNN_CDP_URL") or "http://127.0.0.1:9222",
  platform_test_loop = {
    platform = "ornn-native-full",
    artifact_root = ".testing/runs/ornn-native-full-platform",
    trace_id = "trace-ornn-native-full-platform",
    dedup_key = "ornn-native-full-platform",
  },
}

function M.modules(config)
  config = config or M.host_config
  local modules = {}
  for _, profile in ipairs(api_profiles(config)) do table.insert(modules, profile) end
  for _, profile in ipairs(web_profiles(config)) do table.insert(modules, profile) end
  return enabled_profiles(modules)
end

function M.readiness_check(profile)
  profile = validate_profile(profile)
  return {
    queue = "browser-readiness.browser_readiness_check",
    payload = {
      schema = "browser-readiness.check.v1",
      base_url = profile.base_url,
      sessions = profile.sessions,
      request_context = {
        no_browser = profile.kind == "api",
        dry_run = false,
        native_argv = profile.native_argv,
      },
      source_ref = source_ref(profile),
    },
    source_ref = { kind = "external", reference = profile.module },
  }
end

function M.ready_result(profile)
  profile = validate_profile(profile)
  local sessions = {
    { role = "base_url", status = "ready" },
  }
  if profile.kind == "api" then
    table.insert(sessions, { role = "api", status = "ready" })
  else
    table.insert(sessions, { role = "base", status = "ready" })
    table.insert(sessions, { role = "cdp", status = "ready" })
  end
  return {
    schema = "browser-readiness.result.v1",
    status = "ready",
    sessions = sessions,
    source_ref = source_ref(profile),
    request_context = {
      no_browser = profile.kind == "api",
      dry_run = false,
      native_argv = profile.native_argv,
    },
  }
end

function M.module_start(profile, readiness)
  profile = validate_profile(profile)
  local payload = {
    schema = "testing-pipeline.module-start.v1",
    module = profile.module,
    backend = "fkst-native",
    dry_run = false,
    preflight_result = readiness,
    artifact_root = profile.artifact_root,
    source_ref = source_ref(profile),
    trace_id = profile.trace_id,
    dedup_key = profile.dedup_key,
  }
  if profile.kind == "api" then
    payload.no_browser = true
    payload.native_argv = profile.native_argv
  else
    payload.ui_loop = {
      base_url = profile.base_url,
      allowed_origins = profile.allowed_origins,
      browser_readiness_ref = profile.artifact_root .. "/readiness.json",
      cdp_readiness_ref = "cdp-ready",
      mutation_policy = profile.mutation_policy or "read-only",
    }
    payload.module_discovery = {
      schema = "testing-runner.module-discovery.v1",
      observations = profile.observations,
      limitations = {
        "Public Docker Compose profile excludes auth-required routes until a safe host session fixture is available.",
      },
    }
    payload.cdp_execution = profile.cdp_execution
  end
  return {
    queue = "testing-pipeline.module_start",
    payload = payload,
    source_ref = { kind = "external", reference = profile.module },
  }
end

function M.platform_aggregate(module_results, config)
  local ok = dense_list(module_results)
  if not ok then error("ornn-fkst: module_results must be a dense list") end
  config = config or M.host_config
  local platform = config.platform_test_loop or {}
  if not bounded_string(platform.platform) then error("ornn-fkst: platform must be a bounded string") end
  if not safe_artifact_root(platform.artifact_root) then error("ornn-fkst: platform artifact_root must be under .testing/runs/ornn-*") end
  return {
    schema = "platform-test-loop.aggregate.v1",
    platform = platform.platform,
    module_results = module_results,
    artifact_root = platform.artifact_root,
    source_ref = { kind = "host-platform", ref = platform.platform },
    trace_id = platform.trace_id,
    dedup_key = platform.dedup_key,
  }
end

function M.validate(profile)
  return validate_profile(profile)
end

return M
