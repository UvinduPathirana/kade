package lk.kade.template.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.mock.env.MockEnvironment;

class DatabaseUrlEnvironmentPostProcessorTest {

    @Test
    void translatesConventionUrlToJdbc() {
        Map<String, Object> p = DatabaseUrlEnvironmentPostProcessor.toJdbc("postgres://order:order@postgres:5432/orders");
        assertThat(p).containsEntry("spring.datasource.url", "jdbc:postgresql://postgres:5432/orders")
                .containsEntry("spring.datasource.username", "order")
                .containsEntry("spring.datasource.password", "order");
    }

    @Test
    void keepsQueryAndDecodesCredentialsAndDefaultsPort() {
        Map<String, Object> p = DatabaseUrlEnvironmentPostProcessor.toJdbc("postgresql://u%40x:p%3Aw@db/app?sslmode=disable");
        assertThat(p).containsEntry("spring.datasource.url", "jdbc:postgresql://db:5432/app?sslmode=disable")
                .containsEntry("spring.datasource.username", "u@x")
                .containsEntry("spring.datasource.password", "p:w");
    }

    @Test
    void rejectsOtherSchemes() {
        assertThatThrownBy(() -> DatabaseUrlEnvironmentPostProcessor.toJdbc("mysql://a:b@h/d"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void explicitDatasourceSettingsWin() {
        MockEnvironment env = new MockEnvironment()
                .withProperty("kade.database-url", "postgres://a:b@h:1/d")
                .withProperty("spring.datasource.url", "jdbc:postgresql://override/x");
        new DatabaseUrlEnvironmentPostProcessor().postProcessEnvironment(env, new SpringApplication());
        assertThat(env.getProperty("spring.datasource.url")).isEqualTo("jdbc:postgresql://override/x");
        assertThat(env.getProperty("spring.datasource.username")).isEqualTo("a");
    }
}
