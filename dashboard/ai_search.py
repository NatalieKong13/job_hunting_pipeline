"""Run one Cursor local-agent job search and report status."""

from __future__ import annotations

import os
import platform
import subprocess
import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

REPO = Path(__file__).resolve().parents[1]
DASHBOARD = Path(__file__).resolve().parent

_lock = threading.Lock()
_state: dict[str, Any] = {
    "status": "idle",  # idle | running | finished | error
    "startedAt": None,
    "finishedAt": None,
    "error": None,
    "summary": None,
    "agentId": None,
    "runId": None,
    "added": None,
}


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _applescript_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace('"', '\\"')


def _notify(title: str, message: str) -> None:
    """Best-effort macOS Notification Center popup when AI search ends."""
    try:
        if platform.system() != "Darwin":
            return
        title_s = _applescript_escape((title or "找工 Pipeline")[:80])
        body_s = _applescript_escape((message or "")[:200])
        script = (
            f'display notification "{body_s}" with title "{title_s}" '
            f'sound name "Glass"'
        )
        subprocess.run(
            ["osascript", "-e", script],
            check=False,
            timeout=8,
            capture_output=True,
        )
    except Exception:
        pass


def _finish(
    status: str,
    *,
    notify_title: str,
    notify_body: str,
    **kwargs: Any,
) -> None:
    _set(status=status, finishedAt=_now(), **kwargs)
    _notify(notify_title, notify_body)


def load_dotenv() -> None:
    """Load KEY=VALUE from repo/.env into os.environ (does not override)."""
    path = REPO / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = val


def get_status() -> dict[str, Any]:
    with _lock:
        return dict(_state)


def _set(**kwargs: Any) -> None:
    with _lock:
        _state.update(kwargs)


def api_key() -> str:
    load_dotenv()
    return (os.environ.get("CURSOR_API_KEY") or "").strip()


def build_prompt() -> str:
    return f"""你是求职搜岗助手。在本地仓库里完成一轮「轻量 AI 搜岗」，把合适岗位写入 dashboard/data.js。

## 硬性规则
1. 只使用 `求职知识库.md` 里已确认的条件；不要编造候选人信息。
2. 目标：加拿大范围内的 Full-Stack / Backend-Platform / AI-ML / 通用 SWE。
3. 机会类型：可接受 2027.01 起的 Co-op/Internship，以及约 2027.04 毕业后的 New Grad。
4. 身份：国际学生，毕业后可用 PGWP，不需要 sponsorship。
5. 薪资偏好：实习约 CAD $25+/h；全职约 CAD $80k+（没有薪资也可收录，在 notes 说明）。
6. 排除明显 Senior/Staff/Lead，以及毕业窗口明显不匹配的岗位。
7. 本次做**轻量搜索**：优先 WebSearch；最多打开 6–8 个 JD 页面细读。不要无意义地狂刷页面。

## 数据写入
1. 先读 `dashboard/data.js` 与（如有）`dashboard/seed.json`，了解现有 queue / applications。
2. 合并新岗位进 `window.JOB_DATA.queue`：
   - 按 url（去 query）或 company+title 去重；已存在的保留原 id。
   - 新岗位用递增 id（如现有最大 q-011 → 新的从 q-012 起）。
   - **不要删除**已有 queue 项，除非确认链接失效且你要替换为官方链接。
   - **不要改写 applications**（若 data.js 里没有 applications 字段也没关系）。
3. 每个岗位字段：
   - id, company, title, location, salary, url, notes, addedAt (今天 YYYY-MM-DD)
   - postedAt（可知则写）
   - roleType: "new_grad" | "intern" | "full_time"
   - bigTech: boolean
   - source: "Indeed" | "LinkedIn" | "Ashby" | "Workday" | "BuiltIn" | 其他短名
4. 更新 `updatedAt` 为今天。
5. 写完 `dashboard/data.js` 后，同步更新 `dashboard/seed.json` 为同等 JSON（方便服务端导入）。

## 完成标准
- 尽量新增 3–10 个匹配岗位；若网上确实很少，少也可以，但要在最终回复说明搜了什么关键词。
- 最终用简短中文总结：新增几个、来源、以及任何截止日提醒。
- 不要提交 git，不要改 server.py / app.js / 知识库。

仓库根目录：{REPO}
"""


def run_ai_search(on_done: Callable[[], dict[str, Any]] | None = None) -> dict[str, Any]:
    """Start a background local-agent search. Returns immediate status payload."""
    key = api_key()
    if not key:
        return {
            "ok": False,
            "error": "缺少 CURSOR_API_KEY。请在项目根目录创建 .env（可参考 .env.example）后重启 server。",
        }

    with _lock:
        if _state["status"] == "running":
            return {"ok": False, "error": "已有一轮 AI 搜岗在进行中", **dict(_state)}
        _state.update(
            {
                "status": "running",
                "startedAt": _now(),
                "finishedAt": None,
                "error": None,
                "summary": None,
                "agentId": None,
                "runId": None,
                "added": None,
            }
        )

    thread = threading.Thread(
        target=_worker,
        args=(key, on_done),
        name="ai-search",
        daemon=True,
    )
    thread.start()
    return {"ok": True, "status": "running", **get_status()}


def _worker(key: str, on_done: Callable[[], dict[str, Any]] | None) -> None:
    try:
        from cursor_sdk import Agent, AgentOptions, CursorAgentError, LocalAgentOptions

        model = (os.environ.get("CURSOR_MODEL") or "composer-2.5").strip()
        options = AgentOptions(
            api_key=key,
            model=model,
            local=LocalAgentOptions(
                cwd=str(REPO),
                # Allow project/user MCP (e.g. browser) if configured.
                setting_sources=["project", "user", "plugins"],
            ),
        )
        result = Agent.prompt(build_prompt(), options)

        summary = getattr(result, "result", None) or getattr(result, "status", None)
        run_id = getattr(result, "id", None)
        status = getattr(result, "status", None)

        if status == "error":
            _finish(
                "error",
                notify_title="AI 搜岗失败",
                notify_body=f"Agent run failed（runId={run_id}）",
                error=f"Agent run failed (runId={run_id})",
                runId=run_id,
                summary=str(summary) if summary else None,
            )
            return

        post: dict[str, Any] = {}
        if on_done:
            try:
                post = on_done() or {}
            except Exception as exc:  # noqa: BLE001
                _finish(
                    "error",
                    notify_title="AI 搜岗失败",
                    notify_body=f"Agent 完成但导入失败: {exc}",
                    error=f"Agent 完成但导入失败: {exc}",
                    runId=run_id,
                    summary=str(summary) if summary else None,
                )
                return

        added = post.get("added")
        if isinstance(added, int):
            body = f"新增 {added} 个未投岗位" if added else "没有新的未投岗位"
        else:
            body = "搜岗已完成，请打开 Dashboard 查看"
        _finish(
            "finished",
            notify_title="AI 搜岗完成",
            notify_body=body,
            error=None,
            runId=run_id,
            summary=str(summary) if summary is not None else None,
            added=added,
            agentId=post.get("agentId"),
        )
    except Exception as exc:  # noqa: BLE001
        # Import CursorAgentError lazily; treat all as startup/runtime failure.
        msg = str(exc)
        try:
            from cursor_sdk import CursorAgentError

            if isinstance(exc, CursorAgentError):
                msg = f"{exc.message} (retryable={getattr(exc, 'is_retryable', None)})"
        except Exception:
            pass
        _finish(
            "error",
            notify_title="AI 搜岗失败",
            notify_body=msg[:200] or "未知错误",
            error=msg,
            summary=traceback.format_exc()[-1500:],
        )
