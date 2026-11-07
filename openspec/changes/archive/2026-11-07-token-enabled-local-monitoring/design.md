# Design

`loadEnvironment` derives `observability.enabled` from the presence of `METRICS_TOKEN`. An empty or absent token leaves it disabled; a supplied token must be at least 32 characters and requires `LOG_SPOOL_DIRECTORY`. The obsolete switch is ignored for compatibility. Local Compose passes the token only when configured; production Compose has no metrics or logging services and passes no token. The optional local profile still provides Grafana/Prometheus/Logstash/Elasticsearch.
