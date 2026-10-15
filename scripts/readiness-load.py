#!/usr/bin/env python3
"""Read-only capacity/soak probe; refuses external hosts. Writes aggregate results."""
import argparse
from datetime import datetime, timezone
from collections import Counter, deque
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import random
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import ProxyHandler, build_opener

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:18080')
parser.add_argument('--seconds', type=int, default=60)
parser.add_argument('--users', type=int, default=10)
parser.add_argument('--think-seconds', type=float, default=1)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
target = urlparse(args.base_url)
if target.scheme != 'http' or target.hostname not in ('localhost', '127.0.0.1'):
    parser.error('Only an isolated local HTTP target is allowed')
if not 1 <= args.users <= 100 or args.seconds < 1 or args.think_seconds < 0.1:
    parser.error('users=1..100, seconds>=1, think-seconds>=0.1 required')

paths = ['/api/products?limit=24', '/api/products?page=2&limit=24',
         '/api/products?categorySlug=drinks', '/api/products?search=Kinza',
         '/api/categories', '/api/branches', '/health/ready']
started = time.monotonic()
deadline = started + args.seconds
lock = threading.Lock()
counts = Counter()
latency = deque(maxlen=20000)
failures = deque(maxlen=50)
args.output.parent.mkdir(parents=True, exist_ok=True)

def report(complete=False):
    with lock:
        samples = sorted(latency)
        elapsed = time.monotonic() - started
        data = {'complete': complete, 'elapsedSeconds': round(elapsed, 1),
                'plannedSeconds': args.seconds, 'users': args.users,
                'counts': dict(counts), 'requestsPerSecond': round(sum(counts.values()) / max(elapsed, 1), 2),
                'latencyWindow': len(samples),
                'p95ms': round(samples[int((len(samples)-1)*.95)], 1) if samples else None,
                'maxMs': round(max(samples), 1) if samples else None,
                'recentFailures': list(failures),
                'proxyPolicy': 'disabled explicitly for isolated loopback requests',
                'scope': 'read-only API; local hardware; rate limits raised only on isolated stack'}
    # Windows readers/antivirus can briefly hold the destination without delete
    # sharing. A report write must not terminate the running capacity probe.
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf8',
                                     dir=args.output.parent, prefix=args.output.stem + '-',
                                     suffix='.json', delete=False) as stream:
        json.dump(data, stream, indent=2)
        tmp = Path(stream.name)
    for attempt in range(20):
        try:
            tmp.replace(args.output)
            break
        except PermissionError:
            if attempt == 19:
                print(f'WARNING: report destination locked; snapshot retained at {tmp}',
                      file=sys.stderr, flush=True)
            else:
                time.sleep(.1)
    return data

def worker(seed):
    rng = random.Random(seed)
    opener = build_opener(ProxyHandler({}))
    while time.monotonic() < deadline:
        before = time.monotonic()
        path = rng.choice(paths)
        detail = None
        try:
            with opener.open(args.base_url.rstrip('/') + path, timeout=15) as response:
                json.loads(response.read())
                status = str(response.status)
        except HTTPError as error:
            status = str(error.code)
            detail = {'server': error.headers.get('Server')}
            try:
                detail['body'] = error.read(512).decode('utf8', errors='replace')
            except OSError as body_error:
                detail['bodyUnavailable'] = type(body_error).__name__
        except Exception as error:
            status = type(error).__name__
            detail = {'reason': str(error)[:300]}
        with lock:
            counts[status] += 1
            latency.append((time.monotonic()-before)*1000)
            if status != '200':
                failures.append({'at': datetime.now(timezone.utc).isoformat(),
                                 'path': path, 'status': status, 'detail': detail})
        time.sleep(args.think_seconds * rng.uniform(.8, 1.2))

with ThreadPoolExecutor(max_workers=args.users) as pool:
    jobs = [pool.submit(worker, i) for i in range(args.users)]
    while any(not job.done() for job in jobs):
        report()
        time.sleep(min(10, max(.1, deadline-time.monotonic())))
    for job in jobs:
        job.result()
print(json.dumps(report(complete=True), indent=2))
