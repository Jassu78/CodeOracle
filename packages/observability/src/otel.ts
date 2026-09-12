export type OtelInitEnv = {
  OTEL_ENABLED: boolean;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  OTEL_SERVICE_NAME?: string;
};

export type OtelShutdown = () => Promise<void>;

/**
 * Optional OpenTelemetry init (E7). Default off — no exporter, no cloud SDK.
 * When enabled, exports OTLP/HTTP traces (+ metrics) to any local collector.
 */
export async function initOtel(opts: {
  env: OtelInitEnv;
  /** Override when env OTEL_SERVICE_NAME is unset. */
  defaultServiceName: string;
}): Promise<OtelShutdown> {
  if (!opts.env.OTEL_ENABLED) {
    return async () => undefined;
  }

  const endpoint = opts.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) {
    console.error(
      "[otel] OTEL_ENABLED=true but OTEL_EXPORTER_OTLP_ENDPOINT is unset — skipping SDK",
    );
    return async () => undefined;
  }

  const serviceName = opts.env.OTEL_SERVICE_NAME?.trim() || opts.defaultServiceName;

  const [
    { NodeSDK },
    { OTLPTraceExporter },
    { OTLPMetricExporter },
    { PeriodicExportingMetricReader },
    { resourceFromAttributes },
    semconv,
  ] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/exporter-metrics-otlp-http"),
    import("@opentelemetry/sdk-metrics"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/semantic-conventions"),
  ]);

  const base = endpoint.replace(/\/$/, "");
  const resource = resourceFromAttributes({
    [semconv.ATTR_SERVICE_NAME]: serviceName,
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
        exportIntervalMillis: 15_000,
      }),
    ],
  });

  sdk.start();
  console.error(`[otel] OTLP export enabled service=${serviceName} endpoint=${base}`);

  return async () => {
    await sdk.shutdown();
  };
}
