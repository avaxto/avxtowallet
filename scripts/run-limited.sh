#!/usr/bin/env bash
#
# Copyright (c) 2026 @REKTBuildr
#
# Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
#
# Runs a heavy Node job (jest, vite build, tsc) within this machine's limits:
# 8 CPUs but only 8 GB of RAM, shared with the editor, the browser and usually
# a running dev server. Two jobs at once, or one with an uncapped heap, has
# frozen the machine more than once.
#
#   scripts/run-limited.sh <heap-MB> <command...>
#
# - Caps the V8 heap of every Node process the command starts (workers included,
#   they inherit NODE_OPTIONS) at <heap-MB>.
# - Caps the thread pools of esbuild (GOMAXPROCS) and libuv (UV_THREADPOOL_SIZE).
# - Runs at lower CPU priority, so the desktop stays responsive.
# - Takes a lock: a second heavy job waits for the first to finish instead of
#   running alongside it. Set AVXTO_NO_LOCK=1 to skip (e.g. in CI).
#
# The caps are set here, after the caller's environment, so a NODE_OPTIONS
# exported in the shell can't raise them. To change a budget, change it in
# package.json.
set -euo pipefail

heap_mb="$1"
shift

export NODE_OPTIONS="--max-old-space-size=${heap_mb}"
export GOMAXPROCS="${AVXTO_THREADS:-2}"
export UV_THREADPOOL_SIZE="${AVXTO_THREADS:-2}"

lock="${TMPDIR:-/tmp}/avxto-heavy-job.lock"
if [ -z "${AVXTO_NO_LOCK:-}" ]; then
    waited=0
    until mkdir "$lock" 2>/dev/null; do
        holder="$(cat "$lock/pid" 2>/dev/null || true)"
        # A lock left behind by a job that was killed: take it over.
        if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
            rm -rf "$lock"
            continue
        fi
        if [ "$waited" -eq 0 ]; then
            echo "run-limited: another heavy job (pid ${holder:-?}) is running; waiting for it to finish…" >&2
        fi
        waited=1
        sleep 2
    done
    echo $$ >"$lock/pid"
    trap 'rm -rf "$lock"' EXIT INT TERM
fi

nice -n 10 "$@"
