"""Diagnostic-only observer: time unchanged scanner calls, never alter decisions.

Output is limited to fixed stage/category names, counts, durations and hashes.
This script is not a publication gate and does not create trusted cache artifacts.
"""
import argparse
from collections import defaultdict
import functools
import hashlib
import json
import os
from pathlib import Path
import platform
import sys
import time


def category(location):
    if location.get('scope') != 'layer':
        return location.get('scope', 'unknown')
    path = location.get('path', '').lower()
    if 'node_modules/' in path:
        return 'node_modules'
    if path.startswith('opt/agentseal/') or '/python3' in path:
        return 'python_and_agentseal'
    if path.startswith('app/'):
        return 'application'
    if path.startswith('usr/local/'):
        return 'bun_and_local_runtime'
    return 'operating_system'


def observe(scanner):
    sys.path.insert(0, str(scanner))
    import scan_image_secrets as cli
    from image_secrets import backend, engine, policy, archive
    stages, layers, global_times = [], [], defaultdict(float)
    active = [None]

    def row():
        return active[0]

    def increment(key, seconds, group=None, count=0, size=0):
        r = row()
        if r is None:
            global_times[key] += seconds
        else:
            r['timings'][key] += seconds
            if group is not None:
                c = r['categories'][group]
                c[key] += seconds
                if count:
                    c[key + '_calls'] += count
                if size:
                    c[key + '_bytes'] += size

    original_init = engine.Stage.__init__
    @functools.wraps(original_init)
    def stage_init(self, root, *args, **kwargs):
        original_init(self, root, *args, **kwargs)
        self.profile_start = time.perf_counter()
        self.profile = {'stage': root.name, 'sequence': len(stages), 'timings': defaultdict(float),
                        'categories': defaultdict(lambda: defaultdict(float))}
        stages.append(self.profile)
        active[0] = self.profile
    engine.Stage.__init__ = stage_init

    original_finish = engine.Stage.finish
    @functools.wraps(original_finish)
    def finish(self):
        self.profile['inputs'] = len(self.locations)
        for location in self.locations.values():
            self.profile['image'] = location.get('image', -1)
            self.profile['layer'] = location.get('layer', -1)
            break
        start = time.perf_counter()
        try:
            return original_finish(self)
        finally:
            self.profile['finish_seconds'] = time.perf_counter() - start
            self.profile['total_seconds'] = time.perf_counter() - self.profile_start
            active[0] = None
    engine.Stage.finish = finish

    original_inspect = policy.Findings.inspect
    @functools.wraps(original_inspect)
    def inspect(self, path, location, *args, **kwargs):
        start = time.perf_counter()
        try:
            return original_inspect(self, path, location, *args, **kwargs)
        finally:
            increment('builtin_inspection_seconds', time.perf_counter() - start,
                      category(location), 1, path.stat().st_size)
    policy.Findings.inspect = inspect

    original_add = policy.Findings.add
    @functools.wraps(original_add)
    def add(self, rule, location, *args, **kwargs):
        start = time.perf_counter()
        try:
            return original_add(self, rule, location, *args, **kwargs)
        finally:
            increment('finding_policy_seconds', time.perf_counter() - start, category(location), 1)
    policy.Findings.add = add

    original_scan = backend.Gitleaks.scan
    @functools.wraps(original_scan)
    def scan(self, stage, locations, findings):
        self.profile_locations = locations
        start = time.perf_counter()
        before = dict(self.cache.stats) if getattr(self, 'cache', None) else {}
        try:
            return original_scan(self, stage, locations, findings)
        finally:
            increment('backend_seconds', time.perf_counter() - start)
            if getattr(self, 'cache', None) and row() is not None:
                row()['cache'] = {k: v - before.get(k, 0) for k, v in self.cache.stats.items()}
    backend.Gitleaks.scan = scan

    original_run = backend.subprocess.run
    @functools.wraps(original_run)
    def run(argv, *args, **kwargs):
        start = time.perf_counter()
        try:
            return original_run(argv, *args, **kwargs)
        finally:
            if isinstance(argv, list) and len(argv) > 1 and argv[1] == 'dir':
                increment('gitleaks_process_seconds', time.perf_counter() - start)
    backend.subprocess.run = run

    original_digest = backend.digest_file
    def digest(path):
        start = time.perf_counter()
        try:
            return original_digest(path)
        finally:
            increment('backend_hash_seconds', time.perf_counter() - start)
            if row() is not None:
                row()['backend_hash_calls'] = row().get('backend_hash_calls', 0) + 1
                row()['backend_hash_bytes'] = row().get('backend_hash_bytes', 0) + path.stat().st_size
    backend.digest_file = digest

    resolver = 'resolve_index' if hasattr(backend.Gitleaks, 'resolve_index') else 'resolve'
    original_resolve = getattr(backend.Gitleaks, resolver)
    def resolve(*args, **kwargs):
        start = time.perf_counter()
        result = original_resolve(*args, **kwargs)
        increment('finding_lookup_seconds', time.perf_counter() - start, category(result[0]), 1)
        return result
    setattr(backend.Gitleaks, resolver, staticmethod(resolve))

    original_layer = archive.ImageArchive.layer
    @functools.wraps(original_layer)
    def layer(self, name, expected):
        start = time.perf_counter()
        result = original_layer(self, name, expected)
        layers.append({'sequence': len(layers), 'diff_id': expected,
                       'extraction_validation_seconds': time.perf_counter() - start,
                       'unpacked_bytes': result.stat().st_size})
        return result
    archive.ImageArchive.layer = layer

    for method in ['__enter__', 'images']:
        original = getattr(archive.ImageArchive, method)
        def timed(self, *args, _original=original, _method=method, **kwargs):
            start = time.perf_counter()
            try:
                return _original(self, *args, **kwargs)
            finally:
                global_times['archive_' + _method + '_seconds'] += time.perf_counter() - start
        setattr(archive.ImageArchive, method, timed)
    return cli, stages, layers, global_times


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--scanner', type=Path, required=True)
    p.add_argument('--archive', type=Path, required=True)
    p.add_argument('--allowlist', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--cache-input', type=Path)
    p.add_argument('--cache-output', type=Path)
    a = p.parse_args()
    cli, stages, layers, global_times = observe(a.scanner.resolve())
    args = [str(a.archive), '--input-kind', 'archive', '--output', str(a.output / 'report'),
            '--blocking-rules', 'credential', '--allowlist', str(a.allowlist)]
    for flag, value in [('--detector-cache', a.cache_input), ('--detector-cache-output', a.cache_output)]:
        if value:
            args += [flag, str(value)]
    start = time.perf_counter()
    code = cli.main(args)
    report = json.loads((a.output / 'report/REPORT.json').read_text())
    result = {'seconds': time.perf_counter() - start, 'exit_code': code, 'complete': report['complete'],
              'archive_sha256': report.get('archive_sha256'), 'scanner_files': report.get('scanner_files'),
              'profile_script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'platform': platform.platform(), 'python': platform.python_version(), 'cpus': os.cpu_count(),
              'stages': stages, 'layers': layers, 'archive_timings': dict(global_times),
              'detector_metrics': report.get('detector_metrics'), 'detector_cache': report.get('detector_cache'),
              'counts': report.get('counts'), 'inventory': report.get('inventory'),
              'timing_note': 'Nested timings overlap: built-in inspections include policy adds; backend includes detector, lookup, hashes, cache and policy.'}
    (a.output / 'PROFILE.json').write_text(json.dumps(result, indent=2) + '\n')
    return 0 if code in (0, 1) and report['complete'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
