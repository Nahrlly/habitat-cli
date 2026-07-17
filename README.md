# Habitat CLI

## OpenClaw autonomy

OpenClaw may run one bounded Habitat cycle on a schedule you choose. Each cycle reads live Habitat state, applies safety policy, lets OpenClaw choose only from legal actions, executes at most one action, and records an audit entry in the Habitat SQLite database.

```sh
habitat autonomy start --every 5m --name "resource watch"
habitat autonomy status
habitat autonomy run-now
habitat autonomy stop
```

Supported intervals use `5m`, `1h`, or `1d` forms. The controller fails closed when Habitat state is unavailable, refuses over-capacity collection and out-of-bounds movement, and never deploys a second EVA while one is active.
