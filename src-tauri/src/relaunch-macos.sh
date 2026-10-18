#!/bin/sh
# Arguments are passed separately, never interpolated into shell source. Keep
# the original bundle spelling (including Unicode normalization) from NSBundle.
old_pid=$1
bundle=$2
attempt=0
while /bin/kill -0 "$old_pid" 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 600 ]; then
    echo "The previous app did not exit; refusing to launch a second instance." >&2
    exit 1
  fi
  /bin/sleep 0.1
done

if [ ! -f "$bundle/Contents/Info.plist" ]; then
  echo "The installed app bundle is missing: $bundle" >&2
  exit 1
fi

# The updater atomically replaces the bundle, so LaunchServices may still have
# the previous file identity registered. Refresh this path before opening it.
register=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
if [ -x "$register" ]; then
  "$register" -f "$bundle" || echo "LaunchServices refresh failed." >&2
fi
# No -n: reuse an instance if the user already reopened the app while we waited.
exec /usr/bin/open "$bundle"
