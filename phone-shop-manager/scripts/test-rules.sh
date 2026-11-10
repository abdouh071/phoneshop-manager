#!/bin/sh
# The Firestore emulator needs a real JDK; macOS ships only a stub at /usr/bin/java.
if ! java -version >/dev/null 2>&1; then
  for d in /opt/homebrew/opt/openjdk /opt/homebrew/opt/openjdk@25 /opt/homebrew/opt/openjdk@21; do
    if [ -x "$d/bin/java" ]; then
      export PATH="$d/bin:$PATH"
      break
    fi
  done
fi
exec firebase emulators:exec --only firestore --project demo-phoneshop-rules "node scripts/verify-firestore-rules.mjs"