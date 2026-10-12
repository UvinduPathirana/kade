package lk.kade.promotion.note;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.Optional;
import java.util.UUID;
import lk.kade.promotion.money.Money;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Plain SQL through {@link JdbcClient}: every statement the service runs is visible here. */
@Repository
public class NoteRepository {

    private final JdbcClient jdbc;

    public NoteRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(Note note) {
        jdbc.sql("""
                INSERT INTO notes (id, text, amount_minor, currency, created_by, created_at)
                VALUES (:id, :text, :amountMinor, :currency, :createdBy, :createdAt)
                """)
                .param("id", note.id())
                .param("text", note.text())
                .param("amountMinor", note.amount().amountMinor())
                .param("currency", note.amount().currency())
                .param("createdBy", note.createdBy())
                .param("createdAt", Timestamp.from(note.createdAt()))
                .update();
    }

    public Optional<Note> findById(UUID id) {
        return jdbc.sql("SELECT id, text, amount_minor, currency, created_by, created_at FROM notes WHERE id = :id")
                .param("id", id)
                .query(NoteRepository::map)
                .optional();
    }

    private static Note map(ResultSet rs, int row) throws SQLException {
        return new Note(
                rs.getObject("id", UUID.class),
                rs.getString("text"),
                Money.of(rs.getLong("amount_minor"), rs.getString("currency")),
                rs.getString("created_by"),
                rs.getTimestamp("created_at").toInstant());
    }
}
