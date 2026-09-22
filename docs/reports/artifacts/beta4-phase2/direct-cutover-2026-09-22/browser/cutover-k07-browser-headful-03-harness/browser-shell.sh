#!/bin/bash
set -eu
# Operator control uses the existing main source/schema, never the candidate CLI.
cd -- $REPOSITORY
export PIBO_HOME=$OPERATOR_HOME
eval "$(npm run --silent dev -- tools env browser-use)"
export BROWSER_USE_HOME=$OPERATOR_HOME/tools/browser-use/home
export PIBO_BROWSER_USE_LEASE_ID=pibo-chat-slot-001
export PIBO_BROWSER_USE_SESSION=pibo-auth-pibo-chat-slot-001
export PIBO_BROWSER_USE_CHROME_USER_DATA_DIR=$OPERATOR_HOME/tools/browser-use/home/auth-pool/pibo-chat/slot-001
export PIBO_BROWSER_USE_DEFAULT_PROFILE=PIBo
export PIBO_BROWSER_POOL_LEASE_ID=browser-use:pibo-auth-pibo-chat-slot-001
browser-use "$@"
