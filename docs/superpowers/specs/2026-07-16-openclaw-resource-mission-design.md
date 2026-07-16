# OpenClaw Resource Mission Design

## Goal

Add a dashboard button that starts one persistent OpenClaw-directed mission. The mission deploys an EVA human, searches for useful resources, collects them, and safely returns the human without requiring another click.

## Architecture

The dashboard starts and stops a server-owned mission through Habitat REST endpoints. OpenClaw repeatedly inspects live Habitat state and selects the next action, while Habitat remains authoritative for deployment, movement, scanning, collection, resource limits, and docking. Each loop iteration executes at most one validated action and records an audit entry.

The mission must survive dashboard refreshes and expose status and final report endpoints. Only one mission may run at a time. OpenClaw decisions are limited to actions presented by Habitat; arbitrary shell commands and direct database mutation are not part of this feature.

## Mission Flow

1. `POST /autonomy/mission/start` creates a mission unless one is already active.
2. The mission selects an eligible human and deploys the EVA when needed.
3. OpenClaw inspects humans, EVA status, sector bounds, scans, inventory, and prior audit entries.
4. OpenClaw selects one legal action: scan, move, collect, dock, or finish.
5. Habitat validates and executes the action, then records the result.
6. The loop continues until a stop condition occurs.
7. On capacity, low resources, operator stop, or no safe action, the human returns to `(0, 0)` and docks when safely possible.
8. The mission stores a final report with collected resources, scan history, stop reason, and timestamps.

## Stop Conditions

The mission stops when EVA carrying capacity is full, battery is at or below 25% of maximum, oxygen is at or below 25% of maximum, the operator requests stop, no safe action remains, OpenClaw/Kepler failures exceed the retry limit, or the mission timeout is reached. Low-resource and capacity stops must prioritize a safe return and docking.

## EVA Resource Model

Each surface tile represents 100 meters. One tick represents one movement or action interval. Movement and ordinary EVA actions consume `0.25` oxygen and `0.25` power per tick, replacing the current `1` unit of each. With 100-unit maximum reserves, this provides approximately 400 action ticks before exhaustion and preserves approximately 100 ticks at the 25% return threshold.

Habitat scans use the existing `/world/scan?strength=&radius=` contract. A strength-100 scan consumes 1% of maximum EVA battery; lower strengths consume proportionally:

```text
scan battery cost = maximum battery × strength / 100 × 0.01
```

Before scanning or moving, the controller must reserve enough oxygen and battery for the estimated return path. The mission must not deliberately exhaust either resource.

## Dashboard

Add `Start Resource Mission`, `Stop Mission`, and live mission status. Display current action, selected human, EVA position, oxygen, battery, carry capacity, latest scan strength/results, collected quantities, stop reason, errors, and final report. Use the existing REST/WebSocket refresh patterns and do not duplicate server safety rules in React.

## Error Handling

OpenClaw unavailability, invalid decisions, Kepler failures, duplicate starts, unsafe actions, and timeouts produce readable mission errors and audit records. Invalid or unsafe actions fail closed. The operator can stop an active mission independently of OpenClaw.

## Verification

Tests must cover mission startup and persistence, one-action iteration, deployment, repeated scan/move/collect behavior, capacity completion, 25% low-resource completion, safe docking, proportional scan cost, return-reserve checks, duplicate starts, operator stop, invalid decisions, service failures, and dashboard progress/error states.
