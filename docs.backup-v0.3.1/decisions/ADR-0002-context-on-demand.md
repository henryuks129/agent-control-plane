# ADR-0002 — Context-on-demand

Status: accepted

Agents do not receive the full project state. Task scope is the entry point; relevant code, contracts, design patterns, and historical decisions are retrieved only when needed. This reduces inference cost and makes failover cheaper.
