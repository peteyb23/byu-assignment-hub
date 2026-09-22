#!/usr/bin/env python3
import json
import os
import sys
import hmac
import hashlib
from http.cookies import SimpleCookie
import urllib.parse
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / '.env'
CANVAS_BASE = 'https://byu.instructure.com'
LEARNING_SUITE_ICAL = os.environ.get('LEARNING_SUITE_ICAL', '').strip()
LEARNING_SUITE_COURSE = os.environ.get('LEARNING_SUITE_COURSE', 'Learning Suite').strip()
LEARNING_SUITE_ASSIGNMENTS_URL = os.environ.get('LEARNING_SUITE_ASSIGNMENTS_URL', 'https://learningsuite.byu.edu/').strip()
LEARNING_SUITE_SCHEDULE_URL = os.environ.get('LEARNING_SUITE_SCHEDULE_URL', 'https://learningsuite.byu.edu/').strip()


def load_env():
    data = dict(os.environ)
    if ENV_FILE.exists():
        for raw in ENV_FILE.read_text(encoding='utf-8').splitlines():
            line = raw.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def canvas_get(path, token, params=None):
    params = params or []
    query = urllib.parse.urlencode(params, doseq=True)
    url = CANVAS_BASE + path + (('?' + query) if query else '')
    all_items = []
    first = True

    while url:
        req = urllib.request.Request(
            url,
            headers={
                'Authorization': f'Bearer {token}',
                'Accept': 'application/json',
                'User-Agent': 'AssignmentHub/1.0'
            }
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
            if isinstance(payload, list):
                all_items.extend(payload)
            elif first:
                return payload
            first = False

            link_header = resp.headers.get('Link', '')
            next_url = None
            for part in link_header.split(','):
                if 'rel="next"' in part:
                    start = part.find('<') + 1
                    end = part.find('>')
                    if start > 0 and end > start:
                        next_url = part[start:end]
                        break
            url = next_url

    return all_items


def _unfold_ical(text):
    lines = []
    for raw in text.replace('\r\n', '\n').replace('\r', '\n').split('\n'):
        if raw.startswith((' ', '\t')) and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def _ical_unescape(value):
    return (value.replace('\\n', ' ').replace('\\N', ' ')
                 .replace('\\,', ',').replace('\\;', ';').replace('\\\\', '\\')).strip()


def _parse_ical_date(value):
    from datetime import datetime
    value = value.strip()
    if len(value) == 8 and value.isdigit():
        return datetime.strptime(value, '%Y%m%d').date()
    if value.endswith('Z'):
        try:
            return datetime.strptime(value, '%Y%m%dT%H%M%SZ')
        except ValueError:
            pass
    try:
        return datetime.strptime(value, '%Y%m%dT%H%M%S')
    except ValueError:
        return None


def get_learning_suite_events():
    from datetime import datetime, time, timedelta
    if not LEARNING_SUITE_ICAL:
        return []
    req = urllib.request.Request(
        LEARNING_SUITE_ICAL,
        headers={'Accept': 'text/calendar,text/plain,*/*', 'User-Agent': 'AssignmentHub/1.0'}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode('utf-8', errors='replace')

    events = []
    current = None
    for line in _unfold_ical(text):
        if line == 'BEGIN:VEVENT':
            current = {}
            continue
        if line == 'END:VEVENT':
            if current:
                events.append(current)
            current = None
            continue
        if current is None or ':' not in line:
            continue
        keypart, value = line.split(':', 1)
        key = keypart.split(';', 1)[0]
        current[key] = _ical_unescape(value)

    results = []
    for ev in events:
        title = (ev.get('SUMMARY') or '').strip()
        if not title:
            continue
        start = _parse_ical_date(ev.get('DTSTART', ''))
        end = _parse_ical_date(ev.get('DTEND', '')) if ev.get('DTEND') else None
        if not start:
            continue

        # iCal all-day DTEND is exclusive. For Learning Suite assignment windows,
        # the actual closing/due date is the day before DTEND. The feed does not
        # include the clock time, so expose it as an all-day deadline in the UI.
        if end and not isinstance(end, datetime):
            due_date = end - timedelta(days=1)
        elif isinstance(start, datetime):
            due_date = start.date()
        else:
            due_date = start

        due_dt = datetime.combine(due_date, time(23, 59, 59))
        uid = ev.get('UID') or f'{title}-{due_date.isoformat()}'

        # The ECON feed mixes graded work with the professor's reading schedule.
        # Keep readings visible, but classify them separately so they do not inflate
        # assignment totals or compete with graded work in the deadline sections.
        title_lower = title.lower()
        is_reading = title_lower.startswith('mankiw ') or title_lower.startswith('read ')
        item_kind = 'reading' if is_reading else 'assignment'

        # Make feed-generated reading names a little easier to scan.
        clean_title = title.replace('(including', ' (including').replace('  Download', ' Download')

        results.append({
            'id': f'learningsuite-{uid}',
            'source': 'Learning Suite',
            'courseId': 'learning-suite',
            'course': LEARNING_SUITE_COURSE,
            'title': clean_title,
            'due': due_dt.isoformat(),
            'allDay': True,
            'points': None,
            'url': LEARNING_SUITE_SCHEDULE_URL if is_reading else LEARNING_SUITE_ASSIGNMENTS_URL,
            'submitted': False,
            'submissionState': None,
            'locked': False,
            'group': 'Reading Schedule' if is_reading else 'Learning Suite',
            'kind': item_kind,
            'description': ev.get('DESCRIPTION') or ''
        })

    results.sort(key=lambda x: x['due'])
    return results


def get_assignments(token):
    courses = canvas_get('/api/v1/courses', token, [
        ('enrollment_state', 'active'),
        ('state[]', 'available'),
        ('per_page', '100')
    ])

    results = []
    course_errors = []

    for course in courses:
        course_id = course.get('id')
        if not course_id:
            continue
        course_name = course.get('course_code') or course.get('name') or f'Course {course_id}'
        try:
            # Fetch assignments directly instead of relying on assignments nested
            # inside assignment groups. Canvas can return an incomplete nested
            # assignment list for large courses/modules, which caused legitimate
            # dated work (notably NDFS 100) to disappear from Assignment Hub.
            assignments = canvas_get(f'/api/v1/courses/{course_id}/assignments', token, [
                ('include[]', 'submission'),
                ('per_page', '100')
            ])

            # Assignment groups are only needed for their display names.
            groups = canvas_get(f'/api/v1/courses/{course_id}/assignment_groups', token, [
                ('per_page', '100')
            ])
            group_names = {g.get('id'): g.get('name') for g in groups}
        except Exception as exc:
            course_errors.append({'course': course_name, 'error': str(exc)})
            continue

        for a in assignments:
            due = a.get('due_at')
            if not due or a.get('published') is False:
                continue
            submission = a.get('submission') or {}
            workflow = submission.get('workflow_state')
            submitted = workflow in {'submitted', 'graded', 'pending_review'} or bool(submission.get('submitted_at'))
            results.append({
                'id': f"canvas-{course_id}-{a.get('id')}",
                'source': 'Canvas',
                'courseId': course_id,
                'course': course_name,
                'title': a.get('name') or 'Untitled assignment',
                'due': due,
                'points': a.get('points_possible'),
                'url': a.get('html_url') or f'{CANVAS_BASE}/courses/{course_id}/assignments/{a.get("id")}',
                'submitted': submitted,
                'submissionState': workflow,
                'locked': a.get('locked_for_user', False),
                'group': group_names.get(a.get('assignment_group_id')),
                'description': a.get('description') or ''
            })

    learning_suite_error = None
    try:
        results.extend(get_learning_suite_events())
    except Exception as exc:
        learning_suite_error = str(exc)

    results.sort(key=lambda x: x['due'])
    return {'assignments': results, 'courseErrors': course_errors, 'learningSuiteError': learning_suite_error}


def _session_token(password):
    return hmac.new(password.encode('utf-8'), b'assignment-hub-session-v1', hashlib.sha256).hexdigest()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        print(fmt % args)

    def send_json(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def is_authorized(self, env=None):
        env = env or load_env()
        password = env.get('HUB_PASSWORD', '').strip()
        if not password:
            return True
        cookie = SimpleCookie(self.headers.get('Cookie', ''))
        value = cookie.get('assignment_hub_session')
        return bool(value and hmac.compare_digest(value.value, _session_token(password)))

    def do_POST(self):
        if self.path == '/api/login':
            env = load_env()
            password = env.get('HUB_PASSWORD', '').strip()
            if not password:
                self.send_json(200, {'ok': True})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                payload = json.loads(self.rfile.read(length).decode('utf-8')) if length else {}
            except Exception:
                payload = {}
            supplied = str(payload.get('password', ''))
            if not hmac.compare_digest(supplied, password):
                self.send_json(401, {'error': 'Incorrect Assignment Hub password.'})
                return
            secure = self.headers.get('X-Forwarded-Proto', '').lower() == 'https'
            cookie = f"assignment_hub_session={_session_token(password)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000"
            if secure:
                cookie += '; Secure'
            body = json.dumps({'ok': True}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Set-Cookie', cookie)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_json(404, {'error': 'Not found.'})

    def do_GET(self):
        # Never expose secrets or local project metadata if this is deployed.
        path = urllib.parse.urlparse(self.path).path
        if path == '/.env' or path.startswith('/.git') or '__pycache__' in path:
            self.send_error(404)
            return
        if self.path.startswith('/api/assignments'):
            env = load_env()
            if not self.is_authorized(env):
                self.send_json(401, {'error': 'Sign in to Assignment Hub.', 'authRequired': True})
                return
            token = env.get('CANVAS_TOKEN', '').strip()
            if not token or token == 'PASTE_YOUR_TOKEN_HERE':
                self.send_json(503, {
                    'error': 'Canvas token is not configured.',
                    'setup': 'Put your Canvas token in .env as CANVAS_TOKEN=... and restart Assignment Hub.'
                })
                return
            try:
                data = get_assignments(token)
                self.send_json(200, data)
            except urllib.error.HTTPError as exc:
                message = ''
                try:
                    message = exc.read().decode('utf-8')
                except Exception:
                    pass
                if exc.code in (401, 403):
                    self.send_json(exc.code, {'error': 'Canvas rejected the token. Check that it is correct and has not expired.'})
                else:
                    self.send_json(502, {'error': f'Canvas returned HTTP {exc.code}.', 'detail': message[:500]})
            except Exception as exc:
                self.send_json(502, {'error': 'Could not reach Canvas.', 'detail': str(exc)})
            return
        super().do_GET()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8765'))
    os.chdir(ROOT)
    print(f'Assignment Hub running at http://localhost:{port}')
    print('Press Control-C to stop it.')
    host = os.environ.get('HOST', '127.0.0.1')
    ThreadingHTTPServer((host, port), Handler).serve_forever()
