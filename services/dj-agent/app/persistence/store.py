"""Persistencia SQLite (stdlib) del estado del agente.

Una sola conexión protegida por un cerrojo (el servicio es de una instancia, ADR-003).
El motor sigue siendo la fuente de verdad del tiempo de reproducción; aquí se guarda
el plano de control: sesiones, modo, política, comandos, idempotencia, propuestas,
planes, eventos (con secuencia por sesión) y consumo de IA.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from typing import Any

from app.core.errors import conflict

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL,
  mode TEXT NOT NULL, state TEXT NOT NULL, agent_state TEXT NOT NULL, version INTEGER NOT NULL,
  controller_id TEXT, controller_expires_at REAL, pending_control_request TEXT,
  policy_json TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS commands(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, action TEXT NOT NULL, params_json TEXT NOT NULL,
  origin TEXT NOT NULL, actor_id TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT, error_message TEXT,
  correlation_id TEXT NOT NULL, proposal_id TEXT, engine_response TEXT,
  created_at REAL NOT NULL, updated_at REAL NOT NULL);
CREATE INDEX IF NOT EXISTS ix_commands_status ON commands(status);
CREATE TABLE IF NOT EXISTS idempotency(
  scope TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL,
  status_code INTEGER, response_json TEXT, created_at REAL NOT NULL, PRIMARY KEY(scope, key));
CREATE TABLE IF NOT EXISTS proposals(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL,
  commands_json TEXT NOT NULL, requires_approval INTEGER NOT NULL, status TEXT NOT NULL, reason TEXT,
  decided_by TEXT, decided_at REAL, created_by TEXT NOT NULL, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS plans(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
  source TEXT NOT NULL, constraints_json TEXT NOT NULL, items_json TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS events(
  session_id TEXT NOT NULL, sequence INTEGER NOT NULL, event_id TEXT NOT NULL, type TEXT NOT NULL,
  payload_json TEXT NOT NULL, correlation_id TEXT, source TEXT NOT NULL, status TEXT, actor_id TEXT,
  ts REAL NOT NULL, PRIMARY KEY(session_id, sequence));
CREATE TABLE IF NOT EXISTS llm_usage(
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, org_id TEXT, provider TEXT, model TEXT,
  tokens_in INTEGER, tokens_out INTEGER, cost_estimated REAL, latency_ms REAL, outcome TEXT, ts REAL NOT NULL);
"""

_JSON_FIELDS = {"policy_json", "params_json", "commands_json", "constraints_json", "items_json",
                "payload_json", "engine_response", "response_json"}


def _row(cur: sqlite3.Cursor, row: tuple) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for col, val in zip([c[0] for c in cur.description], row, strict=True):
        if col in _JSON_FIELDS and val is not None:
            val = json.loads(val)
        out[col] = val
    return out


def new_id() -> str:
    return str(uuid.uuid4())


