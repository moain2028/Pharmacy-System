#!/usr/bin/env python3
"""
Minimal parallel sub-agent runner over the OpenAI-compatible LLM proxy.

Usage:
  python3 tools/agents/run_agents.py jobs.json            # run all jobs in parallel
Each job: {"id": "...", "model": "...", "system": "...", "user": "...", "out": "path.md", "max_tokens": 12000}
Writes each completion to `out`, prints timing/usage. Never prints the API key.
"""
import json, os, sys, time, yaml, urllib.request, concurrent.futures as cf
from pathlib import Path

def load_cfg():
    p = Path(os.path.expanduser("~/.genspark_llm.yaml"))
    if p.exists():
        c = yaml.safe_load(p.read_text())["openai"]
        return c["base_url"], c["api_key"]
    return os.environ["OPENAI_BASE_URL"], os.environ["OPENAI_API_KEY"]

BASE, KEY = load_cfg()

def chat(model, system, user, max_tokens=12000, temperature=None, timeout=1500, retries=2):
    """Streaming (SSE) call: tokens flow continuously, so the gateway never idle-times-out (HTTP 524)."""
    body = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "max_completion_tokens": max_tokens, "stream": True, "stream_options": {"include_usage": True}}
    if temperature is not None: body["temperature"] = temperature
    last = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(BASE + "/chat/completions", data=json.dumps(body).encode(),
                                     headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json",
                                              "Accept": "text/event-stream"})
        parts, usage, fin = [], {}, None
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                for raw in r:
                    line = raw.decode("utf-8", "ignore").strip()
                    if not line.startswith("data:"): continue
                    data = line[5:].strip()
                    if data == "[DONE]": break
                    try: j = json.loads(data)
                    except Exception: continue
                    if j.get("usage"): usage = j["usage"]
                    for ch in j.get("choices", []):
                        d = ch.get("delta") or {}
                        if d.get("content"): parts.append(d["content"])
                        if ch.get("finish_reason"): fin = ch["finish_reason"]
            if parts: return "".join(parts), usage, fin
            last = RuntimeError("empty stream")
        except Exception as e:
            last = e
        time.sleep(5 * (attempt + 1))
    raise last

def run_job(job):
    t = time.time()
    try:
        text, usage, fin = chat(job["model"], job["system"], job["user"], job.get("max_tokens", 12000), job.get("temperature"))
        Path(job["out"]).parent.mkdir(parents=True, exist_ok=True)
        Path(job["out"]).write_text(text, encoding="utf-8")
        return f"OK   {job['id']:<28} {job['model']:<20} {time.time()-t:6.0f}s  out={usage.get('completion_tokens')} fin={fin} -> {job['out']}"
    except Exception as e:
        return f"FAIL {job['id']:<28} {job['model']:<20} {time.time()-t:6.0f}s  {str(e)[:200]}"

if __name__ == "__main__":
    jobs = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    with cf.ThreadPoolExecutor(max_workers=len(jobs)) as ex:
        for line in ex.map(run_job, jobs):
            print(line, flush=True)
