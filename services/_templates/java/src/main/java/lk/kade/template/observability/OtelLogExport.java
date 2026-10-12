package lk.kade.template.observability;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.instrumentation.logback.appender.v1_0.OpenTelemetryAppender;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

/**
 * Ships logs over OTLP (to Loki via the otel collector) in addition to the JSON lines on stdout. Spring Boot builds
 * the OpenTelemetry SDK and the OTLP log exporter; the Logback bridge has to be attached by hand. Records carry the
 * active trace and span ids, so Grafana links logs and traces.
 */
@Component
@ConditionalOnProperty(name = "kade.otel.logs.enabled", havingValue = "true", matchIfMissing = true)
class OtelLogExport implements SmartLifecycle {

    private final OpenTelemetry openTelemetry;
    private OpenTelemetryAppender appender;

    OtelLogExport(OpenTelemetry openTelemetry) {
        this.openTelemetry = openTelemetry;
    }

    @Override
    public void start() {
        LoggerContext context = (LoggerContext) LoggerFactory.getILoggerFactory();
        appender = new OpenTelemetryAppender();
        appender.setContext(context);
        appender.setName("OTEL");
        appender.setOpenTelemetry(openTelemetry);
        appender.start();
        context.getLogger(Logger.ROOT_LOGGER_NAME).addAppender(appender);
    }

    @Override
    public void stop() {
        if (appender != null) {
            ((LoggerContext) LoggerFactory.getILoggerFactory()).getLogger(Logger.ROOT_LOGGER_NAME).detachAppender(appender);
            appender.stop();
            appender = null;
        }
    }

    @Override
    public boolean isRunning() {
        return appender != null;
    }
}
