# Governance Memory Templates

Bootstrap runtime governance state from these templates.

## Create Runtime Files

```bash
mkdir -p memory/COMMUNITY memory/ENGINEERING memory/SUSTAINABILITY memory/GOVERN memory/EDO
cp memory-templates/_budget_header.md memory/_budget_header.md
cp memory-templates/edo_index.md memory/edo_index.md
cp memory-templates/EDO.template.md memory/EDO/_template.md
cp memory-templates/COMMUNITY.heartbeat.md memory/COMMUNITY/heartbeat.md
cp memory-templates/ENGINEERING.heartbeat.md memory/ENGINEERING/heartbeat.md
cp memory-templates/SUSTAINABILITY.heartbeat.md memory/SUSTAINABILITY/heartbeat.md
cp memory-templates/GOVERN.heartbeat.md memory/GOVERN/heartbeat.md
```

Use overwrite semantics for heartbeats and gate updates during runs.
Use `memory/EDO/_template.md` for EDO files; track only open/recent EDO refs in `memory/edo_index.md`.