class Store:
    def __init__(self, path: str):
        self.path = path
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = _row
        if path != ":memory:":
            self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def _exec(self, sql: str, args: tuple = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._conn.execute(sql, args)

    def ping(self) -> bool:
        try:
            self._exec("SELECT 1").fetchone()
            return True
        except sqlite3.Error:
            return False

    # ---------------- sesiones ----------------
    def insert_session(self, s: dict[str, Any]) -> None:
        self._exec(
            "INSERT INTO sessions(id,org_id,owner_id,name,mode,state,agent_state,version,controller_id,"
            "controller_expires_at,pending_control_request,policy_json,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (s["id"], s["org_id"], s["owner_id"], s["name"], s["mode"], s["state"], s["agent_state"],
             s["version"], s.get("controller_id"), s.get("controller_expires_at"),
             s.get("pending_control_request"), json.dumps(s["policy_json"]), s["created_at"], s["updated_at"]))

    def get_session(self, sid: str) -> dict[str, Any] | None:
        return self._exec("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()

    def list_sessions(self, org_id: str | None = None) -> list[dict[str, Any]]:
        if org_id is None:
            return self._exec("SELECT * FROM sessions ORDER BY created_at").fetchall()
        return self._exec("SELECT * FROM sessions WHERE org_id=? ORDER BY created_at", (org_id,)).fetchall()

    def update_session(self, sid: str, *, expected_version: int | None = None, bump: bool = True,
                       **fields: Any) -> dict[str, Any]:
        """Actualiza con control optimista de concurrencia (``expected_version``)."""
        with self._lock:
            cur = self.get_session(sid)
            if cur is None:
                raise KeyError(sid)
            if expected_version is not None and expected_version != cur["version"]:
                raise conflict("version_conflict", "La sesión cambió; recarga el estado y reintenta",
                               expected=expected_version, actual=cur["version"])
            if "policy_json" in fields:
                fields["policy_json"] = json.dumps(fields["policy_json"])
            fields["updated_at"] = time.time()
            if bump:
                fields["version"] = cur["version"] + 1
            cols = ", ".join(f"{k}=?" for k in fields)
            self._conn.execute(f"UPDATE sessions SET {cols} WHERE id=?", (*fields.values(), sid))
            return self.get_session(sid)  # type: ignore[return-value]

    # ---------------- comandos ----------------
    def insert_command(self, c: dict[str, Any]) -> None:
        now = time.time()
        self._exec(
            "INSERT INTO commands(id,session_id,action,params_json,origin,actor_id,status,error_code,"
            "error_message,correlation_id,proposal_id,engine_response,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (c["id"], c["session_id"], c["action"], json.dumps(c["params"]), c["origin"], c["actor_id"],
             c["status"], c.get("error_code"), c.get("error_message"), c["correlation_id"],
             c.get("proposal_id"), None, now, now))

    def update_command(self, cid: str, **fields: Any) -> dict[str, Any]:
        with self._lock:
            if "engine_response" in fields:
                fields["engine_response"] = json.dumps(fields["engine_response"])
            fields["updated_at"] = time.time()
            cols = ", ".join(f"{k}=?" for k in fields)
            self._conn.execute(f"UPDATE commands SET {cols} WHERE id=?", (*fields.values(), cid))
            return self.get_command(cid)  # type: ignore[return-value]

    def get_command(self, cid: str) -> dict[str, Any] | None:
        return self._exec("SELECT * FROM commands WHERE id=?", (cid,)).fetchone()

    def list_commands(self, session_id: str, limit: int = 200) -> list[dict[str, Any]]:
        return self._exec("SELECT * FROM commands WHERE session_id=? ORDER BY created_at DESC LIMIT ?",
                          (session_id, limit)).fetchall()

    def commands_with_status(self, status: str) -> list[dict[str, Any]]:
        return self._exec("SELECT * FROM commands WHERE status=?", (status,)).fetchall()

    def count_commands(self, session_id: str, action: str, since: float, origin: str | None = None) -> int:
        sql = "SELECT COUNT(*) AS n FROM commands WHERE session_id=? AND action=? AND created_at>=? AND status='ACKNOWLEDGED'"
        args: tuple = (session_id, action, since)
        if origin:
            sql += " AND origin=?"
            args = (*args, origin)
        return int(self._exec(sql, args).fetchone()["n"])

    # ---------------- idempotencia ----------------
    def idem_reserve(self, scope: str, key: str, request_hash: str) -> dict[str, Any] | None:
        """Reserva la clave. Devuelve None si es nueva; si ya existía, su registro."""
        with self._lock:
            row = self._conn.execute("SELECT * FROM idempotency WHERE scope=? AND key=?", (scope, key)).fetchone()
            if row is not None:
                return row
            self._conn.execute("INSERT INTO idempotency(scope,key,request_hash,status_code,response_json,created_at) "
                               "VALUES(?,?,?,?,?,?)", (scope, key, request_hash, None, None, time.time()))
            return None

    def idem_complete(self, scope: str, key: str, status_code: int, response: Any) -> None:
        self._exec("UPDATE idempotency SET status_code=?, response_json=? WHERE scope=? AND key=?",
                   (status_code, json.dumps(response), scope, key))

    def idem_release(self, scope: str, key: str) -> None:
        """Libera una reserva cuya ejecución no llegó a producir efecto (error de validación)."""
        self._exec("DELETE FROM idempotency WHERE scope=? AND key=? AND status_code IS NULL", (scope, key))

    # ---------------- propuestas ----------------
    def insert_proposal(self, p: dict[str, Any]) -> None:
        self._exec(
            "INSERT INTO proposals(id,session_id,kind,summary,commands_json,requires_approval,status,reason,"
            "decided_by,decided_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (p["id"], p["session_id"], p["kind"], p["summary"], json.dumps(p["commands"]),
             1 if p["requires_approval"] else 0, p["status"], p.get("reason", ""), None, None,
             p["created_by"], p["created_at"]))

    def get_proposal(self, pid: str) -> dict[str, Any] | None:
        return self._exec("SELECT * FROM proposals WHERE id=?", (pid,)).fetchone()

    def update_proposal(self, pid: str, **fields: Any) -> dict[str, Any]:
        with self._lock:
            cols = ", ".join(f"{k}=?" for k in fields)
            self._conn.execute(f"UPDATE proposals SET {cols} WHERE id=?", (*fields.values(), pid))
            return self.get_proposal(pid)  # type: ignore[return-value]

    def list_proposals(self, session_id: str, status: str | None = None) -> list[dict[str, Any]]:
        if status:
            return self._exec("SELECT * FROM proposals WHERE session_id=? AND status=? ORDER BY created_at",
                              (session_id, status)).fetchall()
        return self._exec("SELECT * FROM proposals WHERE session_id=? ORDER BY created_at",
                          (session_id,)).fetchall()

    # ---------------- planes ----------------
    def insert_plan(self, p: dict[str, Any]) -> None:
        with self._lock:
            self._conn.execute("UPDATE plans SET status='SUPERSEDED' WHERE session_id=? AND status IN ('PROPOSED','ACTIVE')",
                               (p["session_id"],))
            self._conn.execute(
                "INSERT INTO plans(id,session_id,version,status,source,constraints_json,items_json,created_by,created_at) "
                "VALUES(?,?,?,?,?,?,?,?,?)",
                (p["id"], p["session_id"], p["version"], p["status"], p["source"], json.dumps(p["constraints"]),
                 json.dumps(p["items"]), p["created_by"], p["created_at"]))

    def current_plan(self, session_id: str) -> dict[str, Any] | None:
        return self._exec("SELECT * FROM plans WHERE session_id=? AND status IN ('PROPOSED','ACTIVE') "
                          "ORDER BY version DESC LIMIT 1", (session_id,)).fetchone()

    def update_plan(self, plan_id: str, **fields: Any) -> None:
        cols = ", ".join(f"{k}=?" for k in fields)
        self._exec(f"UPDATE plans SET {cols} WHERE id=?", (*fields.values(), plan_id))

    def next_plan_version(self, session_id: str) -> int:
        return int(self._exec("SELECT COALESCE(MAX(version),0)+1 AS v FROM plans WHERE session_id=?",
                              (session_id,)).fetchone()["v"])

    # ---------------- eventos (auditoría + tiempo real) ----------------
    def append_event(self, session_id: str, type_: str, payload: dict[str, Any], *, correlation_id: str | None,
                     source: str, status: str | None, actor_id: str | None) -> dict[str, Any]:
        with self._lock:
            seq = int(self._conn.execute("SELECT COALESCE(MAX(sequence),0)+1 AS s FROM events WHERE session_id=?",
                                         (session_id,)).fetchone()["s"])
            ev = {"event_id": new_id(), "sequence": seq, "session_id": session_id, "timestamp": time.time(),
                  "type": type_, "payload": payload, "correlation_id": correlation_id, "source": source,
                  "status": status, "actor_id": actor_id}
            self._conn.execute(
                "INSERT INTO events(session_id,sequence,event_id,type,payload_json,correlation_id,source,status,actor_id,ts) "
                "VALUES(?,?,?,?,?,?,?,?,?,?)",
                (session_id, seq, ev["event_id"], type_, json.dumps(payload, ensure_ascii=False), correlation_id,
                 source, status, actor_id, ev["timestamp"]))
            return ev

    def events_since(self, session_id: str, after_sequence: int, limit: int = 500) -> list[dict[str, Any]]:
        rows = self._exec("SELECT * FROM events WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT ?",
                          (session_id, after_sequence, limit)).fetchall()
        return [{"event_id": r["event_id"], "sequence": r["sequence"], "session_id": r["session_id"],
                 "timestamp": r["ts"], "type": r["type"], "payload": r["payload_json"],
                 "correlation_id": r["correlation_id"], "source": r["source"], "status": r["status"],
                 "actor_id": r["actor_id"]} for r in rows]

    def last_sequence(self, session_id: str) -> int:
        return int(self._exec("SELECT COALESCE(MAX(sequence),0) AS s FROM events WHERE session_id=?",
                              (session_id,)).fetchone()["s"])

    # ---------------- consumo de IA ----------------
    def insert_usage(self, u: dict[str, Any]) -> None:
        self._exec("INSERT INTO llm_usage(session_id,org_id,provider,model,tokens_in,tokens_out,cost_estimated,"
                   "latency_ms,outcome,ts) VALUES(?,?,?,?,?,?,?,?,?,?)",
                   (u.get("session_id"), u.get("org_id"), u.get("provider"), u.get("model"),
                    u.get("tokens_in", 0), u.get("tokens_out", 0), u.get("cost_estimated", 0.0),
                    u.get("latency_ms", 0.0), u.get("outcome"), time.time()))

    def usage_cost(self, *, org_id: str | None = None, session_id: str | None = None, since: float = 0.0) -> float:
        sql, args = "SELECT COALESCE(SUM(cost_estimated),0) AS c FROM llm_usage WHERE ts>=?", [since]
        if org_id:
            sql += " AND org_id=?"
            args.append(org_id)
        if session_id:
            sql += " AND session_id=?"
            args.append(session_id)
        return float(self._exec(sql, tuple(args)).fetchone()["c"])

    def usage_rows(self, *, org_id: str, limit: int = 100) -> list[dict[str, Any]]:
        return self._exec("SELECT * FROM llm_usage WHERE org_id=? ORDER BY ts DESC LIMIT ?", (org_id, limit)).fetchall()
