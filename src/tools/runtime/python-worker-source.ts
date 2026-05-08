export const PYTHON_RUNTIME_WORKER_SOURCE = String.raw`
import contextlib
import inspect
import io
import json
import signal
import sys
import traceback

user_globals = {"__name__": "__pibo_runtime__"}


def bounded(value, max_bytes=8192):
    text = str(value)
    encoded = text.encode("utf-8", "replace")
    if len(encoded) <= max_bytes:
        return text
    return encoded[:max_bytes].decode("utf-8", "replace") + "\n...<truncated>"


def safe_repr(value, max_bytes=4096):
    try:
        return bounded(repr(value), max_bytes)
    except Exception as exc:
        return f"<repr failed: {type(exc).__name__}: {exc}>"


def summarize(value, max_bytes=4096):
    result = {"type": type(value).__name__, "repr": safe_repr(value, max_bytes)}
    try:
        if hasattr(value, "shape"):
            shape = getattr(value, "shape")
            try:
                result["shape"] = list(shape)
            except Exception:
                pass
        if hasattr(value, "columns"):
            try:
                result["columns"] = [str(c) for c in list(getattr(value, "columns"))[:50]]
            except Exception:
                pass
        if isinstance(value, dict):
            result["length"] = len(value)
            result["keys"] = [safe_repr(k, 128) for k in list(value.keys())[:50]]
        elif isinstance(value, (list, tuple, set, frozenset, str, bytes, bytearray)):
            result["length"] = len(value)
        if hasattr(value, "head"):
            try:
                result["preview"] = bounded(value.head().to_string(), max_bytes)
            except Exception:
                pass
    except Exception:
        pass
    return result


def error_summary(exc):
    tb = traceback.format_exc()
    line = None
    try:
        extracted = traceback.extract_tb(exc.__traceback__)
        runtime_frames = [frame for frame in extracted if frame.filename == "<pibo-runtime>"]
        if runtime_frames:
            line = runtime_frames[-1].lineno
    except Exception:
        pass
    out = {"name": type(exc).__name__, "message": str(exc), "traceback": tb}
    if line is not None:
        out["line"] = line
    return out


def execute(req):
    mode = req.get("mode") or "exec"
    code = req.get("code") or ""
    if mode == "auto":
        mode = "exec"
    stdout = io.StringIO()
    stderr = io.StringIO()
    try:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            if mode == "eval":
                value = eval(compile(code, "<pibo-runtime>", "eval"), user_globals, user_globals)
            else:
                exec(compile(code, "<pibo-runtime>", "exec"), user_globals, user_globals)
                value = None
        return {
            "id": req.get("id"),
            "status": "ok",
            "stdout": stdout.getvalue(),
            "stderr": stderr.getvalue(),
            "result": summarize(value) if value is not None else None,
        }
    except KeyboardInterrupt as exc:
        return {"id": req.get("id"), "status": "interrupted", "stdout": stdout.getvalue(), "stderr": stderr.getvalue(), "error": error_summary(exc)}
    except Exception as exc:
        return {"id": req.get("id"), "status": "error", "stdout": stdout.getvalue(), "stderr": stderr.getvalue(), "error": error_summary(exc)}


def inspect_value(req):
    expression = req.get("expression") or ""
    what = req.get("what") or "summary"
    max_bytes = int(req.get("maxBytes") or 8192)
    try:
        value = eval(compile(expression, "<pibo-runtime>", "eval"), user_globals, user_globals)
        result = {"id": req.get("id"), "status": "ok"}
        if what in ("summary", "all"):
            result["summary"] = summarize(value, max_bytes)
        if what in ("signature", "all"):
            try:
                result["signature"] = bounded(str(inspect.signature(value)), max_bytes)
            except Exception as exc:
                result["signature"] = f"<signature unavailable: {type(exc).__name__}: {exc}>"
        if what in ("members", "all"):
            try:
                result["members"] = [name for name, _ in inspect.getmembers(value)[:200]]
            except Exception:
                result["members"] = dir(value)[:200]
        if what in ("source", "all"):
            try:
                result["source"] = bounded(inspect.getsource(value), max_bytes)
            except Exception as exc:
                result["source"] = f"<source unavailable: {type(exc).__name__}: {exc}>"
        if what in ("doc", "all"):
            result["doc"] = bounded(inspect.getdoc(value) or "", max_bytes)
        return result
    except Exception as exc:
        return {"id": req.get("id"), "status": "error", "error": error_summary(exc)}


def list_vars(req):
    include_private = bool(req.get("includePrivate"))
    max_items = int(req.get("maxItems") or 100)
    max_bytes = int(req.get("maxBytes") or 4096)
    variables = []
    for name, value in sorted(user_globals.items()):
        if name == "__builtins__":
            continue
        if not include_private and name.startswith("_"):
            continue
        if inspect.ismodule(value):
            continue
        variables.append({"name": name, "summary": summarize(value, max_bytes)})
        if len(variables) >= max_items:
            break
    return {"id": req.get("id"), "status": "ok", "variables": variables, "truncated": len(variables) >= max_items}


def write_response(resp):
    sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    write_response({"id": "ready", "status": "ready"})
    for line in sys.stdin:
        try:
            req = json.loads(line)
            typ = req.get("type")
            if typ == "exec":
                resp = execute(req)
            elif typ == "inspect":
                resp = inspect_value(req)
            elif typ == "vars":
                resp = list_vars(req)
            elif typ == "shutdown":
                write_response({"id": req.get("id"), "status": "ok"})
                return
            else:
                resp = {"id": req.get("id"), "status": "error", "error": {"name": "RuntimeProtocolError", "message": f"unknown request type {typ}"}}
        except Exception as exc:
            resp = {"id": None, "status": "error", "error": error_summary(exc)}
        write_response(resp)


if __name__ == "__main__":
    main()
`;
