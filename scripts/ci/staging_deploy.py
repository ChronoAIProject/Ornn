"""Masked configuration bootstrap and bounded invocation of a pinned controller."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

from staging_deploy_diagnostics import emit_rows


class Refused(Exception):
    """Only fixed state codes are emitted by the command-line boundary."""


def require(condition):
    if not condition:
        raise Refused('deployment_refused')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)


def runner_context(env):
    require(env.get('GITHUB_REPOSITORY') == 'ChronoAIProject/Ornn'
            and env.get('GITHUB_EVENT_NAME') == 'push'
            and env.get('GITHUB_REF') == 'refs/heads/develop'
            and env.get('GITHUB_ACTIONS') == 'true')


def configure(env, emit=print):
    runner_context(env)
    raw = env.get('ORNN_INFRA_CONFIG', '')
    # Workflow expression also checks equality before binding the variable. This
    # protects the runner's preamble even if the mask secret is missing or stale.
    require(bool(raw) and raw == env.get('ORNN_INFRA_CONFIG_MASK') and len(raw) <= 16000)
    config = json.loads(raw, object_pairs_hook=unique_object)
    require(isinstance(config, dict) and config.get('schema') == 'ornn-public-deploy-v1')
    app_id = config.get('reader_app_id', '')
    require(isinstance(app_id, str) and re.fullmatch(r'[1-9][0-9]*', app_id))
    repo = config.get('infra_repository', '')
    revision = config.get('infra_ref', '')
    require(isinstance(repo, str) and re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo)
            and all(part not in {'.', '..'} for part in repo.split('/')))
    require(isinstance(revision, str) and re.fullmatch(r'[0-9a-f]{40}', revision))
    require(config.get('owner_risk_accepted') is True)
    values = set(strings(config)) | set(repo.split('/'))
    for value in sorted(values):
        require(bool(value) and len(value) <= 2048 and not any(ord(c) < 32 for c in value))
    for value in sorted(values, key=len, reverse=True):
        emit('::add-mask::' + value.replace('%', '%25'))
    destination = Path(env['RUNNER_TEMP']) / 'deployment-config.json'
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(raw)
    owner, name = repo.split('/')
    with open(env['GITHUB_OUTPUT'], 'a') as stream:
        for key, value in [('repository', repo), ('owner', owner), ('repository-name', name), ('ref', revision), ('app-id', app_id)]:
            stream.write(key + '=' + value + '\n')
    emit('PASS deployment configuration')


def deploy_components(env, run=subprocess.run, emit=print):
    runner_context(env)
    root = Path(env['GITHUB_WORKSPACE']) / 'deployment-source'
    config = Path(env['RUNNER_TEMP']) / 'deployment-config.json'
    require(config.is_file() and (root / 'staging/scripts/public_runner.py').is_file())
    # Each profile gets a fresh interpreter; controller constants bind at import.
    for component in ('api', 'web'):
        emit('START ' + component + ' deployment')
        receipt = Path(env['RUNNER_TEMP']) / 'deployment-receipts' / component / 'publication.json'
        require(receipt.is_file())
        child_env = dict(env, ORNN_DEPLOY_COMPONENT=component, ORNN_INFRA_CONFIG_PATH=str(config),
                         ORNN_PUBLICATION_PATH=str(receipt), ORNN_DEPLOY_DIAGNOSTICS='1')
        result = run([sys.executable, '-B', str(root / 'staging/scripts/public_runner.py')],
                     env=child_env, cwd=root, capture_output=True, text=True, timeout=1500)
        require(len(result.stdout) <= 16384)
        state = json.loads(result.stdout, object_pairs_hook=unique_object)
        require(isinstance(state, dict) and set(state) in ({'component', 'result', 'recovery', 'mutations'},
                                                        {'component', 'result', 'recovery', 'mutations', 'diagnostics'}))
        require(state['component'] == component and state['result'] in {'PASS', 'STOP'}
                and state['recovery'] in {'NOT_ATTEMPTED', 'STARTED', 'VERIFIED', 'FAILED_STOP'}
                and type(state['mutations']) is int and 0 <= state['mutations'] <= 2)
        # Raw stderr is deliberately never printed, even on timeout or failure.
        emit_rows(component, state.get('diagnostics', []), emit)
        emit(state['result'] + ' ' + component + ' recovery=' + state['recovery'])
        require(result.returncode == 0 and state['result'] == 'PASS')


def cleanup(env):
    root = Path(env['GITHUB_WORKSPACE']) / 'deployment-source'
    if root.exists():
        shutil.rmtree(root)
    temp = Path(env['RUNNER_TEMP'])
    (temp / 'deployment-config.json').unlink(missing_ok=True)
    receipts = temp / 'deployment-receipts'
    if receipts.exists():
        shutil.rmtree(receipts)


def main():
    try:
        require(len(sys.argv) == 2)
        operation = {'configure': configure, 'deploy': deploy_components, 'cleanup': cleanup}.get(sys.argv[1])
        require(operation is not None)
        operation(os.environ)
        return 0
    except Exception:
        print('::error::Staging deployment stopped; inspect sanitized phase states and alert the lead; no blind retries')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
