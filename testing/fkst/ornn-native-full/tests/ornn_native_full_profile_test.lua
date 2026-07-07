local graph = require("testkit.graph")
local profile = require("ornn_native_full_profile")
local t = fkst.test

local function rendered_argv(argv)
  local parts = {}
  for _, value in ipairs(argv or {}) do
    table.insert(parts, "'" .. value .. "'")
  end
  return table.concat(parts, " ")
end

local function assert_argv(actual, expected)
  t.eq(#actual, #expected)
  for index, value in ipairs(expected) do
    t.eq(actual[index], value)
  end
end

local function assert_no_legacy_text(value)
  local text = tostring(value or "")
  t.eq(text:find("agentic_testing", 1, true), nil)
  t.eq(text:find("agentic-testing-cli", 1, true), nil)
  t.eq(text:find("fkst-host-module-ui-check", 1, true), nil)
  t.eq(text:find("python -m agentic_testing", 1, true), nil)
  t.eq(text:find("scripts/fkst-host-module-ui-check", 1, true), nil)
end

local function inspect_no_legacy(value)
  local kind = type(value)
  if kind == "string" then
    assert_no_legacy_text(value)
  elseif kind == "table" then
    for key, item in pairs(value) do
      inspect_no_legacy(key)
      inspect_no_legacy(item)
    end
  end
end

local function mock_readiness(module_profile)
  if module_profile.native_argv ~= nil then
    t.mock_command(rendered_argv(module_profile.native_argv), {
      stdout = "",
      stderr = "",
      exit_code = 0,
    })
  end
  t.mock_command("'true'", {
    stdout = "",
    stderr = "",
    exit_code = 0,
  })
end

local function assert_readiness_request(module_profile)
  local request = profile.readiness_check(module_profile)
  t.eq(request.queue, "browser-readiness.browser_readiness_check")
  t.eq(request.payload.schema, "browser-readiness.check.v1")
  t.eq(request.payload.base_url, module_profile.base_url)
  t.eq(request.payload.request_context.dry_run, false)
  t.eq(request.payload.request_context.no_browser, module_profile.kind == "api")
  if module_profile.native_argv ~= nil then
    assert_argv(request.payload.request_context.native_argv, module_profile.native_argv)
  else
    t.eq(request.payload.request_context.native_argv, nil)
  end
  return request
end

local function assert_pipeline(module_profile)
  mock_readiness(module_profile)
  assert_readiness_request(module_profile)
  local readiness = profile.ready_result(module_profile)
  local pipeline_trace = graph.require_quiescent(graph.run(profile.module_start(module_profile, readiness), { max_steps = 12 }))
  graph.require_delivery(pipeline_trace, {
    queue = "testing-pipeline.module_start",
    consumer = "testing-pipeline.start_module",
  })
  graph.require_delivery(pipeline_trace, {
    queue = "module-test-loop.module_loop_request",
    consumer = "module-test-loop.start",
  })
  graph.require_delivery(pipeline_trace, {
    queue = "testing-runner.module_test_request",
    consumer = "testing-runner.run_module_loop",
  })
  graph.require_delivery(pipeline_trace, {
    queue = "test-artifacts.testing_result",
    consumer = "test-artifacts.summarize",
  })
  graph.require_delivery(pipeline_trace, {
    queue = "test-publication.artifact_summary",
    consumer = "test-publication.prepare_publication",
  })

  local result = graph.require_raise(pipeline_trace, "testing-runner.testing_result").payload
  t.eq(result.status, "passed")
  t.eq(result.adapter.name, "fkst-native")
  t.eq(result.artifact_root, module_profile.artifact_root)
  t.eq(result.trace_id, module_profile.trace_id)
  t.eq(result.dedup_key, module_profile.dedup_key)
  if module_profile.kind == "api" then
    t.eq(result.adapter.mode, "module-no-browser")
    t.eq(result.native_summary.schema, "testing-runner.module-no-browser-summary.v1")
    t.eq(result.native_summary.module, module_profile.module)
  else
    t.eq(result.adapter.mode, "module-cdp-execution")
    t.eq(result.native_summary.schema, "testing-runner.module-cdp-execution-summary.v1")
    t.eq(result.native_summary.module, module_profile.module)
    t.eq(result.native_summary.evidence_bundle_path, module_profile.artifact_root .. "/evidence-bundle.json")
    t.eq(result.native_summary.stage_report_path, module_profile.artifact_root .. "/stage-report.md")
    t.eq(result.native_summary.issue_drafts_path, module_profile.artifact_root .. "/issue-drafts.json")
    t.eq(result.native_summary.gap_backlog_path, module_profile.artifact_root .. "/gap-backlog.json")
    t.eq(result.native_summary.publication_dry_run, true)
  end

  local publication = graph.require_raise(pipeline_trace, "test-publication.publication_request").payload
  t.eq(publication.schema, "test-publication.publication-request.v1")
  t.eq(publication.status, "passed")
  t.eq(publication.severity, "success")
  t.eq(publication.dedup_key, module_profile.dedup_key)
  t.eq(publication.artifact_root, module_profile.artifact_root)
  t.eq(publication.metadata_path, module_profile.artifact_root .. "/metadata.json")
  if module_profile.kind == "web" then
    t.eq(publication.stage_report_path, result.native_summary.stage_report_path)
    t.eq(publication.issue_drafts_path, result.native_summary.issue_drafts_path)
    t.eq(publication.publication_dry_run, true)
  end
  return result
end

return {
  test_ornn_profile_declares_public_modules_and_gated_future_surfaces = function()
    local modules = profile.modules()
    t.eq(#modules, 2)
    t.eq(modules[1].module, "ornn-api-public-smoke")
    t.eq(modules[1].kind, "api")
    t.eq(modules[1].base_url, "http://localhost:3802")
    t.eq(modules[1].native_argv[1], "testing/fkst/ornn-native-full/bin/ornn-api-public-smoke.sh")
    t.eq(modules[2].module, "ornn-web-public-navigation")
    t.eq(modules[2].kind, "web")
    t.eq(modules[2].base_url, "http://localhost:5173")
    t.eq(modules[2].allowed_origins[1], "http://localhost:5173")
    t.eq(#modules[2].observations, 6)
    t.eq(profile.gated_modules[1].module, "ornn-auth-surface")
    t.eq(profile.gated_modules[1].enabled, false)
    t.eq(profile.gated_modules[2].module, "ornn-admin-surface")
    t.eq(profile.gated_modules[2].enabled, false)
    inspect_no_legacy(modules)
  end,

  test_ornn_profile_reaches_publication_handoff_per_enabled_module = function()
    local seen = {}
    for _, module_profile in ipairs(profile.modules()) do
      local result = assert_pipeline(module_profile)
      t.eq(seen[result.dedup_key], nil)
      seen[result.dedup_key] = true
    end
  end,

  test_ornn_web_module_start_uses_fkst_native_ui_loop_facts = function()
    local web = profile.modules()[2]
    local start = profile.module_start(web, profile.ready_result(web))
    t.eq(start.queue, "testing-pipeline.module_start")
    t.eq(start.payload.backend, "fkst-native")
    t.eq(start.payload.native_argv, nil)
    t.eq(start.payload.no_browser, nil)
    t.eq(start.payload.ui_loop.base_url, "http://localhost:5173")
    t.eq(start.payload.ui_loop.mutation_policy, "read-only")
    t.eq(start.payload.module_discovery.schema, "testing-runner.module-discovery.v1")
    t.eq(start.payload.module_discovery.observations[1].discovery_source, "navigation")
    t.eq(start.payload.cdp_execution.schema, "testing-runner.module-cdp-execution.v1")
    inspect_no_legacy(start)
  end,

  test_ornn_platform_aggregate_payload_is_pointer_only = function()
    local module_results = {}
    for _, module_profile in ipairs(profile.modules()) do
      table.insert(module_results, {
        schema = "testing-runner.result.v1",
        job = "module-test-loop",
        module = module_profile.module,
        status = "passed",
        artifact_root = module_profile.artifact_root,
        source_ref = { kind = "host-module", ref = module_profile.module },
        trace_id = module_profile.trace_id,
        dedup_key = module_profile.dedup_key,
        adapter = { name = "fkst-native", mode = module_profile.kind == "api" and "module-no-browser" or "module-cdp-execution" },
        native_summary = {
          schema = module_profile.kind == "api" and "testing-runner.module-no-browser-summary.v1" or "testing-runner.module-cdp-execution-summary.v1",
          module = module_profile.module,
          status = "passed",
        },
      })
    end
    local aggregate = profile.platform_aggregate(module_results)
    t.eq(aggregate.schema, "platform-test-loop.aggregate.v1")
    t.eq(aggregate.platform, "ornn-native-full")
    t.eq(aggregate.artifact_root, ".testing/runs/ornn-native-full-platform")
    t.eq(aggregate.source_ref.kind, "host-platform")
    t.eq(aggregate.source_ref.ref, "ornn-native-full")
    t.eq(#aggregate.module_results, 2)
  end,

  test_ornn_profile_blocks_legacy_native_runner_targets = function()
    t.raises(function()
      profile.validate({
        kind = "api",
        module = "bad-legacy",
        base_url = "http://localhost:3802",
        sessions = { { role = "api", browser_harness_command = "true" } },
        native_argv = { "python3", "-m", "agentic_testing.cli" },
        artifact_root = ".testing/runs/ornn-bad-legacy",
        trace_id = "trace-ornn-bad-legacy",
        dedup_key = "ornn-bad-legacy",
      })
    end)
  end,
}
