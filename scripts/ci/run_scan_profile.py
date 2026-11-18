"""Same-archive observer parity, cold/warm detector proof; no deployment access."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def main():
    image = Path('retained-image')
    metadata = json.loads((image / 'metadata.json').read_text())
    archive = image / 'ornn-api-linux-amd64.docker.tar.gz'
    assert digest(archive) == metadata['archiveSha256']
    root = Path('profile-results'); root.mkdir()
    scanner = Path('scripts/ci/image-secret-scan')
    modes = ['uncached', 'cache-cold', 'cache-warm']
    profiles = []
    previous = json.loads((image / 'secret-scan-raw/REPORT.json').read_text())
    for mode in modes:
        out = root / mode; out.mkdir()
        args = [sys.executable, '-B', 'scripts/ci/profile_image_scan.py', '--scanner', str(scanner),
                '--archive', str(archive), '--allowlist', 'scripts/ci/ornn-image-allowlist.json', '--output', str(out)]
        if mode != 'uncached':
            args += ['--cache-output', str(root / (mode + '.json'))]
        if mode == 'cache-warm':
            args += ['--cache-input', str(root / 'cache-cold.json')]
        with (out / 'scan.log').open('wb') as log:
            subprocess.run(args, check=True, stdout=log, stderr=log, timeout=300)
        current = json.loads((out / 'report/REPORT.json').read_text())
        equal = {k: current[k] == previous[k] for k in ['archive_sha256', 'complete', 'status', 'counts', 'inventory', 'scanned_bytes']}
        for k in ['findings', 'allowlisted', 'blocking_findings', 'advisory_findings']:
            equal[k] = sorted(current[k], key=lambda v: json.dumps(v, sort_keys=True)) == sorted(previous[k], key=lambda v: json.dumps(v, sort_keys=True))
        assert all(equal.values()), 'Observer or mode changed scan results'
        start = time.perf_counter()
        with (out / 'resolution.log').open('wb') as log:
            subprocess.run([sys.executable, '-B', 'scripts/ci/content-policy/tool/resolve_content_policy.py',
                '--scanner', str(scanner), '--archive', str(archive), '--report', str(out / 'report/REPORT.json'),
                '--catalog', 'scripts/ci/ornn-content-policy.json', '--component', 'api', '--output', str(out / 'resolved'),
                '--review', 'scripts/ci/ornn-content-policy-review.json'], check=True, stdout=log, stderr=log, timeout=120)
        profile = json.loads((out / 'PROFILE.json').read_text())
        profiles.append({'mode': mode, 'scan_seconds': profile['seconds'], 'resolution_seconds': time.perf_counter() - start,
                         'equal_to_uninstrumented_retained_report': equal, 'cache': profile['detector_cache']})
        (root / 'RESULT.json').write_text(json.dumps(profiles, indent=2) + '\n')
        print(json.dumps(profiles[-1]), flush=True)
    # No reusable cache artifact is exported by this diagnostic producer.
    for name in ['cache-cold.json', 'cache-warm.json']:
        (root / name).unlink()


if __name__ == '__main__':
    main()
