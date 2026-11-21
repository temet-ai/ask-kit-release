#!/bin/sh
# Seeds the ledger database for local development.
psql "postgres://clerk:hunter2-pw@db.example.com:5432/ledger" -f seed.sql
