#!/usr/bin/env bash
# Deploys the program to devnet with the real 72-hour and 7-day timers.
# The wallet in .keys/devnet-deployer.json needs about 2.5 devnet SOL.
set -euo pipefail
anchor build
cp target/idl/shipstake.json app/src/idl/shipstake.json
solana program deploy target/deploy/shipstake.so \
  --program-id target/deploy/shipstake-keypair.json \
  --keypair .keys/devnet-deployer.json \
  --url devnet
